import {
  type AgentRuntimeAction,
  type AgentRuntimeContext,
  type AgentRuntimeDriver,
  type AgentActionOutcome
} from './agentRuntime.js';
import { verificationProofLevel, type VerificationReport } from './verification.js';
import { buildAgentWorkingPlan, buildHypothesisLedger, frameObjective } from './investigationExecutionLoop.js';
import type { SurveyResult, WorkOrder } from './types.js';

export interface AgentJobCredentials {
  baseUrl: string;
  cookie: string;
  csrfToken: string;
}

export class AgentJobHttpError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly detail: unknown
  ) {
    super(message);
  }
}

function idempotencyKey(actionKey: string, substep: string): string {
  return `${actionKey}-${substep}`.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 128);
}

async function callApi<T>(
  credentials: AgentJobCredentials,
  actionKey: string,
  substep: string,
  route: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {}
): Promise<T> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    Cookie: credentials.cookie,
    Origin: credentials.baseUrl
  };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers['X-JC-CSRF'] = credentials.csrfToken;
    headers['Idempotency-Key'] = idempotencyKey(actionKey, substep);
  }
  const request: RequestInit = { method, headers };
  if (method === 'POST') request.body = JSON.stringify(options.body ?? {});
  const response = await fetch(credentials.baseUrl + route, request);
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : `JoeCoder request failed (${response.status}).`;
    const code = typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
    throw new AgentJobHttpError(message, code, response.status, payload);
  }
  return payload as T;
}

function isSurveyResult(value: unknown): value is SurveyResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SurveyResult>;
  return Boolean(
    candidate.summary &&
    typeof candidate.summary.totalFiles === 'number' &&
    candidate.findings &&
    Array.isArray(candidate.unknowns) &&
    Array.isArray(candidate.observations)
  );
}

function inferIntent(objective: string, survey: unknown): 'inspect' | 'repair' | 'build' {
  const text = objective.toLowerCase();
  const asksForChange = /\b(fix|repair|change|update|refactor|redesign|replace|remove|add|implement|improve|finish|complete|wire|connect|correct|build|create|scaffold)\b/.test(text);
  const asksForReadOnly = /\b(inspect|review|audit|analy[sz]e|assess|survey|explain|investigate|diagnose|report|find bugs|look for bugs)\b/.test(text);
  if (asksForReadOnly && !asksForChange) return 'inspect';
  const candidate = survey as { summary?: { totalFiles?: number }; result?: { summary?: { totalFiles?: number } } } | null;
  const totalFiles = Number(candidate?.summary?.totalFiles ?? candidate?.result?.summary?.totalFiles ?? 999999);
  const asksForNewBuild = /\b(build|create|scaffold|start|new app|new site|from scratch)\b/.test(text);
  return totalFiles === 0 && asksForNewBuild ? 'build' : 'repair';
}

function workOrderBudgets(workOrder: Record<string, any>): Record<string, unknown> {
  return workOrder.budgets && typeof workOrder.budgets === 'object' ? workOrder.budgets : {};
}

function successfulTerminal(result: Record<string, any>): {
  terminalState: 'completed' | 'completed_with_limits';
  reason: string;
  proofLevel: string;
} {
  if (!result.verification) {
    return {
      terminalState: 'completed',
      reason: 'The read-only or handoff result passed its evidence-derived acceptance checks.',
      proofLevel: 'evidence'
    };
  }
  const proofLevel = verificationProofLevel(result.verification as VerificationReport);
  if (proofLevel === 'runtime') {
    return {
      terminalState: 'completed',
      reason: 'The authorized change and available runtime checks passed.',
      proofLevel
    };
  }
  return {
    terminalState: 'completed_with_limits',
    reason: proofLevel === 'integrity'
      ? 'The authorized files changed and passed integrity checks, but runtime behavior remains unproven.'
      : 'The authorized result completed without runnable project verification.',
    proofLevel
  };
}

export function createHttpAgentDriver(credentials: AgentJobCredentials): AgentRuntimeDriver {
  return {
    async execute(context: AgentRuntimeContext): Promise<AgentActionOutcome> {
      const { job, state, action, actionKey } = context;
      const handlers: Record<AgentRuntimeAction, () => Promise<AgentActionOutcome>> = {
        capture_objective: async () => {
          if (!job.workOrderId) {
            await callApi(
              credentials,
              actionKey,
              'conversation',
              `/api/v1/projects/${job.projectId}/threads/${job.threadId}/chat`,
              { method: 'POST', body: { content: job.objective } }
            );
          }
          return {
            statePatch: { objective: job.objective, objectiveFrame: frameObjective(job.objective), objectiveRecorded: true },
            journals: [{
              kind: 'decision',
              payload: { objective: job.objective, reusedWorkOrder: job.workOrderId || null }
            }]
          };
        },

        establish_evidence: async () => {
          let projectResponse = await callApi<{ project: Record<string, any>; latestSurvey?: unknown }>(
            credentials, actionKey, 'project-before-inspection', `/api/v1/projects/${job.projectId}`
          );
          const project = projectResponse.project;
          const needsInspection = !project.latestSurveyId ||
            ['folder_selected', 'complete', 'partial', 'blocked', 'cancelled'].includes(String(project.workflowStage));
          let surveyEvidenceId = project.latestSurveyId ? String(project.latestSurveyId) : null;
          if (needsInspection) {
            const survey = await callApi<Record<string, any>>(
              credentials,
              actionKey,
              'inspection',
              '/api/v1/survey',
              { method: 'POST', body: { path: project.path, projectId: job.projectId } }
            );
            surveyEvidenceId = survey.evidenceId ? String(survey.evidenceId) : surveyEvidenceId;
          }
          projectResponse = await callApi(
            credentials, actionKey, 'project-after-inspection', `/api/v1/projects/${job.projectId}`
          );
          const survey = isSurveyResult(projectResponse.latestSurvey) ? projectResponse.latestSurvey : null;
          const hypotheses = survey
            ? buildHypothesisLedger(survey)
            : {
                knownFacts: [`Project revision ${Number(projectResponse.project.revision || 0)} is current.`],
                inferences: [],
                unknowns: ['No verified survey payload was available to build a hypothesis ledger.']
              };
          return {
            statePatch: {
              evidenceReady: true,
              surveyEvidenceId,
              projectRevision: Number(projectResponse.project.revision || 0),
              projectStage: String(projectResponse.project.workflowStage || ''),
              projectPath: String(projectResponse.project.path || ''),
              hypotheses
            },
            evidenceId: surveyEvidenceId,
            journals: [{ kind: 'decision', payload: { decision: 'evidence_ledger_updated', hypotheses } }]
          };
        },

        produce_plan: async () => {
          let workOrder: Record<string, any>;
          let intent: 'inspect' | 'repair' | 'build';
          if (job.workOrderId) {
            const existing = await callApi<{ workOrder: Record<string, any> }>(
              credentials, actionKey, 'existing-work-order', `/api/v1/work-orders/${job.workOrderId}`
            );
            workOrder = existing.workOrder;
            intent = (workOrder.intent || 'repair') as typeof intent;
          } else {
            const projectResponse = await callApi<{ project: Record<string, any>; latestSurvey?: unknown }>(
              credentials, actionKey, 'project-for-plan', `/api/v1/projects/${job.projectId}`
            );
            await callApi(
              credentials,
              actionKey,
              'accept-project',
              `/api/v1/projects/${job.projectId}/accept`,
              { method: 'POST', body: {} }
            );
            intent = inferIntent(job.objective, projectResponse.latestSurvey);
            const draft = await callApi<{ workOrder: Record<string, any> }>(
              credentials,
              actionKey,
              'draft-work-order',
              '/api/v1/work-orders/from-survey',
              {
                method: 'POST',
                body: {
                  surveyId: projectResponse.project.latestSurveyId,
                  objective: job.objective,
                  intent,
                  threadId: job.threadId
                }
              }
            );
            workOrder = draft.workOrder;
          }
          const planProject = await callApi<{ project: Record<string, any>; latestSurvey?: unknown }>(
            credentials, actionKey, 'project-for-working-plan', `/api/v1/projects/${job.projectId}`
          );
          const planSurvey = isSurveyResult(planProject.latestSurvey) ? planProject.latestSurvey : null;
          const workingPlan = buildAgentWorkingPlan(workOrder as WorkOrder, planSurvey);
          const planRevision = Number(state.planRevision || 0) + 1;
          const budgets = workOrderBudgets(workOrder);
          return {
            statePatch: {
              planRevision,
              workOrderId: String(workOrder.id),
              intent,
              plan: {
                objective: workOrder.objective,
                scope: workOrder.scope,
                acceptance: workOrder.acceptance,
                risk: workOrder.risk || null,
                ...workingPlan
              },
              budgets
            },
            jobPatch: { workOrderId: String(workOrder.id), intent },
            journals: [
              {
                kind: 'plan_revision',
                payload: {
                  revision: planRevision,
                  workOrderId: workOrder.id,
                  objective: workOrder.objective,
                  scope: workOrder.scope,
                  acceptance: workOrder.acceptance,
                  workingPlan
                }
              },
              { kind: 'budget', payload: { revision: planRevision, budgets } }
            ]
          };
        },

        seal_authorization: async () => {
          const workOrderId = String(state.workOrderId || job.workOrderId || '');
          if (!workOrderId) throw new Error('AGENT_RUNTIME_WORK_ORDER_REQUIRED');
          let response = await callApi<{ workOrder: Record<string, any> }>(
            credentials, actionKey, 'work-order-before-authorize', `/api/v1/work-orders/${workOrderId}`
          );
          let workOrder = response.workOrder;
          if (workOrder.status === 'draft') {
            response = await callApi(
              credentials,
              actionKey,
              'authorize',
              `/api/v1/work-orders/${workOrderId}/authorize`,
              {
                method: 'POST',
                body: {
                  grantedBy: 'local-operator:server-agent-runtime',
                  automationGrant: {
                    mode: 'bounded_auto_job',
                    projectId: job.projectId,
                    threadId: job.threadId,
                    objective: workOrder.objective,
                    maxAttempts: 1
                  }
                }
              }
            );
            workOrder = response.workOrder;
          }
          if (workOrder.status !== 'authorized') {
            throw new AgentJobHttpError(
              `Work Order ${workOrderId} is ${workOrder.status}; it cannot execute.`,
              'WORK_ORDER_NOT_AUTHORIZED',
              409,
              { workOrderId, status: workOrder.status }
            );
          }
          return {
            statePatch: {
              authorizationSealed: true,
              authorizationEnvelopeHash: workOrder.authorization?.envelopeHash || null
            },
            journals: [{
              kind: 'decision',
              payload: {
                decision: 'authorized',
                workOrderId,
                envelopeHash: workOrder.authorization?.envelopeHash || null
              }
            }]
          };
        },

        execute_change: async () => {
          const workOrderId = String(state.workOrderId || job.workOrderId || '');
          if (!workOrderId) throw new Error('AGENT_RUNTIME_WORK_ORDER_REQUIRED');
          const current = await callApi<{ workOrder: Record<string, any> }>(
            credentials, actionKey, 'work-order-before-execute', `/api/v1/work-orders/${workOrderId}`
          );
          const operations = Array.isArray(current.workOrder.scope?.operations)
            ? current.workOrder.scope.operations as string[]
            : [];
          const applyAction = operations.includes('edit_files') ? 'apply_edits' : 'export_handoff';
          const result = await callApi<Record<string, any>>(
            credentials,
            actionKey,
            'execute',
            `/api/v1/work-orders/${workOrderId}/apply`,
            { method: 'POST', body: { action: applyAction } }
          );
          return {
            statePatch: { executionCompleted: true, executionAction: applyAction, executionResult: result },
            jobPatch: { result },
            evidenceId: result.evidenceId ? String(result.evidenceId) : null
          };
        },

        evaluate_verification: async () => {
          const result = state.executionResult as Record<string, any> | undefined;
          if (!result) throw new Error('AGENT_RUNTIME_EXECUTION_RESULT_REQUIRED');
          const classification = successfulTerminal(result);
          const verification = result.verification || {
            proofLevel: classification.proofLevel,
            evidenceId: result.evidenceId || null,
            workOrderStatus: result.workOrder?.status || null
          };
          return {
            statePatch: {
              verificationEvaluated: true,
              verification,
              requestedTerminalState: classification.terminalState,
              requestedTerminalReason: classification.reason
            },
            journals: [{
              kind: 'verification',
              payload: {
                proofLevel: classification.proofLevel,
                terminalState: classification.terminalState,
                reason: classification.reason,
                verification
              },
              evidenceId: result.evidenceId ? String(result.evidenceId) : null
            }]
          };
        },

        finalize: async () => {
          const terminalState = state.requestedTerminalState === 'completed_with_limits'
            ? 'completed_with_limits'
            : 'completed';
          const terminalReason = String(
            state.requestedTerminalReason || 'The bounded job completed with recorded evidence.'
          );
          return {
            statePatch: { finalizedAt: Date.now() },
            jobPatch: { result: state.executionResult || job.result },
            terminalState,
            terminalReason
          };
        }
      };

      return handlers[action]();
    }
  };
}


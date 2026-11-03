import {
  type AgentRuntimeAction,
  type AgentRuntimeContext,
  type AgentRuntimeDriver,
  type AgentActionOutcome
} from './agentRuntime.js';
import { verificationProofLevel, type VerificationReport } from './verification.js';
import { buildAgentWorkingPlan, buildHypothesisLedger, frameObjective } from './investigationExecutionLoop.js';
import type { SurveyResult, WorkOrder } from './types.js';
import { appendAgentJobMemory } from './database/database.js';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface AgentJobCredentials {
  baseUrl: string;
  cookie: string;
  csrfToken: string;
  runtimeToken: string;
  jobId: string;
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
  options: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    Cookie: credentials.cookie,
    Origin: credentials.baseUrl,
    'X-JC-Agent-Runtime': credentials.runtimeToken,
    'X-JC-Agent-Job': credentials.jobId
  };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers['X-JC-CSRF'] = credentials.csrfToken;
    headers['Idempotency-Key'] = idempotencyKey(actionKey, substep);
  }
  const body = method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined;
  if (body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(body));
  const endpoint = new URL(route, credentials.baseUrl);
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 15 * 60_000, 30 * 60_000));
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const transport = endpoint.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = transport(endpoint, { method, headers }, resolve);
    const timer = setTimeout(() => {
      outgoing.destroy(new Error(`AGENT_API_TIMEOUT after ${Math.round(timeoutMs / 1000)}s (${route})`));
    }, timeoutMs);
    outgoing.once('close', () => clearTimeout(timer));
    outgoing.once('error', reject);
    outgoing.end(body);
  });
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 16 * 1024 * 1024) throw new Error(`AGENT_API_RESPONSE_TOO_LARGE (${route})`);
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* handled by status or empty payload */ }
  const status = response.statusCode || 500;
  if (status < 200 || status >= 300) {
    const message = typeof payload.error === 'string' ? payload.error : `JoeCoder request failed (${status}).`;
    const code = typeof payload.code === 'string' ? payload.code : `HTTP_${status}`;
    throw new AgentJobHttpError(message, code, status, payload);
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

export function inferIntent(objective: string, survey: unknown): 'inspect' | 'repair' | 'build' {
  const text = objective.toLowerCase();
  // A selected Automatic mode does not override an explicit read-only request.
  // In particular, "this build" names the project; it is not permission to build.
  if (/\bread[- ]only\b|\b(?:do not|don't|without)\s+(?:change|changing|edit|editing|modify|modifying|write|writing)\b/.test(text)
      || /^(?:please\s+)?(?:explain|describe|tell me|show me how|how (?:do|can|would|should))\b/.test(text.trim())) return 'inspect';
  const buildCommand = /^\s*(?:please\s+)?build\b|\b(?:and|then)\s+build\b|\bbuild\s+(?:a|an|new|me|the|our|my|us)\b/.test(text);
  const asksForChange = buildCommand || /\b(fix|repair|change|update|refactor|redesign|replace|remove|add|implement|improve|finish|complete|wire|connect|correct|create|scaffold|restore|enable)\b/.test(text)
    || /\bmake\b[\s\S]{0,160}\b(run|work|functional|usable|available|persist|survive)\b/.test(text)
    || /\bensure\b[\s\S]{0,160}\b(run|work|persist|survive|prevent|reject|handle)\b/.test(text);
  const asksForReadOnly = /\b(inspect|review|audit|analy[sz]e|assess|survey|explain|investigate|diagnose|report|find bugs|look for bugs)\b/.test(text);
  if (asksForReadOnly && !asksForChange) return 'inspect';
  if (!asksForChange) return 'inspect';
  const candidate = survey as { summary?: { totalFiles?: number }; result?: { summary?: { totalFiles?: number } } } | null;
  const totalFiles = Number(candidate?.summary?.totalFiles ?? candidate?.result?.summary?.totalFiles ?? 999999);
  const asksForNewBuild = /\b(build|create|scaffold|start|new app|new site|from scratch)\b/.test(text);
  return totalFiles === 0 && asksForNewBuild ? 'build' : 'repair';
}

function workOrderBudgets(workOrder: Record<string, any>): Record<string, unknown> {
  return workOrder.budgets && typeof workOrder.budgets === 'object' ? workOrder.budgets : {};
}

export function successfulTerminal(result: Record<string, any>): {
  terminalState: 'completed' | 'completed_with_limits';
  reason: string;
  proofLevel: string;
} {
  if (result.mockModel === true || result.model === 'jc-mock-model') {
    const proofLevel = result.verification
      ? verificationProofLevel(result.verification as VerificationReport)
      : 'evidence';
    return {
      terminalState: 'completed_with_limits',
      reason: 'The deterministic mock exercised the guarded workflow, but mock output cannot prove production coding capability.',
      proofLevel
    };
  }
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

/** v3 J4: classify apply results including completion denials so verify/finalize still run. */
export function classifyExecutionResult(result: Record<string, any>): {
  terminalState: 'completed' | 'completed_with_limits' | 'failed_safe';
  reason: string;
  proofLevel: string;
} {
  const code = typeof result.code === 'string' ? result.code : '';
  if (code === 'COMPLETION_EVIDENCE_FAILED' || code === 'ROLLBACK_INCOMPLETE' || result.rolledBack === true) {
    const failedCriteria = Array.isArray(result.acceptanceResults)
      ? result.acceptanceResults
        .filter((item: { passed?: unknown }) => item && item.passed === false)
        .map((item: { criterion?: unknown }) => String(item.criterion || 'acceptance check failed'))
      : [];
    const reason = typeof result.error === 'string' && result.error.trim()
      ? result.error
      : failedCriteria.length
        ? `Repair completion denied: ${failedCriteria.join('; ')}.`
        : code === 'ROLLBACK_INCOMPLETE'
          ? 'Repair failed and rollback did not fully restore the snapshot.'
          : 'Repair completion denied.';
    const proofLevel = result.verification
      ? verificationProofLevel(result.verification as VerificationReport)
      : 'failed';
    return { terminalState: 'failed_safe', reason, proofLevel };
  }
  return successfulTerminal(result);
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
              '/api/v1/internal/survey',
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
          for (const fact of hypotheses.knownFacts.slice(0, 5)) appendAgentJobMemory({
            jobId: job.id, kind: 'architecture', content: fact, evidenceIds: surveyEvidenceId ? [surveyEvidenceId] : []
          });
          for (const unknown of hypotheses.unknowns.slice(0, 5)) appendAgentJobMemory({
            jobId: job.id, kind: 'unresolved_risk', content: unknown, evidenceIds: surveyEvidenceId ? [surveyEvidenceId] : []
          });
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
              `/api/v1/internal/projects/${job.projectId}/accept`,
              { method: 'POST', body: {} }
            );
            intent = inferIntent(job.objective, projectResponse.latestSurvey);
            const draft = await callApi<{ workOrder: Record<string, any> }>(
              credentials,
              actionKey,
              'draft-work-order',
              '/api/v1/internal/work-orders/from-survey',
              {
                method: 'POST',
                body: {
                  surveyId: projectResponse.project.latestSurveyId,
                  objective: job.objective,
                  intent,
                  threadId: job.threadId,
                  ...(job.maxCloudCostUsd > 0 ? { maxCloudCostUsd: job.maxCloudCostUsd } : {})
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
              `/api/v1/internal/work-orders/${workOrderId}/authorize`,
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
          if (inferIntent(job.objective, null) === 'inspect' && operations.some(operation =>
            ['edit_files', 'rename_files', 'delete_files', 'install_dependencies'].includes(operation))) {
            throw new Error('READ_ONLY_MUTATION_DENIED: an inspection request cannot reuse mutating Work Order authority.');
          }
          const applyAction = operations.includes('edit_files') ? 'apply_edits' : 'export_handoff';
          const workOrderDuration = Number(current.workOrder.budgets?.maxDurationMs || 600_000);
          let result: Record<string, any>;
          try {
            result = await callApi<Record<string, any>>(
              credentials,
              actionKey,
              'execute',
              `/api/v1/internal/work-orders/${workOrderId}/apply`,
              {
                method: 'POST',
                body: { action: applyAction },
                timeoutMs: Math.min(30 * 60_000, Math.max(120_000, workOrderDuration + 120_000))
              }
            );
          } catch (error: unknown) {
            // Completion denials still ran apply/verify/rollback. Keep them as execution results
            // so evaluate_verification can mark verificationEvaluated and preserve the criterion text.
            if (
              error instanceof AgentJobHttpError
              && (error.code === 'COMPLETION_EVIDENCE_FAILED' || error.code === 'ROLLBACK_INCOMPLETE')
              && error.detail
              && typeof error.detail === 'object'
            ) {
              result = {
                ...(error.detail as Record<string, unknown>),
                code: error.code,
                error: error.message
              };
            } else {
              throw error;
            }
          }
          appendAgentJobMemory({
            jobId: job.id,
            kind: 'attempted_fix',
            content: `${applyAction} finished for ${workOrderId}${result.code ? ` (${result.code})` : ''}.`,
            evidenceIds: result.evidenceId ? [String(result.evidenceId)] : []
          });
          return {
            statePatch: { executionCompleted: true, executionAction: applyAction, executionResult: result },
            jobPatch: { result },
            evidenceId: result.evidenceId ? String(result.evidenceId) : null
          };
        },

        evaluate_verification: async () => {
          const result = state.executionResult as Record<string, any> | undefined;
          if (!result) throw new Error('AGENT_RUNTIME_EXECUTION_RESULT_REQUIRED');
          const classification = classifyExecutionResult(result);
          const verification = result.verification || {
            proofLevel: classification.proofLevel,
            evidenceId: result.evidenceId || null,
            workOrderStatus: result.workOrder?.status || null,
            acceptanceResults: result.acceptanceResults || null
          };
          appendAgentJobMemory({
            jobId: job.id,
            kind: classification.terminalState === 'failed_safe'
              ? 'unresolved_risk'
              : classification.proofLevel === 'runtime' ? 'command_result' : 'unresolved_risk',
            content: classification.reason,
            evidenceIds: result.evidenceId ? [String(result.evidenceId)] : []
          });
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
          const requested = String(state.requestedTerminalState || 'completed');
          const terminalState = (
            requested === 'completed_with_limits'
            || requested === 'failed_safe'
            || requested === 'blocked_for_user'
            || requested === 'cancelled'
          ) ? requested as 'completed' | 'completed_with_limits' | 'failed_safe' | 'blocked_for_user' | 'cancelled'
            : 'completed';
          const terminalReason = String(
            state.requestedTerminalReason
            || (terminalState === 'failed_safe'
              ? 'Joe stopped safely because completion evidence failed.'
              : 'The bounded job completed with recorded evidence.')
          );
          return {
            statePatch: { finalizedAt: Date.now() },
            jobPatch: {
              result: state.executionResult || job.result,
              ...(terminalState === 'failed_safe' ? {
                errorCode: typeof (state.executionResult as { code?: unknown } | undefined)?.code === 'string'
                  ? String((state.executionResult as { code: string }).code)
                  : 'COMPLETION_EVIDENCE_FAILED',
                errorMessage: terminalReason
              } : {})
            },
            terminalState,
            terminalReason
          };
        }
      };

      return handlers[action]();
    }
  };
}

import { randomUUID } from 'node:crypto';
import {
  appendAgentJobEvent,
  getAgentJob,
  updateAgentJob,
  type AgentJobRecord,
  type AgentJobStage
} from './database/database.js';

export interface AgentJobCredentials {
  baseUrl: string;
  cookie: string;
  csrfToken: string;
}

class AgentJobHttpError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly detail: unknown
  ) {
    super(message);
  }
}

async function callApi<T>(
  credentials: AgentJobCredentials,
  jobId: string,
  path: string,
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
    headers['Idempotency-Key'] = `${jobId}-${randomUUID()}`;
  }
  const request: RequestInit = { method, headers };
  if (method === 'POST') request.body = JSON.stringify(options.body ?? {});
  const response = await fetch(credentials.baseUrl + path, request);
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : `JoeCoder request failed (${response.status}).`;
    const code = typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
    throw new AgentJobHttpError(message, code, response.status, payload);
  }
  return payload as T;
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

function recordStage(
  jobId: string,
  stage: AgentJobStage,
  message: string,
  what: string,
  meaning: string,
  next: string,
  payload: unknown = {}
): AgentJobRecord {
  const job = updateAgentJob(jobId, { status: 'running', stage, message });
  appendAgentJobEvent({ jobId, stage, kind: 'progress', what, meaning, next, payload });
  return job;
}

/**
 * Server-owned automatic job. It deliberately re-enters JoeCoder through
 * the authenticated public API so authorization, idempotency, path jails,
 * snapshots, budgets, verification, rollback, and evidence cannot be skipped.
 * The browser only starts and observes this durable job.
 */
export async function runAgentJob(jobId: string, credentials: AgentJobCredentials): Promise<void> {
  const initial = getAgentJob(jobId);
  if (!initial) return;
  if (initial.status === 'completed' || initial.status === 'cancelled') return;
  updateAgentJob(jobId, {
    status: 'running',
    stage: 'understand',
    message: 'Joe is taking responsibility for this job.',
    errorCode: null,
    errorMessage: null,
    startedAt: initial.startedAt || Date.now(),
    finishedAt: null,
    resumeCount: initial.status === 'interrupted' ? initial.resumeCount + 1 : initial.resumeCount
  });

  try {
    let job = getAgentJob(jobId)!;
    let workOrder: Record<string, any> | null = null;
    let projectResponse = await callApi<{ project: Record<string, any>; latestSurvey?: unknown }>(
      credentials, jobId, `/api/v1/projects/${job.projectId}`
    );
    const project = projectResponse.project;

    if (job.workOrderId) {
      const response = await callApi<{ workOrder: Record<string, any> }>(
        credentials, jobId, `/api/v1/work-orders/${job.workOrderId}`
      );
      workOrder = response.workOrder;
    } else {
      recordStage(
        jobId, 'understand', 'Recording the outcome in the project conversation.',
        'I am establishing the exact outcome for this job.',
        'The conversation supplies the objective; it does not bypass any safety control.',
        'I will establish current project evidence next.'
      );
      await callApi(
        credentials, jobId, `/api/v1/projects/${job.projectId}/threads/${job.threadId}/chat`,
        { method: 'POST', body: { content: job.objective } }
      );

      const needsInspection = !project.latestSurveyId ||
        ['folder_selected', 'complete', 'partial', 'blocked', 'cancelled'].includes(String(project.workflowStage));
      recordStage(
        jobId, 'inspect',
        needsInspection ? 'Inspecting the project without changing it.' : 'Using the current project inspection.',
        needsInspection ? 'I am reading the project and recording current evidence.' : 'I found current inspection evidence.',
        needsInspection ? 'This gives planning a real file inventory and bounded source context.' : 'Planning can use the current recorded project revision.',
        'Next I will create the smallest bounded plan.'
      );
      if (needsInspection) {
        await callApi(credentials, jobId, '/api/v1/survey', {
          method: 'POST',
          body: { path: project.path, projectId: job.projectId }
        });
      }
      projectResponse = await callApi(credentials, jobId, `/api/v1/projects/${job.projectId}`);

      recordStage(
        jobId, 'plan', 'Planning the bounded job from current evidence.',
        'I am selecting the necessary files and checks.',
        'The model may propose work, but the server validates every path, operation, and limit.',
        'A valid plan will become one sealed Work Order.'
      );
      await callApi(credentials, jobId, `/api/v1/projects/${job.projectId}/accept`, { method: 'POST', body: {} });
      const intent = inferIntent(job.objective, projectResponse.latestSurvey);
      updateAgentJob(jobId, { intent });
      const draft = await callApi<{ workOrder: Record<string, any> }>(
        credentials, jobId, '/api/v1/work-orders/from-survey',
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
      updateAgentJob(jobId, { workOrderId: String(workOrder.id) });
    }

    if (!workOrder) throw new Error('Joe did not produce a Work Order for this job.');
    recordStage(
      jobId, 'authorize', 'Sealing the exact scope for this one job.',
      'I am validating the Work Order and recording the one-job grant.',
      'Paths, operations, budgets, project, conversation, and objective must match before execution.',
      'If the envelope is valid, Joe will execute without another checkpoint.',
      { workOrderId: workOrder.id }
    );
    if (workOrder.status === 'draft') {
      const authorized = await callApi<{ workOrder: Record<string, any> }>(
        credentials, jobId, `/api/v1/work-orders/${workOrder.id}/authorize`,
        {
          method: 'POST',
          body: {
            grantedBy: 'local-operator:server-agent-job',
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
      workOrder = authorized.workOrder;
    }
    if (workOrder.status !== 'authorized') {
      throw new AgentJobHttpError(
        `Work Order ${workOrder.id} is ${workOrder.status}; it cannot execute.`,
        'WORK_ORDER_NOT_AUTHORIZED',
        409,
        { workOrderId: workOrder.id, status: workOrder.status }
      );
    }

    const repair = Array.isArray(workOrder.scope?.operations) && workOrder.scope.operations.includes('edit_files');
    recordStage(
      jobId, 'run', repair ? 'Changing only the sealed files.' : 'Creating the bounded inspection handoff.',
      repair ? 'I am protecting the current files, making the change, and running the project checks.' : 'I am producing the recorded read-only result.',
      repair ? 'A snapshot exists before writes; a failed final check restores it.' : 'No project source files are in the write scope.',
      'Next I will evaluate the recorded proof.',
      { workOrderId: workOrder.id, action: repair ? 'apply_edits' : 'export_handoff' }
    );
    const result = await callApi<Record<string, any>>(
      credentials, jobId, `/api/v1/work-orders/${workOrder.id}/apply`,
      { method: 'POST', body: { action: repair ? 'apply_edits' : 'export_handoff' } }
    );

    recordStage(
      jobId, 'verify', 'Evaluating the completion evidence.',
      'I am checking what the job actually proved.',
      'Joe reports runtime proof, file-integrity proof, or an unproven state distinctly.',
      'A terminal result will now be recorded.',
      { workOrderId: workOrder.id, evidenceId: result.evidenceId || null }
    );
    const completed = updateAgentJob(jobId, {
      status: 'completed',
      stage: 'complete',
      message: 'The bounded job completed and its result was recorded.',
      result,
      finishedAt: Date.now()
    });
    appendAgentJobEvent({
      jobId, stage: 'complete', kind: 'result',
      what: 'I completed the bounded job.',
      meaning: 'The result is tied to the Work Order, verification report, and evidence record.',
      next: 'Review the result in this conversation or describe the next outcome.',
      payload: { workOrderId: completed.workOrderId, result }
    });
  } catch (error: unknown) {
    const code = error instanceof AgentJobHttpError ? error.code : 'AGENT_JOB_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    const failed = updateAgentJob(jobId, {
      status: 'failed',
      stage: 'blocked',
      message: 'Joe stopped because this job could not safely continue.',
      errorCode: code,
      errorMessage: message,
      finishedAt: Date.now()
    });
    appendAgentJobEvent({
      jobId, stage: 'blocked', kind: 'failure',
      what: 'I stopped this job safely.',
      meaning: message,
      next: failed.workOrderId ? 'Review the recorded Work Order and evidence before retrying.' : 'Correct the named blocker, then send the request again.',
      payload: error instanceof AgentJobHttpError ? error.detail : {}
    });
  }
}

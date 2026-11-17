import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendAgentJobJournal, getAgentJob, listAgentJobJournal } from './database/database.js';

const scope = new AsyncLocalStorage<string>();
export const withAgentJob = <T>(jobId: string, action: () => T): T => scope.run(jobId, action);
export const currentAgentJobId = () => scope.getStore();

export class AgentWorkflowError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export const WORKFLOW_LIMITS = { modelTurns: 12, toolActions: 40 } as const;
export interface WorkflowBudget {
  version: 1; deadlineAt: number; modelTurns: number; toolActions: number;
  spentOrReservedUsd: number; cloudLimitUsd: number;
}
export function workflowBudget(jobId = currentAgentJobId()): WorkflowBudget | null {
  if (!jobId) return null;
  const job = getAgentJob(jobId);
  if (!job) throw new AgentWorkflowError('AGENT_JOB_NOT_FOUND', 'The job no longer exists.');
  const record = listAgentJobJournal(jobId).filter(entry => entry.kind === 'budget'
    && (entry.payload as { workflow?: unknown })?.workflow === 'v1').at(-1);
  if (record) return (record.payload as { budget: WorkflowBudget }).budget;
  return { version: 1, deadlineAt: (job.startedAt || job.createdAt) + 600_000,
    modelTurns: 0, toolActions: 0, spentOrReservedUsd: 0, cloudLimitUsd: job.maxCloudCostUsd };
}
function saveBudget(jobId: string, budget: WorkflowBudget, reason: string, details: Record<string, unknown> = {}) {
  appendAgentJobJournal({ jobId, kind: 'budget', stage: getAgentJob(jobId)?.stage || 'run',
    actionKey: 'workflow-budget-' + randomUUID(), payload: { workflow: 'v1', reason, budget, ...details } });
}
export function checkWorkflow(jobId = currentAgentJobId()): WorkflowBudget | null {
  const budget = workflowBudget(jobId);
  if (!jobId || !budget) return null;
  if (budget.version !== 1) throw new AgentWorkflowError('WORKFLOW_VERSION_UNSUPPORTED', 'This workflow checkpoint requires a compatible application version.');
  if (getAgentJob(jobId)?.stopRequested) throw new AgentWorkflowError('AGENT_STOP_REQUESTED', 'The operator requested Stop.');
  if (Date.now() >= budget.deadlineAt) throw new AgentWorkflowError('WORKFLOW_TIME_LIMIT', 'The total job time limit has been reached.');
  return budget;
}
export function constrainWorkflow(durationMs: number, cloudLimitUsd: number) {
  const jobId = currentAgentJobId(), budget = checkWorkflow();
  if (!jobId || !budget) return;
  const job = getAgentJob(jobId)!;
  saveBudget(jobId, { ...budget, deadlineAt: Math.min(budget.deadlineAt, (job.startedAt || job.createdAt) + durationMs),
    cloudLimitUsd: Math.min(budget.cloudLimitUsd, cloudLimitUsd) }, 'sealed_limits');
}
export function reserveToolAction() {
  const jobId = currentAgentJobId(), budget = checkWorkflow();
  if (!jobId || !budget) return;
  if (budget.toolActions >= WORKFLOW_LIMITS.toolActions) throw new AgentWorkflowError('WORKFLOW_TOOL_LIMIT', `The job used its ${WORKFLOW_LIMITS.toolActions} permitted tool actions.`);
  saveBudget(jobId, { ...budget, toolActions: budget.toolActions + 1 }, 'tool_reservation');
}

export async function budgetedModelCall<T>(input: {
  provider: string; reserveUsd: number;
  run: (signal: AbortSignal | undefined, remainingMs: number) => Promise<T>;
  actualCost?: (result: T) => number | undefined;
}): Promise<T> {
  const jobId = currentAgentJobId(), budget = checkWorkflow();
  if (!jobId || !budget) return input.run(undefined, Number.MAX_SAFE_INTEGER);
  if (budget.modelTurns >= WORKFLOW_LIMITS.modelTurns) throw new AgentWorkflowError('WORKFLOW_MODEL_LIMIT', `The job used its ${WORKFLOW_LIMITS.modelTurns} permitted model turns.`);
  if (!Number.isFinite(input.reserveUsd) || input.reserveUsd < 0
      || budget.spentOrReservedUsd + input.reserveUsd > budget.cloudLimitUsd + 1e-9) {
    throw new AgentWorkflowError('WORKFLOW_CLOUD_BUDGET', 'This call exceeds the remaining job cloud budget.');
  }
  const callId = randomUUID();
  saveBudget(jobId, { ...budget, modelTurns: budget.modelTurns + 1,
    spentOrReservedUsd: budget.spentOrReservedUsd + input.reserveUsd }, 'model_reservation', { callId, provider: input.provider, reservedUsd: input.reserveUsd });
  const controller = new AbortController();
  const poll = setInterval(() => {
    try { checkWorkflow(jobId); } catch (error) { controller.abort(error); }
  }, 250);
  poll.unref();
  try {
    const result = await input.run(controller.signal, Math.max(1, budget.deadlineAt - Date.now()));
    const actual = input.actualCost?.(result);
    if (actual !== undefined && Number.isFinite(actual) && actual >= 0) {
      const current = workflowBudget(jobId)!;
      saveBudget(jobId, { ...current, spentOrReservedUsd: Math.max(0, current.spentOrReservedUsd - input.reserveUsd + actual) },
        'model_usage', { callId, actualUsd: actual });
      if (current.spentOrReservedUsd - input.reserveUsd + actual > current.cloudLimitUsd + 1e-9) {
        throw new AgentWorkflowError('WORKFLOW_CLOUD_BUDGET', 'Reported usage exceeded the job budget; further calls are blocked.');
      }
    }
    checkWorkflow(jobId);
    return result;
  } finally { clearInterval(poll); }
}

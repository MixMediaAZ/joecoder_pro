import {
  appendAgentJobEvent,
  appendAgentJobJournal,
  commitAgentJobCheckpoint,
  getAgentJob,
  getAgentJobCheckpoint,
  getAgentJobJournalEntry,
  updateAgentJob,
  type AgentJobJournalKind,
  type AgentJobRecord,
  type AgentJobStage,
  type AgentJobTerminalState
} from './database/database.js';

export const AGENT_ACTION_SEQUENCE = [
  'capture_objective',
  'establish_evidence',
  'produce_plan',
  'seal_authorization',
  'execute_change',
  'evaluate_verification',
  'finalize'
] as const;

export type AgentRuntimeAction = typeof AGENT_ACTION_SEQUENCE[number];

export interface AgentRuntimeSnapshot extends Record<string, unknown> {
  schemaVersion: 1;
  completedActions: AgentRuntimeAction[];
  transitionCount: number;
}

export interface AgentRuntimeJournalInput {
  kind: Extract<AgentJobJournalKind, 'plan_revision' | 'budget' | 'verification' | 'decision'>;
  payload: unknown;
  evidenceId?: string | null;
}

export interface AgentActionOutcome {
  statePatch?: Record<string, unknown>;
  jobPatch?: Partial<Pick<AgentJobRecord,
    'intent' | 'workOrderId' | 'message' | 'result' | 'errorCode' | 'errorMessage'
  >>;
  journals?: AgentRuntimeJournalInput[];
  evidenceId?: string | null;
  terminalState?: AgentJobTerminalState;
  terminalReason?: string;
}

export interface AgentRuntimeContext {
  job: AgentJobRecord;
  state: AgentRuntimeSnapshot;
  action: AgentRuntimeAction;
  actionKey: string;
}

export interface AgentRuntimeDriver {
  execute(context: AgentRuntimeContext): Promise<AgentActionOutcome>;
}

export interface AgentRuntimeStepResult {
  job: AgentJobRecord;
  action: AgentRuntimeAction | null;
  recoveredResult: boolean;
  terminal: boolean;
}

const ACTION_PRESENTATION: Record<AgentRuntimeAction, {
  stage: AgentJobStage;
  what: string;
  meaning: string;
  next: string;
}> = {
  capture_objective: {
    stage: 'understand',
    what: 'I am fixing the requested outcome as one bounded job.',
    meaning: 'The conversation supplies the objective; it does not bypass safety controls.',
    next: 'Establish current project evidence.'
  },
  establish_evidence: {
    stage: 'inspect',
    what: 'I am establishing current project evidence without changing files.',
    meaning: 'Planning must use observed project truth rather than assumptions.',
    next: 'Produce the smallest evidence-backed plan.'
  },
  produce_plan: {
    stage: 'plan',
    what: 'I am producing a bounded working plan.',
    meaning: 'Paths, operations, limits, rollback, and checks must be reviewable before writes.',
    next: 'Seal the exact authorization envelope.'
  },
  seal_authorization: {
    stage: 'authorize',
    what: 'I am sealing the exact one-job authorization.',
    meaning: 'The job cannot widen its paths, operations, limits, or objective after this point.',
    next: 'Execute the smallest coherent change.'
  },
  execute_change: {
    stage: 'run',
    what: 'I am executing only the sealed work.',
    meaning: 'Writes remain snapshotted, atomic, budgeted, logged, and reversible.',
    next: 'Evaluate the recorded verification proof.'
  },
  evaluate_verification: {
    stage: 'verify',
    what: 'I am evaluating what the checks actually proved.',
    meaning: 'Failed, skipped, and inconclusive checks cannot become success.',
    next: 'Record the truthful terminal result.'
  },
  finalize: {
    stage: 'complete',
    what: 'I am recording the terminal result.',
    meaning: 'The final status must be backed by the durable journal and evidence.',
    next: 'Return control to the conversation.'
  }
};

function initialState(job: AgentJobRecord): AgentRuntimeSnapshot {
  const candidate = job.runtimeState as Partial<AgentRuntimeSnapshot>;
  if (candidate.schemaVersion === 1 && Array.isArray(candidate.completedActions)) {
    return {
      ...candidate,
      schemaVersion: 1,
      completedActions: candidate.completedActions.filter(
        (action): action is AgentRuntimeAction => AGENT_ACTION_SEQUENCE.includes(action as AgentRuntimeAction)
      ),
      transitionCount: Number(candidate.transitionCount || 0)
    };
  }
  return {
    schemaVersion: 1,
    completedActions: [],
    transitionCount: 0,
    objective: job.objective
  };
}

function loadState(job: AgentJobRecord): AgentRuntimeSnapshot {
  const checkpoint = getAgentJobCheckpoint(job.id);
  if (checkpoint && checkpoint.stateVersion >= job.stateVersion) {
    return initialState({ ...job, runtimeState: checkpoint.state, stateVersion: checkpoint.stateVersion });
  }
  return initialState(job);
}

function selectNextAction(state: AgentRuntimeSnapshot): AgentRuntimeAction | null {
  return AGENT_ACTION_SEQUENCE.find((action) => !state.completedActions.includes(action)) || null;
}

function actionKey(job: AgentJobRecord, state: AgentRuntimeSnapshot, action: AgentRuntimeAction): string {
  const revision = Number(state.planRevision || 0);
  const attempt = Number(state.attempt || 0);
  return `${job.id}-${action}-r${revision}-a${attempt}`;
}

function coarseStatus(terminal: AgentJobTerminalState): AgentJobRecord['status'] {
  if (terminal === 'completed' || terminal === 'completed_with_limits') return 'completed';
  if (terminal === 'cancelled') return 'cancelled';
  if (terminal === 'interrupted') return 'interrupted';
  return 'failed';
}

function terminalStage(terminal: AgentJobTerminalState): AgentJobStage {
  return terminal === 'completed' || terminal === 'completed_with_limits' ? 'complete' : 'blocked';
}

function terminalMessage(terminal: AgentJobTerminalState): string {
  const messages: Record<AgentJobTerminalState, string> = {
    completed: 'The job completed with verified evidence.',
    completed_with_limits: 'The authorized work completed, with named verification limits.',
    blocked_for_user: 'Joe needs a material user decision or authority before continuing.',
    failed_safe: 'Joe stopped safely because it could not prove a safe next action.',
    cancelled: 'The job stopped at a committed safety boundary.',
    interrupted: 'The service interrupted this job; it can resume from its checkpoint.'
  };
  return messages[terminal];
}

function recordTerminal(
  job: AgentJobRecord,
  state: AgentRuntimeSnapshot,
  terminal: AgentJobTerminalState,
  reason: string,
  action: AgentRuntimeAction | 'runtime'
): AgentJobRecord {
  const key = `${job.id}-terminal-${terminal}`;
  appendAgentJobJournal({
    jobId: job.id,
    kind: 'terminal',
    stage: terminalStage(terminal),
    actionKey: key,
    payload: { terminal, reason, action, stateVersion: job.stateVersion }
  });
  appendAgentJobEvent({
    jobId: job.id,
    stage: terminalStage(terminal),
    kind: terminal === 'completed' || terminal === 'completed_with_limits' ? 'result' : 'failure',
    what: terminalMessage(terminal),
    meaning: reason,
    next: terminal === 'interrupted' ? 'Resume this job from its last checkpoint.' : 'Review the recorded result.',
    payload: { terminal, reason }
  });
  return updateAgentJob(job.id, {
    status: coarseStatus(terminal),
    terminalState: terminal,
    stage: terminalStage(terminal),
    message: terminalMessage(terminal),
    errorCode: terminal === 'completed' || terminal === 'completed_with_limits' ? null : job.errorCode,
    errorMessage: terminal === 'completed' || terminal === 'completed_with_limits' ? null : reason,
    finishedAt: Date.now(),
    lastHeartbeatAt: Date.now()
  });
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return 'AGENT_RUNTIME_FAILED_SAFE';
}

export async function runAgentRuntimeStep(jobId: string, driver: AgentRuntimeDriver): Promise<AgentRuntimeStepResult> {
  let job = getAgentJob(jobId);
  if (!job) throw new Error(`AGENT_JOB_NOT_FOUND: ${jobId}`);
  if (job.terminalState && job.status !== 'interrupted') {
    return { job, action: null, recoveredResult: false, terminal: true };
  }
  if (job.status === 'interrupted') {
    throw new Error('AGENT_JOB_INTERRUPTED_REQUIRES_RESUME');
  }
  if (job.stopRequested) {
    job = recordTerminal(job, loadState(job), 'cancelled', 'The operator requested a stop.', 'runtime');
    return { job, action: null, recoveredResult: false, terminal: true };
  }

  const state = loadState(job);
  const action = selectNextAction(state);
  if (!action) {
    const terminal = (state.terminalState as AgentJobTerminalState | undefined) || 'failed_safe';
    const reason = String(state.terminalReason || 'The runtime exhausted its actions without a terminal proof.');
    job = recordTerminal(job, state, terminal, reason, 'runtime');
    return { job, action: null, recoveredResult: false, terminal: true };
  }

  const presentation = ACTION_PRESENTATION[action];
  const key = actionKey(job, state, action);
  job = updateAgentJob(job.id, {
    status: 'running',
    terminalState: null,
    stage: presentation.stage,
    message: presentation.what,
    startedAt: job.startedAt || Date.now(),
    finishedAt: null,
    lastHeartbeatAt: Date.now(),
    errorCode: null,
    errorMessage: null
  });
  appendAgentJobJournal({
    jobId,
    kind: 'turn',
    stage: presentation.stage,
    actionKey: `${key}-turn`,
    payload: { action, transition: state.transitionCount + 1 }
  });
  appendAgentJobEvent({
    jobId,
    stage: presentation.stage,
    kind: 'progress',
    what: presentation.what,
    meaning: presentation.meaning,
    next: presentation.next,
    payload: { action, actionKey: key }
  });

  let outcome: AgentActionOutcome;
  let recoveredResult = false;
  const priorResult = getAgentJobJournalEntry(jobId, 'tool_result', key);
  try {
    if (priorResult) {
      outcome = priorResult.payload as AgentActionOutcome;
      recoveredResult = true;
    } else {
      appendAgentJobJournal({
        jobId,
        kind: 'tool_request',
        stage: presentation.stage,
        actionKey: key,
        payload: { action, actionKey: key }
      });
      outcome = await driver.execute({ job, state, action, actionKey: key });
      appendAgentJobJournal({
        jobId,
        kind: 'tool_result',
        stage: presentation.stage,
        actionKey: key,
        payload: outcome,
        evidenceId: outcome.evidenceId || null
      });
    }
  } catch (error: unknown) {
    const code = errorCode(error);
    const reason = error instanceof Error ? error.message : String(error);
    updateAgentJob(jobId, { errorCode: code, errorMessage: reason });
    job = recordTerminal(getAgentJob(jobId)!, state, 'failed_safe', reason, action);
    return { job, action, recoveredResult, terminal: true };
  }

  for (const journal of outcome.journals || []) {
    appendAgentJobJournal({
      jobId,
      kind: journal.kind,
      stage: presentation.stage,
      actionKey: `${key}-${journal.kind}`,
      payload: journal.payload,
      evidenceId: journal.evidenceId || null
    });
  }

  const nextState: AgentRuntimeSnapshot = {
    ...state,
    ...(outcome.statePatch || {}),
    schemaVersion: 1,
    completedActions: [...state.completedActions, action],
    transitionCount: state.transitionCount + 1,
    ...(outcome.terminalState ? {
      terminalState: outcome.terminalState,
      terminalReason: outcome.terminalReason || terminalMessage(outcome.terminalState)
    } : {})
  };
  const nextAction = selectNextAction(nextState);
  const terminal = outcome.terminalState || (action === 'finalize'
    ? (nextState.terminalState as AgentJobTerminalState | undefined)
    : undefined);
  const patch: Parameters<typeof commitAgentJobCheckpoint>[0]['patch'] = {
    ...(outcome.jobPatch || {}),
    status: terminal ? coarseStatus(terminal) : 'running',
    terminalState: terminal || null,
    stage: terminal ? terminalStage(terminal) : ACTION_PRESENTATION[nextAction || 'finalize'].stage,
    message: terminal ? terminalMessage(terminal) : ACTION_PRESENTATION[nextAction || 'finalize'].what,
    lastHeartbeatAt: Date.now(),
    finishedAt: terminal ? Date.now() : null
  };
  job = commitAgentJobCheckpoint({
    jobId,
    state: nextState,
    lastCompletedAction: key,
    patch
  });
  if (terminal) {
    job = recordTerminal(job, nextState, terminal, String(nextState.terminalReason || terminalMessage(terminal)), action);
  }
  return { job, action, recoveredResult, terminal: Boolean(terminal) };
}

export async function runDurableAgentRuntime(
  jobId: string,
  driver: AgentRuntimeDriver,
  maxTransitions = 32
): Promise<AgentJobRecord> {
  for (let transition = 0; transition < maxTransitions; transition += 1) {
    const step = await runAgentRuntimeStep(jobId, driver);
    if (step.terminal) return step.job;
  }
  const job = getAgentJob(jobId);
  if (!job) throw new Error(`AGENT_JOB_NOT_FOUND: ${jobId}`);
  return recordTerminal(
    job,
    loadState(job),
    'failed_safe',
    `The durable runtime stopped after ${maxTransitions} transitions to prevent a no-progress loop.`,
    'runtime'
  );
}


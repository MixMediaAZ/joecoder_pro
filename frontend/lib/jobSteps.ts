import type { AgentJob } from './backendTypes'

/** The job's workflow as the operator sees it. Each step maps to real runtime actions. */
export type StepId = 'survey' | 'plan' | 'review' | 'approve' | 'build' | 'test' | 'report'
export type StepState = 'done' | 'current' | 'waiting' | 'pending' | 'failed' | 'stopped' | 'skipped'
export interface JobStep { id: StepId; label: string; state: StepState; actions: string[] }

const STEP_DEFS: Array<{ id: StepId; label: string; actions: string[] }> = [
  { id: 'survey', label: 'Survey', actions: ['capture_objective', 'establish_evidence'] },
  { id: 'plan', label: 'Plan', actions: ['produce_plan'] },
  { id: 'review', label: 'Peer review', actions: ['review_plan'] },
  { id: 'approve', label: 'Your approval', actions: [] },
  { id: 'build', label: 'Build', actions: ['seal_authorization', 'execute_change'] },
  { id: 'test', label: 'Test', actions: ['evaluate_verification'] },
  { id: 'report', label: 'Report', actions: ['finalize'] },
]

export const PLAN_APPROVAL_CODE = 'PLAN_APPROVAL_REQUIRED'
export const isAwaitingApproval = (job: AgentJob | null | undefined) =>
  Boolean(job && job.status === 'interrupted' && job.errorCode === PLAN_APPROVAL_CODE)
export const isLive = (job: AgentJob | null | undefined) => Boolean(job && ['queued', 'running'].includes(job.status))

/**
 * Derives step states from the job's committed actions (runtimeState.completedActions), which the
 * server checkpoints after every action. Review and approval appear only when the job asked for them.
 */
export function jobSteps(job: AgentJob): JobStep[] {
  const state = job.runtimeState || {}
  const completed = new Set(state.completedActions || [])
  const defs = STEP_DEFS.filter(step => (step.id !== 'review' || state.reviewRequested) && (step.id !== 'approve' || state.approvalMode === 'plan'))
  const waiting = isAwaitingApproval(job)
  const finished = job.status === 'completed'
  const ended = ['failed', 'cancelled'].includes(job.status) || (job.status === 'interrupted' && !waiting)
  const stepDone = (step: typeof defs[number]) => step.id === 'approve'
    ? Boolean(state.planApproved)
    : step.actions.every(action => completed.has(action))
  // A read-only job runs the same governed stages, but nothing is built.
  const readOnly = job.intent === 'inspect'
  const label = (step: typeof defs[number]) => readOnly && step.id === 'build' ? 'Read-only run' : readOnly && step.id === 'plan' ? 'Scope' : step.label
  let markedCurrent = false
  return defs.map(raw => {
    const step = { ...raw, label: label(raw) }
    if (stepDone(step) || (finished && step.id !== 'approve')) return { ...step, state: 'done' as StepState }
    if (markedCurrent) return { ...step, state: (ended ? 'skipped' : 'pending') as StepState }
    markedCurrent = true
    if (waiting && step.id === 'approve') return { ...step, state: 'waiting' as StepState }
    if (finished) return { ...step, state: 'skipped' as StepState }
    if (job.status === 'cancelled') return { ...step, state: 'stopped' as StepState }
    if (ended) return { ...step, state: 'failed' as StepState }
    return { ...step, state: 'current' as StepState }
  })
}

/** The step the detail pane should follow when the operator has not picked one. */
export function focusStep(steps: JobStep[]): StepId {
  return (steps.find(step => ['current', 'waiting', 'failed', 'stopped'].includes(step.state)) || steps[steps.length - 1]).id
}

export const STEP_STATE_TEXT: Record<StepState, string> = {
  done: 'Done', current: 'In progress', waiting: 'Needs you', pending: 'Not started',
  failed: 'Did not finish', stopped: 'Stopped', skipped: 'Not reached',
}

export type Intent = 'ask' | 'plan' | 'survey' | 'fix' | 'feature' | 'refactor'
export const INTENTS: Array<{ id: Intent; label: string; send: string; changesCode: boolean; prefix: string; caption: string; placeholder: string }> = [
  { id: 'ask', label: 'Ask', send: 'Ask', changesCode: false, prefix: '', caption: 'Joe answers from the project. Nothing changes.', placeholder: 'Ask about this project…' },
  { id: 'plan', label: 'Plan', send: 'Plan', changesCode: false, prefix: '', caption: 'Joe writes a step-by-step plan. Nothing changes.', placeholder: 'What should Joe plan?' },
  { id: 'survey', label: 'Survey', send: 'Start survey', changesCode: false, prefix: 'Survey and report (read-only): ', caption: 'Joe inspects the build read-only and reports its condition and next work.', placeholder: 'Optional: what to focus on…' },
  { id: 'fix', label: 'Fix', send: 'Start fix', changesCode: true, prefix: 'Fix: ', caption: 'Joe surveys, plans, gets a peer review, then waits for your approval before changing files.', placeholder: 'What is broken, and what should happen instead?' },
  { id: 'feature', label: 'Add feature', send: 'Start feature', changesCode: true, prefix: 'Add feature: ', caption: 'Joe surveys, plans, gets a peer review, then waits for your approval before changing files.', placeholder: 'Describe the feature and how you will know it works…' },
  { id: 'refactor', label: 'Refactor', send: 'Start refactor', changesCode: true, prefix: 'Refactor without changing behavior: ', caption: 'Joe surveys, plans, gets a peer review, then waits for your approval before changing files.', placeholder: 'What should be restructured, and why?' },
]
export const intentFor = (id: Intent) => INTENTS.find(item => item.id === id) || INTENTS[0]
/** Recovers the workflow name from a job objective created by this UI. */
export const objectiveIntent = (objective: string) => INTENTS.find(item => item.prefix && objective.startsWith(item.prefix))

'use client'

import { Ban, Check, Circle, Hourglass, Loader2, MinusCircle, Square, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { AgentJob } from '../../lib/backendTypes'
import { isAwaitingApproval, isLive, jobSteps, objectiveIntent, STEP_STATE_TEXT, type StepId, type StepState } from '../../lib/jobSteps'
import { jobStatusLabel } from '../../lib/workflow'

const ICONS: Record<StepState, typeof Check> = { done: Check, current: Loader2, waiting: Hourglass, pending: Circle, failed: XCircle, stopped: Ban, skipped: MinusCircle }

/** One job as a run sheet: the workflow steps with their real state, and the approval gate when the job is paused. */
export function JobRun({ job, selected, onSelect, onDecide, onStop, onRevise }: {
  job: AgentJob; selected: StepId | null; onSelect: (step: StepId) => void
  onDecide: (decision: 'approve' | 'discard') => Promise<void>; onStop: () => Promise<void>; onRevise: (request: string) => void
}) {
  const steps = jobSteps(job)
  const workflow = objectiveIntent(job.objective)
  const request = workflow ? job.objective.slice(workflow.prefix.length) : job.objective
  const waiting = isAwaitingApproval(job), live = isLive(job)
  const [pending, setPending] = useState<'' | 'approve' | 'discard' | 'stop'>('')
  const act = (kind: 'approve' | 'discard' | 'stop', action: () => Promise<void>) => { setPending(kind); void action().finally(() => setPending('')) }
  return <article className={`job-run ${waiting ? 'is-waiting' : ''}`} aria-label={`Job: ${request}`}>
    <header>
      <span className="job-kind">{workflow?.label || (job.intent === 'inspect' ? 'Survey' : 'Job')}</span>
      <p className="job-request">{request}</p>
      <span className={`job-status status-${waiting ? 'waiting' : job.status}`} role="status">{waiting ? 'Waiting for your approval' : jobStatusLabel(job.status)}</span>
    </header>
    <ol className="run-steps">{steps.map(step => {
      const Icon = ICONS[step.state]
      return <li key={step.id} className={`run-step state-${step.state}`}>
        <button aria-pressed={selected === step.id} onClick={() => onSelect(step.id)}>
          <Icon size={15} aria-hidden="true" className={step.state === 'current' ? 'spin' : ''} />
          <span className="step-label">{step.label}</span>
          <span className="step-state">{STEP_STATE_TEXT[step.state]}</span>
        </button>
        {step.state === 'current' && job.message && <p className="step-live">{job.message}</p>}
      </li>
    })}</ol>
    {waiting && <div className="approval-gate" role="group" aria-label="Plan approval">
      <p><strong>The plan is ready.</strong> Read the plan and the peer review, then approve to let Joe change files. Nothing has changed yet.</p>
      <div className="gate-actions">
        <button className="approve" disabled={Boolean(pending)} onClick={() => act('approve', () => onDecide('approve'))}>{pending === 'approve' ? 'Starting…' : 'Approve and build'}</button>
        <button disabled={Boolean(pending)} onClick={() => onSelect('plan')}>Read the plan</button>
        <button disabled={Boolean(pending)} onClick={() => { act('discard', () => onDecide('discard')); onRevise(request) }}>Change the request</button>
        <button className="quiet" disabled={Boolean(pending)} onClick={() => act('discard', () => onDecide('discard'))}>{pending === 'discard' ? 'Discarding…' : 'Discard'}</button>
      </div>
    </div>}
    {live && <div className="run-footer"><button disabled={Boolean(pending) || Boolean((job as { stopRequested?: boolean }).stopRequested)} onClick={() => act('stop', onStop)}><Square size={11} /> {pending === 'stop' ? 'Stopping…' : 'Stop'}</button></div>}
    {!live && !waiting && job.errorMessage && <p className="panel-error">{job.errorMessage}</p>}
  </article>
}

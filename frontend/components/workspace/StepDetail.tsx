'use client'

import type { AgentJob, PlanReview } from '../../lib/backendTypes'
import { useJobContext } from '../../contexts/JobContext'
import { isAwaitingApproval, isLive, jobSteps, STEP_STATE_TEXT, type StepId } from '../../lib/jobSteps'
import { useResource, type JobDetail } from './data'
import { JobChanges } from './JobChanges'
import { JobActivity } from './WorkPanels'
import { Message } from './Message'

type Journal = JobDetail['journal'][number]
type Event = JobDetail['events'][number]
interface PlanPayload {
  objective?: string; scope?: { exactPaths?: string[]; operations?: string[] }
  acceptance?: Array<{ id?: string; criterion?: string; mandatory?: boolean }>
  workingPlan?: { intendedChanges?: string[]; risks?: string[]; rollbackMethod?: string; verificationCommands?: string[] }
}
const ACTION_STEP: Record<string, StepId> = {
  capture_objective: 'survey', establish_evidence: 'survey', produce_plan: 'plan', review_plan: 'review',
  seal_authorization: 'build', execute_change: 'build', evaluate_verification: 'test', finalize: 'report',
}
const STAGE_STEP: Record<string, StepId> = { understand: 'survey', inspect: 'survey', plan: 'plan', authorize: 'build', run: 'build', verify: 'test', complete: 'report', blocked: 'report' }
function eventStep(event: Event): StepId {
  if (/plan is ready for your approval|approved the plan/i.test(event.what)) return 'approve'
  const action = typeof event.payload?.action === 'string' ? event.payload.action : ''
  return ACTION_STEP[action] || STAGE_STEP[event.stage] || 'report'
}
const OPERATIONS: Record<string, string> = {
  read_files: 'Read files', edit_files: 'Edit files', create_files: 'Create files', rename_files: 'Rename files', delete_files: 'Delete files',
  run_tests: 'Run checks', run_app: 'Run the app', install_dependencies: 'Install dependencies', export_handoff: 'Write a report',
}
const FINDING_KIND: Record<string, string> = { fact: 'Verified facts', assumption: 'Assumptions', unknown: 'Unknowns', risk: 'Risks' }
const VERDICT: Record<string, string> = { proceed: 'Looks sound', proceed_with_cautions: 'Sound, with cautions', revise: 'Should be revised' }

function List({ items, empty }: { items?: string[]; empty: string }) {
  return items?.length ? <ul className="detail-list">{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted">{empty}</p>
}

function PlanView({ plan }: { plan: PlanPayload | null }) {
  if (!plan) return <p className="muted">No plan is recorded for this job yet.</p>
  const files = plan.scope?.exactPaths || []
  return <>
    <section><h3>What Joe will do</h3><List items={plan.workingPlan?.intendedChanges} empty="No change description was recorded." /></section>
    <section><h3>Files it may touch ({files.length})</h3>{files.length ? <ul className="file-chips">{files.map(file => <li key={file}><code>{file}</code></li>)}</ul> : <p className="muted">No file scope was recorded.</p>}</section>
    <section><h3>Allowed actions</h3><List items={(plan.scope?.operations || []).map(item => OPERATIONS[item] || item.replaceAll('_', ' '))} empty="None recorded." /></section>
    <section><h3>Done means</h3><List items={(plan.acceptance || []).map(item => `${item.criterion || item.id}${item.mandatory === false ? ' (optional)' : ''}`)} empty="No acceptance checks were recorded." /></section>
    <section><h3>How it will be checked</h3><List items={plan.workingPlan?.verificationCommands} empty="No runnable check was found in this project. The result will say so." /></section>
    <section><h3>Risks</h3><List items={plan.workingPlan?.risks} empty="None recorded." /></section>
    {plan.workingPlan?.rollbackMethod && <section><h3>If it goes wrong</h3><p>{plan.workingPlan.rollbackMethod}</p></section>}
  </>
}

function ReviewView({ review, requested }: { review?: PlanReview; requested: boolean }) {
  if (!requested) return <p className="muted">This job did not request a peer review.</p>
  if (!review) return <p className="muted">The peer review has not run yet.</p>
  if (review.status === 'unavailable') return <div className="review-unavailable"><p><strong>The peer review could not run.</strong></p><p className="muted">{review.reason}</p><p>The plan is unchanged. Read it yourself before approving.</p></div>
  const groups = ['risk', 'unknown', 'assumption', 'fact'].map(kind => ({ kind, items: review.findings.filter(item => item.kind === kind) })).filter(group => group.items.length)
  return <>
    <p className={`verdict verdict-${review.verdict}`}><strong>{VERDICT[review.verdict] || review.verdict}</strong></p>
    <p>{review.summary}</p>
    {groups.map(group => <section key={group.kind}><h3>{FINDING_KIND[group.kind]}</h3><ul className="detail-list findings">{group.items.map((item, index) => <li key={index} className={`severity-${item.severity}`}><span className="severity">{item.severity}</span>{item.text}</li>)}</ul></section>)}
    {!groups.length && <p className="muted">The reviewer reported no findings.</p>}
    <p className="muted">Reviewed by {review.provider} / {review.model}</p>
  </>
}

export function StepDetail({ job, step, onDecide }: { job: AgentJob; step: StepId; onDecide: (decision: 'approve' | 'discard') => Promise<void> }) {
  const { surveyEvidence } = useJobContext()
  const live = isLive(job)
  const detail = useResource<JobDetail>(`/api/v1/agent-jobs/${encodeURIComponent(job.id)}`, live ? 3000 : 0)
  const info = jobSteps(job).find(item => item.id === step)
  const journal: Journal[] = detail.data?.journal || []
  const latest = (predicate: (entry: Journal) => boolean) => journal.filter(predicate).at(-1)
  const plan = (latest(entry => entry.kind === 'plan_revision')?.payload || null) as PlanPayload | null
  const ledger = (latest(entry => entry.kind === 'decision' && (entry.payload as { decision?: string })?.decision === 'evidence_ledger_updated')?.payload as { hypotheses?: { knownFacts?: string[]; inferences?: string[]; unknowns?: string[] } } | undefined)?.hypotheses
  const events = (detail.data?.events || []).filter(event => eventStep(event) === step)
  return <div className="step-detail">
    <header><h2>{info?.label || step}</h2>{info && <span className={`step-pill state-${info.state}`}>{STEP_STATE_TEXT[info.state]}</span>}</header>
    {detail.loading && !detail.data && <p role="status" className="muted">Loading the job record…</p>}
    {detail.error && <p role="alert" className="panel-error">{detail.error} <button onClick={detail.refresh}>Try again</button></p>}

    {step === 'survey' && <>
      {ledger && <><section><h3>Found</h3><List items={ledger.knownFacts} empty="No facts recorded." /></section>
        <section><h3>Not yet known</h3><List items={ledger.unknowns} empty="Nothing open." /></section></>}
      {surveyEvidence?.content.findings && <section><h3>Latest project survey</h3>{Object.entries(surveyEvidence.content.findings).map(([group, findings]) => <details key={group}><summary>{group}</summary>{findings.map((finding, index) => <Message key={index} content={finding} />)}</details>)}</section>}
    </>}
    {step === 'plan' && <PlanView plan={plan} />}
    {step === 'review' && <ReviewView review={job.runtimeState?.review} requested={Boolean(job.runtimeState?.reviewRequested)} />}
    {step === 'approve' && <>
      {isAwaitingApproval(job) ? <div className="approval-gate">
        <p><strong>Approve to let Joe change files.</strong> Joe will protect the files in the plan, make the change, run the checks, and report. You can stop it at any point.</p>
        <div className="gate-actions"><button className="approve" onClick={() => void onDecide('approve')}>Approve and build</button><button className="quiet" onClick={() => void onDecide('discard')}>Discard</button></div>
      </div> : <p>{job.runtimeState?.planApproved ? 'You approved this plan.' : 'This job has not reached approval.'}</p>}
      <PlanView plan={plan} />
    </>}
    {step === 'build' && <JobChanges key={job.id} jobId={job.id} />}
    {step === 'test' && <JobActivity jobId={job.id} output live={live} />}
    {step === 'report' && <>
      <p>{job.status === 'completed' ? job.message : job.errorMessage || job.message || 'The job has not finished.'}</p>
      {job.result?.verification?.status && <p>Check result: {job.result.verification.status.replaceAll('_', ' ')}{job.result.verification.detail ? `. ${job.result.verification.detail}` : ''}</p>}
    </>}

    {events.length > 0 && <section className="step-events"><h3>What happened</h3><ol className="job-events">{events.map(event => <li key={event.ordinal} className={event.kind === 'failure' ? 'event-failure' : ''}><span className="event-dot" /><div><strong>{event.what}</strong>{event.meaning && <p>{event.meaning}</p>}<time>{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div></li>)}</ol></section>}
  </div>
}

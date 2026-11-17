'use client'

import { useState } from 'react'
import { JobChanges } from './JobChanges'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useJobContext } from '../../contexts/JobContext'
import { useResource, type JobDetail } from './data'
import { Evidence } from './ProjectPanels'
import { Message } from './Message'
import type { AgentJob } from '../../lib/backendTypes'
import { DiffLines } from './DiffLines'
import { jobStageLabel, jobStatusLabel } from '../../lib/workflow'

export function ChangesPanel({ projectId }: { projectId: string }) {
  const [file, setFile] = useState('')
  const base = `/api/v1/projects/${projectId}/changes`
  const changes = useResource<{ files: Array<{ path: string; untracked: boolean }>; truncated: boolean }>(base)
  const diff = useResource<{ diff: string; baseline: string; currentSha256: string }>(file ? `${base}?path=${encodeURIComponent(file)}` : null)
  return <div className="panel-body"><div className="panel-toolbar"><button disabled={!file} onClick={() => setFile('')}><ArrowLeft size={14} /> Changes</button><button aria-label="Refresh changes" onClick={() => { changes.refresh(); diff.refresh() }}><RefreshCw size={15} /></button></div><p className="muted">All uncommitted edits in the project, compared with the last Git commit (HEAD). Read only. To undo a specific job, use “Files changed by this job” on its card.</p>
    {(file ? diff : changes).loading && <p role="status">Reading changes…</p>}{(file ? diff : changes).error && <p role="alert" className="panel-error">{(file ? diff : changes).error}</p>}
    {!file && <div className="file-list">{changes.data?.files.map(item => <button key={item.path} onClick={() => setFile(item.path)}><span>{item.path}</span><small>{item.untracked ? 'New' : 'Modified'}</small></button>)}</div>}
    {!file && changes.data && !changes.data.files.length && <p className="panel-notice">No reviewable working changes.</p>}
    {changes.data?.truncated && <p className="panel-notice">Showing the first 500 changed files.</p>}
    {file && diff.data && <><h3>{file}</h3><p className="muted">Baseline: {diff.data.baseline}</p><DiffLines diff={diff.data.diff} empty="No changes against HEAD." /><details><summary>Current content fingerprint</summary><code>{diff.data.currentSha256}</code></details></>}
  </div>
}

type Tone = 'ok' | 'fail' | 'info'
const field = (value: unknown, key: string) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
/** One plain sentence describing a recorded result; raw payload stays under Technical details. */
function recordSummary(kind: string, payload: unknown): { text: string; tone: Tone } {
  if (kind === 'tool_result' && field(payload, 'command') !== undefined) {
    const command = [field(payload, 'command'), ...((field(payload, 'args') as unknown[]) || [])].map(String).join(' ')
    const exit = field(payload, 'exitCode')
    if (field(payload, 'cancelled')) return { text: `Command stopped: ${command}`, tone: 'fail' }
    if (field(payload, 'timedOut')) return { text: `Command timed out: ${command}`, tone: 'fail' }
    return { text: `${exit === 0 ? 'Passed' : `Failed (exit ${String(exit)})`}: ${command}`, tone: exit === 0 ? 'ok' : 'fail' }
  }
  if (kind === 'verification') {
    const state = String(field(payload, 'terminalState') ?? 'unknown').replaceAll('_', ' ')
    const reason = field(payload, 'reason')
    return { text: `Check outcome: ${state}${typeof reason === 'string' && reason ? ` — ${reason}` : ''}`, tone: /^completed$/.test(String(field(payload, 'terminalState'))) ? 'ok' : 'info' }
  }
  if (kind === 'terminal') {
    const terminal = String(field(payload, 'terminal') ?? 'unknown')
    const reason = field(payload, 'reason')
    return { text: `Job ended: ${terminal.replaceAll('_', ' ')}${typeof reason === 'string' && reason ? ` — ${reason}` : ''}`, tone: terminal === 'completed' ? 'ok' : terminal.startsWith('completed') ? 'info' : 'fail' }
  }
  const action = field(payload, 'action')
  return { text: typeof action === 'string' ? `Recorded result: ${action.replaceAll('_', ' ')}` : 'Recorded tool result', tone: 'info' }
}

export function JobActivity({ jobId, output = false, live = false }: { jobId: string; output?: boolean; live?: boolean }) {
  const result = useResource<JobDetail>(`/api/v1/agent-jobs/${jobId}`, live ? 3000 : 0)
  const budget = result.data?.workflowBudget
  return <>{budget && <p className="muted">Model calls: {budget.modelTurns}{budget.limits ? `/${budget.limits.modelTurns}` : ''} · Tool actions: {budget.toolActions}{budget.limits ? `/${budget.limits.toolActions}` : ''} · Cloud used or reserved: ${budget.spentOrReservedUsd.toFixed(3)} of ${budget.cloudLimitUsd.toFixed(2)}</p>}{result.loading && <p role="status" className="muted">Loading recorded activity…</p>}{result.error && <p className="panel-error" role="alert">{result.error} {live ? 'Retrying automatically.' : <button onClick={result.refresh}>Retry</button>}</p>}
    {output ? <div className="output-records">{result.data?.journal.filter(item => ['tool_result', 'verification', 'terminal'].includes(item.kind)).map(item => <details key={item.ordinal}><summary><span className={`record-${recordSummary(item.kind, item.payload).tone}`}>{recordSummary(item.kind, item.payload).text}</span> · {jobStageLabel(item.stage)} · {new Date(item.createdAt).toLocaleTimeString()}</summary><details className="technical"><summary>Technical details</summary><pre>{JSON.stringify(item.payload, null, 2)}</pre></details>{item.evidenceId && <details><summary>Evidence</summary><Evidence id={item.evidenceId} /></details>}</details>)}{result.data && !result.data.journal.some(item => ['tool_result', 'verification', 'terminal'].includes(item.kind)) && <p className="panel-notice">No command results or verification output have been recorded for this job.</p>}</div>
      : <ol className="job-events">{result.data?.events.map(event => <li key={event.ordinal} className={event.kind === 'failure' ? 'event-failure' : ''}><span className="event-dot" /><div><strong>{event.what}</strong>{event.meaning && <p>{event.meaning}</p>}{event.next && <small>Next: {event.next}</small>}</div></li>)}</ol>}
  </>
}

export function JobCard({ job }: { job: AgentJob }) {
  const live = ['running', 'queued'].includes(job.status)
  const [expanded, setExpanded] = useState(live || job.status === 'interrupted')
  const [showChanges, setShowChanges] = useState(false)
  return <article className="job-card"><div className="job-card-header"><span className={`status-dot ${job.status}`} /><strong>{jobStatusLabel(job.status)}</strong><span>{jobStageLabel(job.stage)}</span></div><p className="job-objective">{job.objective}</p><p className={job.errorMessage ? 'panel-error' : 'muted'}>{job.errorMessage || job.message}</p><details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>Activity and decisions</summary>{expanded && <JobActivity jobId={job.id} live={live} />}</details><details open={showChanges} onToggle={event => setShowChanges(event.currentTarget.open)}><summary>Files changed by this job</summary>{showChanges && <JobChanges key={job.id} jobId={job.id} />}</details>{job.result?.verification?.status && <p>Check result: {job.result.verification.status.replaceAll('_', ' ')}{job.result.verification.detail ? ` — ${job.result.verification.detail}` : ''}</p>}</article>
}

export function PlanPanel() {
  const { workOrders, surveys, surveyEvidence } = useJobContext()
  return <div className="panel-body"><h3>Inspection</h3>{surveyEvidence ? <><p>{surveyEvidence.content.buildCondition?.replaceAll('_', ' ') || 'Condition not established'}</p>{Object.entries(surveyEvidence.content.findings || {}).map(([group, findings]) => <section key={group}><h4>{group}</h4>{findings.map((finding, index) => <Message key={index} content={finding} />)}</section>)}</> : <p className="muted">No inspection evidence recorded yet.</p>}
    <h3>Plans and bounded work</h3>{!workOrders.length && <p className="muted">Work plans appear here when a job creates them.</p>}{workOrders.map(order => <details key={order.id}><summary>{order.objective} · {order.status}</summary><p>{order.intent}</p><h4>Authorized scope</h4><pre>{order.scope.exactPaths.join('\n') || 'No exact file scope recorded'}</pre><p>{order.scope.operations.join(', ')}</p>{order.evidenceIds?.map(id => <details key={id}><summary>{id}</summary><Evidence id={id} /></details>)}</details>)}
    <h3>Inspection history</h3>{surveys.map(survey => <details key={survey.id}><summary>{survey.summary || survey.id}</summary><Evidence id={survey.id} /></details>)}
  </div>
}

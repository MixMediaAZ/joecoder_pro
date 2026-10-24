'use client'

import { useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useJobContext } from '../../contexts/JobContext'
import { useResource, type JobDetail } from './data'
import { Evidence } from './ProjectPanels'
import { Message } from './Message'
import type { AgentJob } from '../../lib/backendTypes'

export function ChangesPanel({ projectId }: { projectId: string }) {
  const [file, setFile] = useState('')
  const base = `/api/v1/projects/${projectId}/changes`
  const changes = useResource<{ files: Array<{ path: string; untracked: boolean }>; truncated: boolean }>(base)
  const diff = useResource<{ diff: string; baseline: string; currentSha256: string }>(file ? `${base}?path=${encodeURIComponent(file)}` : null)
  return <div className="panel-body"><div className="panel-toolbar"><button disabled={!file} onClick={() => setFile('')}><ArrowLeft size={14} /> Changes</button><button aria-label="Refresh changes" onClick={() => { changes.refresh(); diff.refresh() }}><RefreshCw size={15} /></button></div><p className="muted">Working files compared with HEAD · read only</p>
    {(file ? diff : changes).loading && <p role="status">Reading changes…</p>}{(file ? diff : changes).error && <p role="alert" className="panel-error">{(file ? diff : changes).error}</p>}
    {!file && <div className="file-list">{changes.data?.files.map(item => <button key={item.path} onClick={() => setFile(item.path)}><span>{item.path}</span><small>{item.untracked ? 'New' : 'Modified'}</small></button>)}</div>}
    {!file && changes.data && !changes.data.files.length && <p className="panel-notice">No reviewable working changes.</p>}
    {changes.data?.truncated && <p className="panel-notice">Showing the first 500 changed files.</p>}
    {file && diff.data && <><h3>{file}</h3><p className="muted">Baseline: {diff.data.baseline}</p><pre className="diff-source">{diff.data.diff ? diff.data.diff.split('\n').map((line, index) => <div key={index} className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : line.startsWith('@@') ? 'diff-hunk' : ''}>{line || ' '}</div>) : 'No changes against HEAD.'}</pre><details><summary>Current content fingerprint</summary><code>{diff.data.currentSha256}</code></details></>}
  </div>
}

export function JobActivity({ jobId, output = false, live = false }: { jobId: string; output?: boolean; live?: boolean }) {
  const result = useResource<JobDetail>(`/api/v1/agent-jobs/${jobId}`, live ? 3000 : 0)
  return <>{result.loading && <p role="status" className="muted">Loading recorded activity…</p>}{result.error && <p className="panel-error" role="alert">{result.error} {live ? 'Retrying automatically.' : <button onClick={result.refresh}>Retry</button>}</p>}
    {output ? <div className="output-records">{result.data?.journal.filter(item => ['tool_result', 'verification', 'terminal'].includes(item.kind)).map(item => <details key={item.ordinal} open><summary>{item.kind.replaceAll('_', ' ')} · {item.stage} · {new Date(item.createdAt).toLocaleTimeString()}</summary><pre>{JSON.stringify(item.payload, null, 2)}</pre>{item.evidenceId && <details><summary>Evidence</summary><Evidence id={item.evidenceId} /></details>}</details>)}{result.data && !result.data.journal.some(item => ['tool_result', 'verification', 'terminal'].includes(item.kind)) && <p className="panel-notice">No command results or verification output have been recorded for this job.</p>}</div>
      : <ol className="job-events">{result.data?.events.map(event => <li key={event.ordinal} className={event.kind === 'failure' ? 'event-failure' : ''}><span className="event-dot" /><div><strong>{event.what}</strong>{event.meaning && <p>{event.meaning}</p>}{event.next && <small>Next: {event.next}</small>}</div></li>)}</ol>}
  </>
}

export function JobCard({ job }: { job: AgentJob }) {
  const live = ['running', 'queued'].includes(job.status)
  const [expanded, setExpanded] = useState(live || job.status === 'interrupted')
  return <article className="job-card"><div className="job-card-header"><span className={`status-dot ${job.status}`} /><strong>{job.status === 'running' ? 'Working' : job.status}</strong><span>{job.stage}</span></div><p className="job-objective">{job.objective}</p><p className={job.errorMessage ? 'panel-error' : 'muted'}>{job.errorMessage || job.message}</p><details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>Activity and decisions</summary>{expanded && <JobActivity jobId={job.id} live={live} />}</details>{job.result?.verification?.status && <p>Verification: {job.result.verification.status}</p>}</article>
}

export function PlanPanel() {
  const { workOrders, surveys, surveyEvidence } = useJobContext()
  return <div className="panel-body"><h3>Inspection</h3>{surveyEvidence ? <><p>{surveyEvidence.content.buildCondition?.replaceAll('_', ' ') || 'Condition not established'}</p>{Object.entries(surveyEvidence.content.findings || {}).map(([group, findings]) => <section key={group}><h4>{group}</h4>{findings.map((finding, index) => <Message key={index} content={finding} />)}</section>)}</> : <p className="muted">No inspection evidence recorded yet.</p>}
    <h3>Plans and bounded work</h3>{!workOrders.length && <p className="muted">Work plans appear here when a job creates them.</p>}{workOrders.map(order => <details key={order.id}><summary>{order.objective} · {order.status}</summary><p>{order.intent}</p><h4>Authorized scope</h4><pre>{order.scope.exactPaths.join('\n') || 'No exact file scope recorded'}</pre><p>{order.scope.operations.join(', ')}</p>{order.evidenceIds?.map(id => <details key={id}><summary>{id}</summary><Evidence id={id} /></details>)}</details>)}
    <h3>Inspection history</h3>{surveys.map(survey => <details key={survey.id}><summary>{survey.summary || survey.id}</summary><Evidence id={survey.id} /></details>)}
  </div>
}

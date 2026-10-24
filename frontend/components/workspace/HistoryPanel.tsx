'use client'

import { useState } from 'react'
import { useResource } from './data'
import { JobCard } from './WorkPanels'
import type { AgentJob } from '../../lib/backendTypes'

export function HistoryPanel({ projectId, threadId }: { projectId: string; threadId: string }) {
  const [cursors, setCursors] = useState<string[]>([])
  const before = cursors.at(-1)
  const page = useResource<{ jobs: AgentJob[]; nextCursor: string | null }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}/job-history${before ? `?before=${encodeURIComponent(before)}` : ''}`
  )
  return <div className="panel-body">
    <div className="panel-toolbar"><button onClick={() => { setCursors([]); page.refresh() }}>Latest jobs</button><span>Page {cursors.length + 1}</span></div>
    <p className="muted">Recorded jobs for this conversation, newest first.</p>
    {page.loading && <p role="status">Loading job history…</p>}
    {page.error && <p className="panel-error" role="alert">{page.error} <button onClick={page.refresh}>Retry</button></p>}
    {page.data?.jobs.map(job => <JobCard key={job.id} job={job} />)}
    {page.data && !page.data.jobs.length && <p>No jobs recorded for this conversation.</p>}
    <div className="panel-toolbar"><button disabled={!cursors.length || page.loading} onClick={() => setCursors(items => items.slice(0, -1))}>Newer jobs</button><button disabled={!page.data?.nextCursor || page.loading} onClick={() => { if (page.data?.nextCursor) setCursors(items => [...items, page.data!.nextCursor!]) }}>Older jobs</button></div>
  </div>
}

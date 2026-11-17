'use client'

import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { apiRequest } from '../../lib/api'
import { useResource } from './data'
import { DiffLines } from './DiffLines'

interface ChangeList { files: Array<{ path: string; action: string }>; baseline: string }
interface ChangeReview {
  path: string; baseline: string; diff: string; truncated: boolean
  currentSha256: string; canRestore: boolean; reason: string
}
interface RevertReport { restored: string[]; skipped: Array<{ path: string; reason: string }>; stoppedAt: string | null }

export function JobChanges({ jobId }: { jobId: string }) {
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [report, setReport] = useState<RevertReport | null>(null)
  const base = '/api/v1/agent-jobs/' + encodeURIComponent(jobId)
  const listing = useResource<ChangeList>(base + '/changes')
  const review = useResource<ChangeReview>(selected ? base + '/changes?path=' + encodeURIComponent(selected) : null)
  const files = listing.data?.files || []
  async function restore() {
    if (!review.data?.canRestore || busy) return
    setBusy(true); setError(''); setMessage(''); setReport(null)
    try {
      await apiRequest(base + '/restore-file', { method: 'POST', body: JSON.stringify({
        path: selected, expectedSha256: review.data.currentSha256
      }) })
      setMessage('File restored to its state before this job. Previous verification no longer describes the current files.')
      review.refresh(); listing.refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Restore failed.')
      review.refresh()
    } finally { setBusy(false) }
  }
  // Reverts every file through the same guarded per-file restore. Each file is re-read
  // immediately before its restore so the server's change check uses the current content.
  // A request failure stops the run; files the server marks as not restorable are skipped.
  async function revertAll() {
    if (busy || !files.length) return
    if (!window.confirm(`Restore all ${files.length} file${files.length === 1 ? '' : 's'} changed by this job to their state before the job? Skipped: files this job created (removal is not supported) and files changed after the job. Each restore keeps a recovery copy.`)) return
    setBusy(true); setError(''); setMessage(''); setSelected('')
    const result: RevertReport = { restored: [], skipped: [], stoppedAt: null }
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Restoring ${index + 1} of ${files.length}: ${file.path}`)
        try {
          const current = await apiRequest<ChangeReview>(base + '/changes?path=' + encodeURIComponent(file.path))
          if (!current.canRestore) { result.skipped.push({ path: file.path, reason: current.reason || 'Not restorable.' }); continue }
          await apiRequest(base + '/restore-file', { method: 'POST', body: JSON.stringify({ path: file.path, expectedSha256: current.currentSha256 }) })
          result.restored.push(file.path)
        } catch (failure) {
          result.stoppedAt = file.path
          setError(`Stopped at ${file.path}: ${failure instanceof Error ? failure.message : 'Restore failed.'} Files after it were not touched.`)
          break
        }
      }
    } finally {
      setReport(result); setProgress(''); setBusy(false); listing.refresh()
    }
  }
  return <section aria-label="Changes from this job">
    <p className="muted">Compared with the files before this job.</p>
    <div className="panel-toolbar">
      <button disabled={busy} onClick={() => { listing.refresh(); review.refresh() }}>Refresh</button>
      {files.length > 0 && <button className="danger" disabled={busy} onClick={() => void revertAll()}><Undo2 size={14} /> Revert all {files.length} file{files.length === 1 ? '' : 's'}</button>}
    </div>
    {progress && <p role="status">{progress}</p>}
    {report && <div className="revert-report" role="status">
      <p>{report.restored.length} restored · {report.skipped.length} skipped{report.stoppedAt ? ' · stopped early' : ''}. Previous verification no longer describes the current files.</p>
      {report.skipped.length > 0 && <ul>{report.skipped.map(item => <li key={item.path}><code>{item.path}</code> — {item.reason}</li>)}</ul>}
    </div>}
    {listing.loading && <p role="status">Reading job changes.</p>}
    {listing.error && <p role="alert" className="panel-error">{listing.error}</p>}
    {!listing.loading && listing.data?.files.length === 0 && <p>No reviewable source changes were recorded.</p>}
    <div className="file-list">{files.map(file => <button key={file.path} disabled={busy}
      aria-pressed={selected === file.path} onClick={() => { setSelected(file.path); setMessage(''); setError('') }}>
      <span>{file.path}</span><small>{file.action === 'created_file' ? 'Created' : 'Edited'}</small>
    </button>)}</div>
    {selected && review.loading && <p role="status">Reading the file comparison.</p>}
    {selected && review.error && <p role="alert" className="panel-error">{review.error}</p>}
    {selected && review.data && <>
      <h4>{review.data.path}</h4>
      <DiffLines diff={review.data.diff} />
      {review.data.truncated && <p className="panel-notice">This comparison is truncated. Inspect the full file before deciding.</p>}
      <button disabled={busy || !review.data.canRestore || review.data.truncated}
        onClick={restore}>{busy ? 'Restoring file…' : 'Restore this file to before the job'}</button>
      {review.data.reason && <p className="panel-notice">{review.data.reason}</p>}
    </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="panel-error">{error}</p>}
  </section>
}

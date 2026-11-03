'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, RefreshCw, Volume2, VolumeX } from 'lucide-react'
import { apiRequest, checkBackendHealth, logout } from '../../lib/api'
import { useJobContext } from '../../contexts/JobContext'
import { useResource, type Brain, type LiveEvent, type Settings } from './data'
import { Message } from './Message'

export function Evidence({ id }: { id: string }) {
  const result = useResource<{ content: unknown; integrity: { verified: boolean; reason: string } }>(`/api/v1/evidence/${encodeURIComponent(id)}`)
  return <div className="evidence"><p className="muted">{id}</p>{result.loading && <p role="status">Loading evidence…</p>}{result.error && <p role="alert" className="panel-error">{result.error}</p>}{result.data && <><p>{result.data.integrity.verified ? 'Integrity verified' : 'Integrity not verified'} · {result.data.integrity.reason}</p><pre>{JSON.stringify(result.data.content, null, 2)}</pre><a href={`/api/v1/evidence/${encodeURIComponent(id)}/export`} target="_blank" rel="noopener noreferrer">Export evidence</a></>}</div>
}

export function LivePanel({ projectId }: { projectId: string }) {
  const { data, error, loading, refresh } = useResource<{ events: LiveEvent[] }>(`/api/v1/projects/${projectId}/events?limit=200`, 3000)
  const [filter, setFilter] = useState('all')
  const [speech, setSpeech] = useState(false)
  const speechAfter = useRef(0)
  useEffect(() => {
    if (!speech || !data || !('speechSynthesis' in window)) return
    const fresh = data.events.filter(event => event.ts > speechAfter.current)
    for (const event of fresh.slice(-3)) window.speechSynthesis.speak(new SpeechSynthesisUtterance(event.what))
    if (fresh.length) speechAfter.current = Math.max(...fresh.map(event => event.ts))
  }, [data, speech])
  useEffect(() => () => { window.speechSynthesis?.cancel() }, [])
  const events = (data?.events || []).filter(event => filter === 'all' || `${event.type} ${event.what}`.toLowerCase().includes(filter))
  return <div className="panel-body">
    <div className="panel-toolbar"><select aria-label="Filter live events" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All activity</option><option value="fail">Failures</option><option value="verif">Verification</option><option value="plan">Planning</option><option value="chang">Changes</option></select><button aria-label={speech ? 'Mute narration' : 'Read new events aloud'} onClick={() => { speechAfter.current = Date.now(); if (speech) window.speechSynthesis?.cancel(); setSpeech(!speech) }}>{speech ? <Volume2 size={16} /> : <VolumeX size={16} />}</button><button aria-label="Refresh activity" onClick={refresh}><RefreshCw size={15} /></button><a title="Detach Joe Live" aria-label="Detach Joe Live" href={`/workspace/?project=${projectId}&view=live`} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /></a></div>
    <p className="muted">Recorded actions and results · latest 200 events</p>
    {loading && <p role="status">Connecting to Joe Live…</p>}{error && <p role="alert" className="panel-error">{error} Retrying automatically.</p>}
    {!loading && !events.length && <p className="panel-notice">No activity matches this view yet.</p>}
    <ol className="activity-list">{events.slice().reverse().map(event => <li key={event.id || `${event.ts}-${event.type}`}><time>{new Date(event.ts).toLocaleTimeString()}</time><strong>{event.what}</strong>{event.meaning && <p>{event.meaning}</p>}{event.next && <p className="muted">Next: {event.next}</p>}{event.evidenceId?.startsWith('EVC-') && <details><summary>Evidence</summary><Evidence id={event.evidenceId} /></details>}</li>)}</ol>
  </div>
}

const brainFields = { purpose: 'Purpose', preferences: 'Preferences', environment: 'Environment', architecture: 'Architecture', constraints: 'Constraints', decisions: 'Decisions', rejectedApproaches: 'Rejected approaches', knownIssues: 'Known issues', verifiedTruth: 'Verified truth' } as const
function BrainForm({ brain, onSaved }: { brain: Brain; onSaved: () => void }) {
  const cacheKey = `jc.workspace.brain-draft.${brain.projectId}`
  const [restored] = useState<{ draft: Brain; baseVersion: number } | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(cacheKey) || 'null')
      if (saved?.draft?.projectId === brain.projectId && typeof saved.baseVersion === 'number' && Object.keys(brainFields).every(key => typeof saved.draft[key] === 'string')) return saved
    } catch { /* Browser storage is optional. */ }
    return null
  })
  const [draft, setDraft] = useState(restored?.draft || brain)
  const [baseVersion, setBaseVersion] = useState(restored?.baseVersion ?? brain.updatedAt)
  const [editing, setEditing] = useState(Boolean(restored))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const settings = useResource<Settings>('/api/v1/workshop/settings')
  useEffect(() => {
    try {
      if (editing) sessionStorage.setItem(cacheKey, JSON.stringify({ draft, baseVersion }))
      else sessionStorage.removeItem(cacheKey)
    } catch { /* Preserve the visible draft when browser storage is unavailable. */ }
  }, [draft, editing, cacheKey, baseVersion])
  useEffect(() => {
    if (!editing) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [editing])
  return <div className="panel-body">
    <div className="panel-toolbar"><span>{editing ? 'Unsaved guidance draft' : `Saved ${new Date(brain.updatedAt).toLocaleString()}`}</span><button onClick={() => { setDraft(brain); setBaseVersion(brain.updatedAt); setEditing(!editing); setError('') }}>{editing ? 'Discard edits' : 'Edit guidance'}</button></div>
    {error && <p role="alert" className="panel-error">{error}</p>}
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('')
      try {
        const latest = await apiRequest<{ brain: Brain }>(`/api/v1/projects/${brain.projectId}/brain`)
        if (latest.brain.updatedAt !== baseVersion) throw new Error('Project Brain changed in another window. Discard edits and reopen this panel before saving.')
        const { projectId, updatedAt, records, ...input } = draft
        void updatedAt; void records
        await apiRequest(`/api/v1/projects/${projectId}/brain`, { method: 'PUT', body: JSON.stringify({ ...input, expectedUpdatedAt: baseVersion }) })
        setEditing(false); onSaved()
      } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
      finally { setBusy(false) }
    }}>
      {editing && <label className="field">Guidance preset<select value={draft.guidancePresetId} onChange={event => setDraft({ ...draft, guidancePresetId: event.target.value })}>{settings.data?.brainPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>}
      {Object.entries(brainFields).map(([key, title]) => <section key={key} className="brain-section"><h3>{title}</h3>{editing ? <textarea aria-label={title} rows={4} maxLength={['purpose', 'preferences', 'environment'].includes(key) ? 5000 : 10000} value={draft[key as keyof typeof brainFields]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /> : <Message content={brain[key as keyof typeof brainFields] || 'Not recorded yet.'} />}</section>)}
      {editing && <><p className="muted">Verified truth must retain supporting evidence. Guidance does not grant execution permissions.</p><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save Project Brain'}</button></>}
    </form>
    <h3>Evidence and freshness</h3><p className="muted">{brain.freshnessAt ? new Date(brain.freshnessAt).toLocaleString() : 'Freshness not established'}</p>
    {brain.evidenceIds.map(id => <details key={id}><summary>{id}</summary><Evidence id={id} /></details>)}
    {brain.records?.map(record => <details key={record.id}><summary>{record.category} · {record.status} · {record.source}</summary><Message content={record.content} /><p className="muted">{record.evidenceIds.join(', ') || 'No evidence linked'}</p></details>)}
  </div>
}
export function BrainPanel({ projectId }: { projectId: string }) {
  const result = useResource<{ brain: Brain }>(`/api/v1/projects/${projectId}/brain`)
  return <>{result.loading && <p className="panel-notice" role="status">Loading Project Brain…</p>}{result.error && <p className="panel-error" role="alert">{result.error}</p>}{result.data && <BrainForm key={result.data.brain.updatedAt} brain={result.data.brain} onSaved={result.refresh} />}</>
}

export function SettingsPanel() {
  const settings = useResource<Settings>('/api/v1/workshop/settings')
  const [health, setHealth] = useState('')
  const { setError } = useJobContext()
  return <div className="panel-body"><h3>Connection</h3><p className="muted">Secure local session</p><button onClick={async () => { setHealth('Checking…'); const result = await checkBackendHealth(); setHealth(`${result.statusText} · ${result.latencyMs} ms`) }}>Check connection</button><p role="status">{health}</p>
    {settings.loading && <p role="status">Loading model and safety settings…</p>}{settings.error && <p className="panel-error" role="alert">{settings.error}</p>}
    {settings.data && <><h3>Model routing</h3>{Object.entries(settings.data.rules).map(([key, text]) => <p className="setting-rule" key={key}>{text}</p>)}<dl className="provider-status"><div><dt>Selected local model</dt><dd>{settings.data.liveProviderStatus.localModel || 'Not configured'}</dd></div><div><dt>PowerRouter</dt><dd>{settings.data.liveProviderStatus.powerRouter?.reachable ? 'Connected' : settings.data.liveProviderStatus.powerRouter?.configured ? 'Configured · unavailable' : 'Not configured'}</dd></div><div><dt>Cloud provider</dt><dd>{settings.data.liveProviderStatus.cloudConfigured ? 'Configured · authorization required' : 'Not configured'}</dd></div></dl>{settings.data.liveProviderStatus.mockModel && <p className="panel-error">Mock model mode is active. Results do not prove real coding capability.</p>}<details><summary>Technical provider details</summary><pre>{JSON.stringify(settings.data.liveProviderStatus, null, 2)}</pre></details><h3>Presets</h3>{settings.data.presets.map(preset => <details key={preset.id}><summary>{preset.name}</summary><p>{preset.description}</p><small>{preset.privacyMode}</small></details>)}<h3>Safety status</h3><p>{settings.data.governance.statusSummary.enforced} enforced · {settings.data.governance.statusSummary.partial} partial · {settings.data.governance.statusSummary.missing} missing</p>{settings.data.governance.limitations.map(item => <details key={item.id}><summary>{item.title}</summary><p>{item.boundary}</p></details>)}<details><summary>Runtime capabilities</summary><pre>{JSON.stringify(settings.data.capabilities, null, 2)}</pre></details></>}
    <h3>Session</h3><a href="/app.html">Open legacy workspace</a><button className="danger" onClick={async () => { try { await logout(); window.location.reload() } catch (error) { setError(error instanceof Error ? error.message : String(error)) } }}>End session</button>
  </div>
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowUp, FolderOpen, PanelLeftOpen, PanelRightClose, PanelRightOpen, Play, X } from 'lucide-react'
import { JOB_OBJECTIVE_LIMIT, jobObjective, useJobContext } from '../../contexts/JobContext'
import { updateThread } from '../../lib/api'
import { focusStep, INTENTS, intentFor, isAwaitingApproval, isLive, jobSteps, type Intent, type StepId } from '../../lib/jobSteps'
import { FilesPanel } from './FilesPanel'
import { BrainPanel, LivePanel, SettingsPanel } from './ProjectPanels'
import { ChangesPanel, JobActivity } from './WorkPanels'
import { Message } from './Message'
import { PreviewPanel } from './PreviewPanel'
import { PanelBoundary } from './PanelBoundary'
import { SideChatPanel } from './SideChatPanel'
import { HistoryPanel } from './HistoryPanel'
import { Sidebar } from './Sidebar'
import { StartScreen } from './StartScreen'
import { JobRun } from './JobRun'
import { StepDetail } from './StepDetail'
import { useResource, type Settings as WorkshopSettings } from './data'

type View = 'simple' | 'advanced'
type Tab = 'step' | 'files' | 'changes' | 'output' | 'brain' | 'live' | 'preview' | 'history' | 'sidechat'
const ADVANCED_TABS: Array<{ id: Tab; label: string }> = [
  { id: 'step', label: 'Step' }, { id: 'files', label: 'Files' }, { id: 'changes', label: 'Uncommitted' }, { id: 'output', label: 'Output' },
  { id: 'brain', label: 'Brain' }, { id: 'live', label: 'Live' }, { id: 'preview', label: 'Preview' }, { id: 'history', label: 'History' }, { id: 'sidechat', label: 'Side chat' },
]
const LAYOUT_KEY = 'jc.workspace.layout.v2'
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function Workspace() {
  const ctx = useJobContext()
  const { project, thread, activeJob, messages, jobs, loading, session, error } = ctx
  const [view, setView] = useState<View>('simple')
  const [sidebar, setSidebar] = useState(true)
  const [paneOpen, setPaneOpen] = useState(true)
  const [tab, setTab] = useState<Tab>('step')
  const [paneWidth, setPaneWidth] = useState(460)
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [selected, setSelected] = useState<{ jobId: string; step: StepId } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [draftsLoaded, setDraftsLoaded] = useState(false)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [folderPath, setFolderPath] = useState('')
  const [opening, setOpening] = useState(false)
  const [rename, setRename] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [detached, setDetached] = useState(false)
  const [historyCount, setHistoryCount] = useState(60)
  const [unread, setUnread] = useState(false)
  const [runningRequest, setRunningRequest] = useState('')
  const [compact, setCompact] = useState(false)
  const failed = useRef<{ message: string; action: () => Promise<unknown> } | null>(null)
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const folderDialog = useRef<HTMLDialogElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const sticky = useRef(true)
  const settings = useResource<WorkshopSettings>(session ? '/api/v1/workshop/settings' : null)
  const key = `${project?.id || ''}/${thread?.id || ''}`
  const draft = drafts[key] || ''
  const busy = Boolean(activeJob && (isLive(activeJob) || isAwaitingApproval(activeJob)))
  const threadJobs = jobs.filter(job => job.threadId === thread?.id)
  const latest = threadJobs[0]
  const intent = intentFor(ctx.intent)
  const advanced = view === 'advanced'

  // The pane follows the newest job's current step until the operator picks a step.
  const followed = selected && threadJobs.some(job => job.id === selected.jobId) ? selected : latest ? { jobId: latest.id, step: focusStep(jobSteps(latest)) } : null
  const followedJob = followed ? threadJobs.find(job => job.id === followed.jobId) : undefined
  const latestId = latest?.id
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSelected(null) }, [latestId, thread?.id])

  const run = async (action: () => Promise<unknown>) => {
    try { await action(); failed.current = null }
    catch (failure) { const message = failure instanceof Error ? failure.message : String(failure); failed.current = { message, action }; ctx.setError(message) }
  }
  const retry = () => {
    const action = failed.current && failed.current.message === error ? failed.current.action : ctx.refreshProjectData
    ctx.setError(null); failed.current = null
    void run(action)
  }
  const chooseIntent = (next: Intent) => {
    if (next === 'survey' && !draft.trim()) { void run(() => ctx.surveyBuild()); return }
    ctx.setIntent(next); setTimeout(() => composer.current?.focus(), 0)
  }
  const decide = async (jobId: string, decision: 'approve' | 'discard') => { await run(() => ctx.decidePlan(jobId, decision)) }
  const revise = (request: string) => { ctx.setIntent('fix'); setDrafts(values => ({ ...values, [key]: request })); setTimeout(() => composer.current?.focus(), 0) }
  let objectiveError = ''
  if (intent.id !== 'ask' && intent.id !== 'plan' && draft.trim()) { try { jobObjective(intent.id, draft) } catch (failure) { objectiveError = failure instanceof Error ? failure.message : String(failure) } }
  const canSend = Boolean(thread && thread.status !== 'archived' && !loading && !pending[key] && !objectiveError
    && (draft.trim() || intent.id === 'survey') && (!busy || intent.id === 'ask' || intent.id === 'plan'))
  const lastAssistantIndex = messages.map(item => item.role).lastIndexOf('assistant')

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetached(query.get('view') === 'live'); setSidebar(window.innerWidth > 650)
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null')
      if (saved && typeof saved === 'object') {
        if (saved.view === 'simple' || saved.view === 'advanced') setView(saved.view)
        if (typeof saved.sidebar === 'boolean' && window.innerWidth > 650) setSidebar(saved.sidebar)
        if (typeof saved.paneOpen === 'boolean') setPaneOpen(saved.paneOpen)
        if (typeof saved.width === 'number' && Number.isFinite(saved.width)) setPaneWidth(Math.max(360, Math.min(900, saved.width)))
      }
    } catch { /* Defaults apply. */ }
    setLayoutLoaded(true)
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem('jc.workspace.drafts') || '{}')
      if (saved && typeof saved === 'object') setDrafts(Object.fromEntries(Object.entries(saved).filter(([item, value]) => item.startsWith('proj-') && typeof value === 'string')))
    } catch { /* In-memory drafts remain usable. */ }
    setDraftsLoaded(true)
  }, [])
  useEffect(() => {
    if (!draftsLoaded) return
    try { sessionStorage.setItem('jc.workspace.drafts', JSON.stringify(drafts)) } catch { /* Keep drafts in memory. */ }
  }, [drafts, draftsLoaded])
  useEffect(() => {
    if (!layoutLoaded) return
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ view, sidebar, paneOpen, width: paneWidth })) } catch { /* Layout stays in memory. */ }
  }, [layoutLoaded, view, sidebar, paneOpen, paneWidth])
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth <= 1000)
    resize(); window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!advanced) setTab('step') }, [advanced])
  useEffect(() => {
    if (!project || !thread) return
    const url = new URL(window.location.href)
    url.searchParams.set('project', project.id); url.searchParams.set('thread', thread.id)
    window.history.replaceState(null, '', url)
  }, [project, thread])
  useEffect(() => {
    if (loading) return
    const node = transcript.current
    if (node) node.scrollTop = scrollPositions.current.get(key) ?? node.scrollHeight
    sticky.current = !node || node.scrollHeight - node.scrollTop - node.clientHeight < 120
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditingTitle(false); setUnread(false)
  }, [key, loading])
  useEffect(() => {
    const node = transcript.current
    if (node && sticky.current) node.scrollTop = node.scrollHeight
    else if (node && !loading) setUnread(true)
  }, [messages.length, latest?.updatedAt, loading])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'b') { event.preventDefault(); setSidebar(value => !value) }
      if (event.key === 'Escape' && !document.querySelector('dialog[open]') && !isTyping(event.target) && window.innerWidth <= 1000) setPaneOpen(false)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  if (!session) return <main className="session-screen"><div className="brand-mark">J</div><h1>{loading ? 'Opening your workspace…' : 'Secure local session needed'}</h1><p>{loading ? 'Connecting to JoeCoder.' : 'Start JoeCoder from start.bat to open a secure browser session.'}</p>{error && <p role="alert" className="panel-error">{error}</p>}</main>
  if (detached && project) return <main className="detached-live"><header><h1>Joe Live: {project.name}</h1><a href={`/workspace/?project=${project.id}`}>Open workspace</a></header><LivePanel projectId={project.id} /></main>

  const submit = async () => {
    if (!canSend || !thread) return
    const submitted = draft, submittedKey = key
    setPending(value => ({ ...value, [submittedKey]: true }))
    try {
      if (intent.id === 'survey' && !submitted.trim()) await ctx.surveyBuild()
      else await ctx.sendComposer(submitted)
      setDrafts(value => value[submittedKey] === submitted ? { ...value, [submittedKey]: '' } : value)
      failed.current = null
    } catch (failure) { ctx.setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setPending(value => ({ ...value, [submittedKey]: false })) }
  }
  const showPane = Boolean(project && paneOpen && (advanced || followedJob))
  const statusText = error ? 'Needs attention' : loading ? 'Loading' : activeJob && isAwaitingApproval(activeJob) ? 'Waiting for your approval' : busy ? 'Joe is working' : 'Ready'

  return <div className={`workspace-shell ${!sidebar ? 'sidebar-hidden' : ''} view-${view}`}>
    {sidebar && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setSidebar(false)} />}
    {sidebar && <Sidebar onClose={() => setSidebar(false)} onOpenFolder={() => folderDialog.current?.showModal()} onSettings={() => settingsDialog.current?.showModal()} />}
    <main className="workspace-main">
      <header className="workspace-header">
        {!sidebar && <button aria-label="Show sidebar" title="Show sidebar (Ctrl+B)" onClick={() => setSidebar(true)}><PanelLeftOpen size={18} /></button>}
        <div className="thread-heading"><span>{project?.name || 'JoeCoder'}</span>{editingTitle && thread ? <form onSubmit={event => { event.preventDefault(); void run(async () => { await updateThread(project!.id, thread.id, { title: rename }); setEditingTitle(false); await ctx.refreshProjectData() }) }}><input autoFocus aria-label="Conversation title" value={rename} maxLength={200} onChange={event => setRename(event.target.value)} /><button type="submit" disabled={!rename.trim()}>Save</button><button type="button" onClick={() => setEditingTitle(false)}>Cancel</button></form> : <button className="title-button" disabled={!thread} title="Rename conversation" onClick={() => { setRename(thread?.title || ''); setEditingTitle(true) }}>{thread?.title || 'Choose a project'}</button>}</div>
        {thread && !editingTitle && <button className="icon-button" aria-label={thread.status === 'archived' ? 'Restore conversation' : 'Archive conversation'} title={thread.status === 'archived' ? 'Restore conversation' : 'Archive conversation'} onClick={() => void run(async () => { await updateThread(project!.id, thread.id, { status: thread.status === 'archived' ? 'active' : 'archived' }); await ctx.refreshProjectData() })}>{thread.status === 'archived' ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>}
        <div className="view-switch" role="radiogroup" aria-label="Interface detail">{(['simple', 'advanced'] as View[]).map(item => <button key={item} role="radio" aria-checked={view === item} className={view === item ? 'selected' : ''} onClick={() => setView(item)}>{item === 'simple' ? 'Simple' : 'Advanced'}</button>)}</div>
        {project && <button className="icon-button" aria-label={paneOpen ? 'Hide details pane' : 'Show details pane'} title={paneOpen ? 'Hide details' : 'Show details'} aria-pressed={paneOpen} onClick={() => setPaneOpen(!paneOpen)}>{paneOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>}
      </header>
      {error && <div role="alert" className="workspace-error"><span>{error}</span><button onClick={retry}>Try again</button><button aria-label="Dismiss error" onClick={() => ctx.setError(null)}><X size={16} /></button></div>}
      <div className="workspace-content">
        <section className="conversation" aria-label="Conversation" inert={showPane && compact}>
          <div className="transcript" ref={transcript} onScroll={event => { if (loading) return; const node = event.currentTarget; scrollPositions.current.set(key, node.scrollTop); sticky.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120; if (sticky.current) setUnread(false) }}>
            <div className="transcript-inner">{unread && <button className="new-activity" onClick={() => { const node = transcript.current; if (node) node.scrollTop = node.scrollHeight; sticky.current = true; setUnread(false) }}>New activity. Jump to latest</button>}
              {!project ? <section className="start-screen"><h1>Open a project to start</h1><p className="muted">Pick a build folder. Joe surveys it read-only before anything else.</p><button className="primary" onClick={() => folderDialog.current?.showModal()}><FolderOpen size={16} /> Open project folder</button></section> : <>
                {loading && <p role="status" className="muted">Loading conversation…</p>}
                {!loading && !messages.length && !threadJobs.length && <StartScreen projectName={project.name} busy={busy} onChoose={chooseIntent} />}
                {messages.length > historyCount && <button className="history-button" onClick={() => setHistoryCount(value => value + 60)}>Load earlier messages ({messages.length - historyCount})</button>}
                {[
                  ...messages.slice(-historyCount).map(message => {
                    const index = messages.indexOf(message)
                    const request = index === lastAssistantIndex && index > 0 && messages[index - 1].role === 'user' ? messages[index - 1].content.trim() : ''
                    const offerJob = Boolean(request) && thread?.status === 'active' && !threadJobs.some(job => job.objective.trim().endsWith(request))
                    return { timestamp: new Date(message.createdAt).getTime(), id: message.id, element: <article className={`chat-message ${message.role}`} key={message.id}><div className="message-author">{message.role === 'assistant' ? 'Joe' : message.role === 'user' ? 'You' : 'System'}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><Message content={message.content} />
                      {offerJob && <div className="run-request"><button disabled={busy || Boolean(runningRequest) || request.length > JOB_OBJECTIVE_LIMIT} onClick={() => { setRunningRequest(request); void run(() => ctx.runRequestAsJob(request)).finally(() => setRunningRequest('')) }}><Play size={14} /> {runningRequest === request ? 'Starting…' : 'Start this as a guided job'}</button><small>{request.length > JOB_OBJECTIVE_LIMIT ? `This request is ${request.length} characters; jobs accept ${JOB_OBJECTIVE_LIMIT}.` : busy ? 'Available when the current job finishes.' : 'Joe surveys, plans, gets a peer review, and waits for your approval before changing files.'}</small></div>}
                    </article> }
                  }),
                  ...threadJobs.map(job => {
                    const started = new Date(job.createdAt || 0).getTime()
                    const match = messages.find(message => message.role === 'user' && job.objective.endsWith(message.content.trim()) && Math.abs(new Date(message.createdAt).getTime() - started) < 10000)
                    return { timestamp: match ? Math.max(started, new Date(match.createdAt).getTime() + 0.5) : started, id: job.id, element: <JobRun key={job.id} job={job} selected={followed?.jobId === job.id ? followed.step : null}
                      onSelect={step => { setSelected({ jobId: job.id, step }); setTab('step'); setPaneOpen(true) }} onDecide={decision => decide(job.id, decision)} onStop={async () => { await run(ctx.stopJob) }} onRevise={revise} /> }
                  }),
                ].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)).map(item => item.element)}
                {pending[key] && <p role="status" className="pending-reply">{intent.changesCode || intent.id === 'survey' ? 'Starting the job…' : 'Joe is preparing a response…'}</p>}
              </>}
            </div>
          </div>
          {project && <div className="composer-wrap">
            {activeJob && activeJob.threadId !== thread?.id && (isLive(activeJob) || isAwaitingApproval(activeJob)) && <div className="active-job-bar" role="status"><span className={`status-dot ${activeJob.status}`} /><span>{isAwaitingApproval(activeJob) ? 'A plan in another conversation is waiting for you.' : 'Joe is working in another conversation.'}</span><button className="link-button" onClick={() => void run(() => ctx.selectThread(activeJob.threadId))}>Open it</button></div>}
            {activeJob && activeJob.status === 'interrupted' && !isAwaitingApproval(activeJob) && activeJob.threadId === thread?.id && <div className="active-job-bar" role="status"><span className="status-dot interrupted" /><span>This job was interrupted. It can continue from its last checkpoint.</span><button onClick={() => void run(ctx.resumeJob)}>Resume</button></div>}
            <form className={`workspace-composer ${intent.changesCode ? 'changes-code' : ''}`} onSubmit={event => { event.preventDefault(); void submit() }}>
              <div className="intent-switch" role="radiogroup" aria-label="What should Joe do?">{INTENTS.map(item => <button type="button" role="radio" key={item.id} aria-checked={ctx.intent === item.id} className={`${ctx.intent === item.id ? 'selected' : ''} ${item.changesCode ? 'changes-code' : ''}`} disabled={!thread} onClick={() => ctx.setIntent(item.id)}>{item.label}</button>)}</div>
              <textarea ref={composer} aria-label="Message Joe" placeholder={intent.placeholder} value={draft} rows={3} disabled={!thread || thread.status === 'archived'} onChange={event => setDrafts(value => ({ ...value, [key]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} />
              <div className="composer-controls">
                <p className={`composer-caption ${intent.changesCode ? 'caption-code' : ''}`}>{thread?.status === 'archived' ? 'This conversation is archived. Restore it from the header to continue.' : objectiveError || (busy && !['ask', 'plan'].includes(intent.id) ? 'A job is active. Ask and Plan stay available.' : intent.caption)}</p>
                {advanced && <select aria-label="Model preset" disabled={!thread || busy} value={thread?.presetId || 'preset-auto'} onChange={event => void run(async () => { if (project && thread) { await updateThread(project.id, thread.id, { presetId: event.target.value }); await ctx.refreshProjectData() } })}>{settings.data?.presets.map(preset => <option value={preset.id} key={preset.id}>{preset.name}</option>) || <option value="preset-auto">Auto</option>}</select>}
                <button className={`send-button ${intent.changesCode ? 'send-code' : ''}`} type="submit" disabled={!canSend} title="Ctrl + Enter">{intent.changesCode ? <Play size={15} /> : <ArrowUp size={16} />}<span>{intent.send}</span></button>
              </div>
            </form>
          </div>}
        </section>
        {showPane && project && <><div className="panel-resizer" role="separator" aria-label="Resize details pane" aria-orientation="vertical" aria-valuenow={paneWidth} aria-valuemin={360} aria-valuemax={900} tabIndex={0} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setPaneWidth(value => Math.max(360, Math.min(900, value + (event.key === 'ArrowLeft' ? 20 : -20)))) } }} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPaneWidth(Math.max(360, Math.min(900, event.currentTarget.parentElement!.getBoundingClientRect().right - event.clientX))) }} />
          <aside className="workspace-panel" style={{ width: paneWidth }} aria-label="Details">
            {advanced && <nav className="pane-tabs" role="tablist" aria-label="Details">{ADVANCED_TABS.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>}
            <button className="pane-close" aria-label="Close details" onClick={() => setPaneOpen(false)}><X size={16} /></button>
            <div className="panel-scroll" key={`${project.id}/${tab}`}><PanelBoundary>
              {tab === 'step' && (followedJob && followed ? <StepDetail key={`${followedJob.id}/${followed.step}`} job={followedJob} step={followed.step} onDecide={decision => decide(followedJob.id, decision)} /> : <p className="panel-notice">Start a job to follow its steps here.</p>)}
              {tab === 'files' && <FilesPanel projectId={project.id} />}
              {tab === 'changes' && <ChangesPanel projectId={project.id} />}
              {tab === 'output' && (latest ? <div className="panel-body"><JobActivity jobId={latest.id} output live={isLive(latest)} /></div> : <p className="panel-notice">Run a job to see its command output and checks.</p>)}
              {tab === 'brain' && <BrainPanel projectId={project.id} />}
              {tab === 'live' && <LivePanel projectId={project.id} />}
              {tab === 'preview' && <PreviewPanel projectId={project.id} />}
              {tab === 'history' && thread && <HistoryPanel projectId={project.id} threadId={thread.id} />}
              {tab === 'sidechat' && <SideChatPanel projectId={project.id} />}
            </PanelBoundary></div>
          </aside></>}
      </div>
      <footer className="workspace-status"><span><span className={`status-dot ${busy ? 'running' : ''}`} />{statusText}</span><span title={project?.path}>{project?.path || 'No project open'}</span>{advanced && <button onClick={() => settingsDialog.current?.showModal()}>Local session</button>}</footer>
    </main>
    <dialog className="settings-dialog" ref={settingsDialog}><header><h2>Settings</h2><button aria-label="Close settings" onClick={() => settingsDialog.current?.close()}><X size={18} /></button></header><PanelBoundary><SettingsPanel /></PanelBoundary></dialog>
    <dialog className="folder-dialog" ref={folderDialog}><header><h2>Open project folder</h2><button aria-label="Close folder picker" onClick={() => folderDialog.current?.close()}><X size={18} /></button></header><p>Joe surveys new projects read-only before making changes.</p><form onSubmit={event => { event.preventDefault(); setOpening(true); void run(async () => { await ctx.openBuildFolder(folderPath); folderDialog.current?.close() }).finally(() => setOpening(false)) }}><button type="button" className="primary" autoFocus disabled={opening} onClick={() => { setOpening(true); void run(async () => { await ctx.openBuildFolder(); folderDialog.current?.close() }).finally(() => setOpening(false)) }}><FolderOpen size={16} /> {opening ? 'Opening…' : 'Browse folders…'}</button><label className="field">Or paste a folder path<input value={folderPath} onChange={event => setFolderPath(event.target.value)} placeholder="D:\Projects\MyApp" /></label><button type="submit" disabled={opening || !folderPath.trim()}>Open this path</button></form></dialog>
  </div>
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Brain, ChevronDown, FolderOpen, Globe, GitCompareArrows, ListChecks, Maximize2, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Radio, Settings, Square, TerminalSquare, X } from 'lucide-react'
import { useJobContext } from '../../contexts/JobContext'
import { updateThread } from '../../lib/api'
import { FilesPanel } from './FilesPanel'
import { BrainPanel, LivePanel, SettingsPanel } from './ProjectPanels'
import { ChangesPanel, JobActivity, JobCard, PlanPanel } from './WorkPanels'
import { Message } from './Message'
import { PreviewPanel } from './PreviewPanel'
import { PanelBoundary } from './PanelBoundary'
import { SideChatPanel } from './SideChatPanel'
import { HistoryPanel } from './HistoryPanel'
import { useResource, type Settings as WorkshopSettings } from './data'

type Panel = 'files' | 'changes' | 'plan' | 'brain' | 'live' | 'preview' | 'history' | 'sidechat'
const panels = [
  { id: 'files', label: 'Files', icon: FolderOpen }, { id: 'changes', label: 'Changes', icon: GitCompareArrows },
  { id: 'plan', label: 'Plan & evidence', icon: ListChecks }, { id: 'brain', label: 'Project Brain', icon: Brain },
  { id: 'live', label: 'Joe Live', icon: Radio }, { id: 'preview', label: 'Preview', icon: Globe },
  { id: 'history', label: 'Job history', icon: ListChecks },
  { id: 'sidechat', label: 'Side chat', icon: MessageSquare },
] as const

export function Workspace() {
  const ctx = useJobContext()
  const { project, thread, activeJob, messages, jobs, loading, session, error } = ctx
  const [panel, setPanel] = useState<Panel | null>(null)
  const [sidebar, setSidebar] = useState(true)
  const [compact, setCompact] = useState(false)
  const [output, setOutput] = useState(false)
  const [focus, setFocus] = useState(false)
  const [panelWidth, setPanelWidth] = useState(440)
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('right')
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [draftsLoaded, setDraftsLoaded] = useState(false)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [folderPath, setFolderPath] = useState('')
  const [opening, setOpening] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [rename, setRename] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [detached, setDetached] = useState(false)
  const [historyCount, setHistoryCount] = useState(60)
  const [unread, setUnread] = useState(false)
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const folderDialog = useRef<HTMLDialogElement>(null)
  const layoutDialog = useRef<HTMLDialogElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const sticky = useRef(true)
  const settings = useResource<WorkshopSettings>(session ? '/api/v1/workshop/settings' : null)
  const key = `${project?.id || ''}/${thread?.id || ''}`
  const draft = drafts[key] || ''
  const busy = Boolean(activeJob && ['queued', 'running'].includes(activeJob.status))
  const threadJobs = jobs.filter(job => job.threadId === thread?.id)
  const latest = threadJobs[0]
  const run = async (action: () => Promise<unknown>) => {
    try { await action() } catch (error) { ctx.setError(error instanceof Error ? error.message : String(error)) }
  }
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const selectedPanel = query.get('panel')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetached(query.get('view') === 'live'); setSidebar(window.innerWidth > 650)
    try {
      const saved = JSON.parse(localStorage.getItem('jc.workspace.layout.v1') || 'null')
      if (saved && typeof saved === 'object') {
        if (typeof saved.sidebar === 'boolean' && window.innerWidth > 650) setSidebar(saved.sidebar)
        if (typeof saved.output === 'boolean') setOutput(saved.output)
        if (typeof saved.focus === 'boolean') setFocus(saved.focus)
        if (saved.side === 'left' || saved.side === 'right') setPanelSide(saved.side)
        if (typeof saved.width === 'number' && Number.isFinite(saved.width)) setPanelWidth(Math.max(340, Math.min(900, saved.width)))
        if (panels.some(item => item.id === saved.panel)) setPanel(saved.panel)
      }
    } catch { /* Invalid or unavailable preferences fall back to the default layout. */ }
    if (panels.some(item => item.id === selectedPanel)) setPanel(selectedPanel as Panel)
    setLayoutLoaded(true)
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem('jc.workspace.drafts') || '{}')
      if (saved && typeof saved === 'object') setDrafts(Object.fromEntries(Object.entries(saved).filter(([key, value]) => key.startsWith('proj-') && typeof value === 'string')))
    } catch { /* Storage is optional; in-memory drafts remain usable. */ }
    setDraftsLoaded(true)
  }, [])
  useEffect(() => {
    if (!draftsLoaded) return
    try { sessionStorage.setItem('jc.workspace.drafts', JSON.stringify(drafts)) } catch { /* Preserve in memory when browser storage is full. */ }
  }, [drafts, draftsLoaded])
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth <= 1000)
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    if (!layoutLoaded) return
    try { localStorage.setItem('jc.workspace.layout.v1', JSON.stringify({ sidebar, output, focus, side: panelSide, width: panelWidth, panel })) } catch { /* Layout remains usable without browser storage. */ }
  }, [layoutLoaded, sidebar, output, focus, panelSide, panelWidth, panel])
  useEffect(() => {
    if (!project || !thread) return
    const url = new URL(window.location.href)
    url.searchParams.set('project', project.id); url.searchParams.set('thread', thread.id)
    if (panel) url.searchParams.set('panel', panel); else url.searchParams.delete('panel')
    window.history.replaceState(null, '', url)
  }, [project, thread, panel])
  useEffect(() => {
    if (loading) return
    const node = transcript.current
    if (node) node.scrollTop = scrollPositions.current.get(key) ?? node.scrollHeight
    sticky.current = !node || node.scrollHeight - node.scrollTop - node.clientHeight < 120
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditingTitle(false)
    setUnread(false)
  }, [key, loading])
  useEffect(() => {
    const node = transcript.current
    if (node && sticky.current) node.scrollTop = node.scrollHeight
    else if (node && !loading) setUnread(true)
  }, [messages.length, latest?.updatedAt, loading])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'b') { event.preventDefault(); setSidebar(value => !value) }
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { setFocus(false); setPanel(null) }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  if (!session) return <main className="session-screen"><div className="brand-mark">J</div><h1>{loading ? 'Opening your workspace…' : 'Secure local session needed'}</h1><p>{loading ? 'Connecting to JoeCoder.' : 'Start JoeCoder from start.bat to open a secure browser session.'}</p>{error && <p role="alert" className="panel-error">{error}</p>}</main>
  if (detached && project) return <main className="detached-live"><header><h1>Joe Live · {project.name}</h1><a href={`/workspace/?project=${project.id}`}>Open workspace</a></header><LivePanel projectId={project.id} /></main>

  return <div className={`workspace-shell ${!sidebar ? 'sidebar-hidden' : ''} ${focus && panel ? 'panel-focused' : ''} ${panelSide === 'left' ? 'panel-on-left' : ''}`}>
    {sidebar && <aside className="workspace-sidebar" aria-label="Projects and conversations">
      <div className="sidebar-brand"><span className="brand-mark">J</span><strong>JoeCoder</strong><button aria-label="Hide sidebar" title="Hide sidebar (Ctrl+B)" onClick={() => setSidebar(false)}><PanelLeftClose size={17} /></button></div>
      <button className="new-thread" disabled={!project || loading} onClick={() => void run(ctx.createConversation)}><Plus size={17} /> New conversation</button>
      <div className="sidebar-scroll"><div className="section-label">Projects<button aria-label="Open project folder" onClick={() => folderDialog.current?.showModal()}><Plus size={15} /></button></div>
        {ctx.projects.map(item => <div className="project-group" key={item.id}><button className={`project-row ${project?.id === item.id ? 'selected' : ''}`} title={item.path} onClick={() => void run(() => ctx.selectProject(item.id))}><FolderOpen size={16} /><span>{item.name}</span>{project?.id === item.id && <ChevronDown size={14} />}</button>
          {project?.id === item.id && <div className="thread-list">{ctx.threads.filter(item => showArchived || item.status !== 'archived').map(item => <button className={`thread-row ${thread?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => void run(() => ctx.selectThread(item.id))}><MessageSquare size={13} /><span>{item.title}</span>{item.status === 'archived' && <small>Archived</small>}</button>)}{loading && <p className="muted">Loading conversations…</p>}</div>}
        </div>)}
        {!ctx.projects.length && <p className="panel-notice">Open a project folder to begin.</p>}
        {!!project && <label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /> Show archived</label>}
      </div>
      <div className="sidebar-footer"><button onClick={() => folderDialog.current?.showModal()}><FolderOpen size={16} /> Open folder</button><button disabled={!project} onClick={() => setPanel('brain')}><Brain size={16} /> Project Brain</button><button onClick={() => settingsDialog.current?.showModal()}><Settings size={16} /> Settings</button></div>
    </aside>}
    <main className="workspace-main">
      <header className="workspace-header">
        {!sidebar && <button aria-label="Show sidebar" onClick={() => setSidebar(true)}><PanelLeftOpen size={18} /></button>}
        <div className="thread-heading"><span>{project?.name || 'Workspace'}</span>{editingTitle && thread ? <form onSubmit={event => { event.preventDefault(); void run(async () => { await updateThread(project!.id, thread.id, { title: rename }); setEditingTitle(false); await ctx.refreshProjectData() }) }}><input autoFocus aria-label="Conversation title" value={rename} maxLength={200} onChange={event => setRename(event.target.value)} /><button type="submit" disabled={!rename.trim()}>Save</button><button type="button" onClick={() => setEditingTitle(false)}>Cancel</button></form> : <button className="title-button" disabled={!thread} title="Rename conversation" onClick={() => { setRename(thread?.title || ''); setEditingTitle(true) }}>{thread?.title || 'Choose a project'}</button>}</div>
        <nav className="workspace-tools" aria-label="Workspace panels">{panels.map(item => <button key={item.id} aria-label={item.label} title={item.label} aria-pressed={panel === item.id} disabled={!project} onClick={() => setPanel(panel === item.id ? null : item.id)}><item.icon size={17} /><span>{item.label}</span></button>)}<button aria-label="Output and checks" title="Output and checks" aria-pressed={output} disabled={!project} onClick={() => setOutput(!output)}><TerminalSquare size={17} /></button></nav>
      </header>
      {error && <div role="alert" className="workspace-error"><span>{error}</span><button onClick={() => void run(async () => { await ctx.refreshProjectData(); ctx.setError(null) })}>Retry</button><button aria-label="Dismiss error" onClick={() => ctx.setError(null)}><X size={16} /></button></div>}
      <div className="workspace-content">
        <section className="conversation" aria-label="Conversation" inert={compact && Boolean(panel)}>
          <div className="transcript" ref={transcript} onScroll={event => { if (loading) return; const node = event.currentTarget; scrollPositions.current.set(key, node.scrollTop); sticky.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120; if (sticky.current) setUnread(false) }}>
            <div className="transcript-inner">{unread && <button className="new-activity" onClick={() => { const node = transcript.current; if (node) node.scrollTop = node.scrollHeight; sticky.current = true; setUnread(false) }}>New activity · Jump to latest</button>}
              {!project ? <div className="conversation-empty"><div className="brand-mark">J</div><h1>What are we building?</h1><p>Open a project. Joe will inspect it, help you plan, and work with you here.</p><button className="primary" onClick={() => folderDialog.current?.showModal()}><FolderOpen size={16} /> Open project folder</button></div> : <>
                {loading && <p role="status" className="muted">Loading conversation…</p>}
                {!loading && !messages.length && !threadJobs.length && <div className="conversation-empty"><MessageSquare size={28} /><h1>Start with the outcome.</h1><p>Ask a question, make a plan, or give Joe a task.</p><button disabled={busy || !thread} onClick={() => void run(ctx.inspectBuild)}>Inspect this project</button></div>}
                {messages.length > historyCount && <button className="history-button" onClick={() => setHistoryCount(value => value + 60)}>Load earlier messages ({messages.length - historyCount})</button>}
                {[
                  ...messages.slice(-historyCount).map(message => ({ timestamp: new Date(message.createdAt).getTime(), id: message.id, element: <article className={`chat-message ${message.role}`} key={message.id}><div className="message-author">{message.role === 'assistant' ? 'Joe' : message.role === 'user' ? 'You' : 'System'}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><Message content={message.content} /></article> })),
                  ...threadJobs.map(job => {
                    const started = new Date(job.createdAt || 0).getTime()
                    const request = messages.find(message => message.role === 'user' && message.content === job.objective && Math.abs(new Date(message.createdAt).getTime() - started) < 10000)
                    return { timestamp: request ? Math.max(started, new Date(request.createdAt).getTime() + 0.5) : started, id: job.id, element: <JobCard key={job.id} job={job} /> }
                  }),
                ].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)).map(item => item.element)}
                {pending[key] && <p role="status" className="pending-reply">Joe is preparing a response…</p>}
              </>}
            </div>
          </div>
          <div className="composer-wrap">
            {activeJob && <div className="active-job-bar" role="status"><span className={`status-dot ${activeJob.status}`} /><span>{activeJob.threadId !== thread?.id ? 'Job in another conversation' : 'Current job'} · {activeJob.status} · {activeJob.stage}</span>{busy && <button className="stop-button" onClick={() => void run(ctx.stopJob)}><Square size={11} /> Stop</button>}{activeJob.status === 'interrupted' && <button onClick={() => void run(ctx.resumeJob)}>Resume</button>}</div>}
            <form className="workspace-composer" onSubmit={async event => {
              event.preventDefault()
              if (!draft.trim() || pending[key] || loading || !thread || (busy && ctx.mode === 'build')) return
              const submitted = draft; const submittedKey = key
              setPending(value => ({ ...value, [submittedKey]: true }))
              try { await ctx.sendComposer(submitted); setDrafts(value => value[submittedKey] === submitted ? { ...value, [submittedKey]: '' } : value) }
              catch (error) { ctx.setError(error instanceof Error ? error.message : String(error)) }
              finally { setPending(value => ({ ...value, [submittedKey]: false })) }
            }}>
              <textarea aria-label="Message Joe" placeholder={project ? 'Describe what you want to do…' : 'Open a project to start…'} value={draft} rows={3} disabled={!thread || thread.status === 'archived'} onChange={event => setDrafts(value => ({ ...value, [key]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
              <div className="composer-controls"><select aria-label="Conversation mode" value={ctx.mode} onChange={event => ctx.setMode(event.target.value as 'build' | 'ask' | 'plan')}><option value="build">Automatic</option><option value="ask">Ask</option><option value="plan">Plan</option></select><select aria-label="Model preset" disabled={!thread || busy} value={thread?.presetId || 'preset-auto'} onChange={event => void run(async () => { if (project && thread) { await updateThread(project.id, thread.id, { presetId: event.target.value }); await ctx.refreshProjectData() } })}>{settings.data?.presets.map(preset => <option value={preset.id} key={preset.id}>{preset.name}</option>) || <option value="preset-auto">Auto</option>}</select><span className="composer-shortcut">Ctrl + Enter</span><button className="send-button" type="submit" aria-label="Send message" disabled={!draft.trim() || !thread || loading || pending[key] || (busy && ctx.mode === 'build') || thread.status === 'archived'}><ArrowUp size={18} /></button></div>
            </form>
            <div className="composer-caption"><span>{ctx.mode === 'build' ? 'Send starts one bounded job with permission to change code.' : ctx.mode === 'plan' ? 'Plan the work. No code changes.' : 'Ask a question. No code changes.'}</span>{thread && <button onClick={() => void run(async () => { await updateThread(project!.id, thread.id, { status: thread.status === 'archived' ? 'active' : 'archived' }); await ctx.refreshProjectData() })}>{thread.status === 'archived' ? 'Restore conversation' : 'Archive'}</button>}</div>
          </div>
        </section>
        {panel && project && <><div className="panel-resizer" role="separator" aria-label="Resize workspace panel" aria-orientation="vertical" aria-valuenow={panelWidth} aria-valuemin={340} aria-valuemax={900} tabIndex={0} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setPanelWidth(value => Math.max(340, Math.min(900, value + (event.key === (panelSide === 'right' ? 'ArrowLeft' : 'ArrowRight') ? 20 : -20)))) } }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPanelWidth(Math.max(340, Math.min(900, panelSide === 'right' ? event.currentTarget.parentElement!.getBoundingClientRect().right - event.clientX : event.clientX - event.currentTarget.parentElement!.getBoundingClientRect().left))) }} /><aside className="workspace-panel" style={{ width: panelWidth }} aria-label={panels.find(item => item.id === panel)?.label}><header><h2>{panels.find(item => item.id === panel)?.label}</h2><button aria-label={focus ? 'Restore split view' : 'Focus panel'} onClick={() => setFocus(!focus)}><Maximize2 size={15} /></button><button aria-label="Close panel" onClick={() => { setPanel(null); setFocus(false) }}><X size={17} /></button></header><div className="panel-scroll" key={`${project.id}/${panel}/${panel === 'history' ? thread?.id : ''}`}><PanelBoundary>{panel === 'preview' && <PreviewPanel projectId={project.id} />}{panel === 'sidechat' && <SideChatPanel projectId={project.id} />}{panel === 'history' && thread && <HistoryPanel projectId={project.id} threadId={thread.id} />}{panel === 'files' && <FilesPanel projectId={project.id} />}{panel === 'changes' && <ChangesPanel projectId={project.id} />}{panel === 'plan' && <PlanPanel />}{panel === 'brain' && <BrainPanel projectId={project.id} />}{panel === 'live' && <LivePanel projectId={project.id} />}</PanelBoundary></div></aside></>}
      </div>
      {output && <section className="output-panel" aria-label="Output and checks"><header><h2>Output & checks</h2><span>Recorded tool results</span><button aria-label="Close output" onClick={() => setOutput(false)}><X size={16} /></button></header><div>{latest ? <JobActivity jobId={latest.id} output live={busy} /> : <p className="panel-notice">Run a job to see its real command output and checks here.</p>}</div></section>}
      <footer className="workspace-status"><span><span className={`status-dot ${busy ? 'running' : ''}`} />{error ? 'Needs attention' : loading ? 'Loading' : busy ? 'Job running' : 'Ready'}</span><span title={project?.path}>{project?.path || 'No project open'}</span><button onClick={() => layoutDialog.current?.showModal()}>Layout</button><button onClick={() => settingsDialog.current?.showModal()}>Local session</button></footer>
    </main>
    <dialog className="folder-dialog" ref={layoutDialog}><header><h2>Workspace layout</h2><button aria-label="Close layout" onClick={() => layoutDialog.current?.close()}><X size={18} /></button></header><div className="panel-body"><label className="field">Tools panel position<select value={panelSide} onChange={event => setPanelSide(event.target.value as 'left' | 'right')}><option value="right">Right of conversation</option><option value="left">Left of conversation</option></select></label><label className="field">Panel width<input aria-label="Panel width" type="range" min={340} max={900} step={20} value={panelWidth} onChange={event => setPanelWidth(Number(event.target.value))} /></label><button onClick={() => { setPanel('files'); setFocus(true); layoutDialog.current?.close() }}>Focus files</button><button onClick={() => { setFocus(false); layoutDialog.current?.close() }}>Conversation and tools</button><button onClick={() => { setPanel(null); setSidebar(window.innerWidth > 650); setOutput(false); setFocus(false); setPanelWidth(440); setPanelSide('right'); layoutDialog.current?.close() }}>Reset layout</button><p className="muted">Layout is remembered in this browser. Narrow windows show one tools panel at a time.</p></div></dialog>
    <dialog className="settings-dialog" ref={settingsDialog}><header><h2>Settings</h2><button aria-label="Close settings" onClick={() => settingsDialog.current?.close()}><X size={18} /></button></header><PanelBoundary><SettingsPanel /></PanelBoundary></dialog>
    <dialog className="folder-dialog" ref={folderDialog}><header><h2>Open project folder</h2><button aria-label="Close folder picker" onClick={() => folderDialog.current?.close()}><X size={18} /></button></header><p>Joe inspects new projects read-only before making changes.</p><form onSubmit={event => { event.preventDefault(); setOpening(true); void run(async () => { await ctx.openBuildFolder(folderPath); folderDialog.current?.close() }).finally(() => setOpening(false)) }}><label className="field">Folder path<input autoFocus value={folderPath} onChange={event => setFolderPath(event.target.value)} placeholder="D:\Projects\MyApp" /></label><button className="primary" type="submit" disabled={opening || !folderPath.trim()}>{opening ? 'Opening…' : 'Open folder'}</button><button type="button" disabled={opening} onClick={() => { setOpening(true); void run(async () => { await ctx.openBuildFolder(); folderDialog.current?.close() }).finally(() => setOpening(false)) }}>Browse folders…</button></form></dialog>
  </div>
}

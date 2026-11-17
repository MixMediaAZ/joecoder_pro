'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, FolderOpen, MessageSquare, PanelLeftClose, Pin, PinOff, Plus, Search, Settings } from 'lucide-react'
import { useJobContext } from '../../contexts/JobContext'
import { isAwaitingApproval, isLive } from '../../lib/jobSteps'
import type { Project } from '../../lib/backendTypes'

interface Prefs { pinned: string[]; hidden: string[]; collapsed: string[] }
const KEY = 'jc.sidebar.v1'
const empty: Prefs = { pinned: [], hidden: [], collapsed: [] }

/** Pin, hide, and collapse are view preferences kept in this browser; they never change project records or files. */
function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(empty)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<Prefs> | null
      const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.startsWith('proj-')) : []
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setPrefs({ pinned: list(saved.pinned), hidden: list(saved.hidden), collapsed: list(saved.collapsed) })
    } catch { /* Defaults apply without storage. */ }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* Preferences stay in memory. */ }
  }, [prefs, loaded])
  const toggle = (field: keyof Prefs, id: string) => setPrefs(value => ({ ...value, [field]: value[field].includes(id) ? value[field].filter(item => item !== id) : [...value[field], id] }))
  return { prefs, toggle }
}

export function Sidebar({ onClose, onOpenFolder, onSettings }: { onClose: () => void; onOpenFolder: () => void; onSettings: () => void }) {
  const ctx = useJobContext()
  const { prefs, toggle } = usePrefs()
  const [filter, setFilter] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const query = filter.trim().toLowerCase()
  const matches = (item: Project) => !query || item.name.toLowerCase().includes(query) || item.path.toLowerCase().includes(query)
  const visible = ctx.projects.filter(item => matches(item) && (!prefs.hidden.includes(item.id) || item.id === ctx.project?.id))
  const pinned = visible.filter(item => prefs.pinned.includes(item.id))
  const others = visible.filter(item => !prefs.pinned.includes(item.id))
  const hidden = ctx.projects.filter(item => matches(item) && prefs.hidden.includes(item.id) && item.id !== ctx.project?.id)
  const run = (action: () => Promise<unknown>) => void action().catch(error => ctx.setError(error instanceof Error ? error.message : String(error)))

  const row = (item: Project) => {
    const selected = ctx.project?.id === item.id
    const collapsed = prefs.collapsed.includes(item.id)
    const isPinned = prefs.pinned.includes(item.id), isHidden = prefs.hidden.includes(item.id)
    return <li key={item.id} className="project-group">
      <div className={`project-row ${selected ? 'selected' : ''}`}>
        <button className="project-expand" aria-label={collapsed ? `Show conversations in ${item.name}` : `Hide conversations in ${item.name}`} aria-expanded={selected && !collapsed} disabled={!selected} onClick={() => toggle('collapsed', item.id)}>
          {selected && !collapsed ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button className="project-name" title={item.path} aria-current={selected ? 'true' : undefined} onClick={() => run(() => ctx.selectProject(item.id))}>{item.name}</button>
        <span className="row-actions">
          <button aria-label={isPinned ? `Unpin ${item.name}` : `Pin ${item.name}`} title={isPinned ? 'Unpin' : 'Pin to top'} onClick={() => toggle('pinned', item.id)}>{isPinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
          <button aria-label={isHidden ? `Show ${item.name}` : `Hide ${item.name}`} title={isHidden ? 'Show in list' : 'Hide from list (files are not touched)'} onClick={() => toggle('hidden', item.id)}>{isHidden ? <Eye size={14} /> : <EyeOff size={14} />}</button>
        </span>
      </div>
      {selected && !collapsed && <ul className="thread-list">
        {ctx.threads.filter(thread => showArchived || thread.status !== 'archived').map(thread => {
          const job = ctx.jobs.find(candidate => candidate.threadId === thread.id && (isLive(candidate) || isAwaitingApproval(candidate)))
          return <li key={thread.id}><button className={`thread-row ${ctx.thread?.id === thread.id ? 'selected' : ''}`} aria-current={ctx.thread?.id === thread.id ? 'true' : undefined} onClick={() => run(() => ctx.selectThread(thread.id))}>
            <MessageSquare size={13} aria-hidden="true" /><span>{thread.title}</span>
            {job && <span className={`thread-badge ${isAwaitingApproval(job) ? 'needs-you' : 'working'}`}>{isAwaitingApproval(job) ? 'Needs you' : 'Working'}</span>}
            {thread.status === 'archived' && <small>Archived</small>}
          </button></li>
        })}
        <li><button className="thread-row new" disabled={ctx.loading} onClick={() => run(ctx.createConversation)}><Plus size={13} aria-hidden="true" /><span>New conversation</span></button></li>
        <li><label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /> Show archived</label></li>
      </ul>}
    </li>
  }

  return <aside className="workspace-sidebar" aria-label="Projects and conversations">
    <div className="sidebar-brand"><span className="brand-mark" aria-hidden="true">J</span><strong>JoeCoder</strong><button aria-label="Hide sidebar" title="Hide sidebar (Ctrl+B)" onClick={onClose}><PanelLeftClose size={17} /></button></div>
    {ctx.projects.length > 5 && <label className="sidebar-filter"><Search size={14} aria-hidden="true" /><input aria-label="Filter projects" placeholder="Filter projects" value={filter} onChange={event => setFilter(event.target.value)} /></label>}
    <nav className="sidebar-scroll" aria-label="Projects">
      {pinned.length > 0 && <><h2 className="section-label">Pinned</h2><ul className="project-list">{pinned.map(row)}</ul></>}
      <h2 className="section-label">Projects<button aria-label="Open project folder" title="Open project folder" onClick={onOpenFolder}><Plus size={15} /></button></h2>
      <ul className="project-list">{others.map(row)}</ul>
      {!ctx.projects.length && <p className="panel-notice">Open a project folder to begin.</p>}
      {query && !visible.length && !hidden.length && <p className="panel-notice">No projects match “{filter}”.</p>}
      {hidden.length > 0 && <div className="hidden-projects">
        <button className="section-label toggle" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>{showHidden ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Hidden ({hidden.length})</button>
        {showHidden && <ul className="project-list">{hidden.map(row)}</ul>}
      </div>}
    </nav>
    <div className="sidebar-footer"><button onClick={onOpenFolder}><FolderOpen size={16} /> Open project</button><button onClick={onSettings}><Settings size={16} /> Settings</button></div>
  </aside>
}

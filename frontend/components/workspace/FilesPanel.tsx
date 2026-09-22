'use client'

import { useState } from 'react'
import { ChevronRight, FileCode2, Folder, RefreshCw, ArrowLeft, LockKeyhole } from 'lucide-react'
import { useResource, type FileListing, type FilePreview } from './data'
import { FileEditor } from './FileEditor'
import { useEditorBuffers } from './EditorBuffers'

export function FilesPanel({ projectId }: { projectId: string }) {
  const [directory, setDirectory] = useState('')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [file, setFile] = useState('')
  const [editing, setEditing] = useState(false)
  const editors = useEditorBuffers()
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/files`
  const listing = useResource<FileListing>(`${base}?path=${encodeURIComponent(directory)}&q=${encodeURIComponent(search)}`)
  const preview = useResource<{ preview: FilePreview }>(file ? `${base}/preview?path=${encodeURIComponent(file)}` : null)
  return <div className="files-panel">
    {Object.values(editors.buffers).filter(buffer => buffer.projectId === projectId).length > 0 && <div className="editor-tabs" aria-label="Open file drafts">{Object.values(editors.buffers).filter(buffer => buffer.projectId === projectId).map(buffer => <div key={buffer.path}><button onClick={() => { setFile(buffer.path); setEditing(true) }}>{buffer.path}{buffer.draft !== buffer.original ? ' •' : ''}</button><button aria-label={`Close ${buffer.path}`} disabled={editors.isBusy(projectId, buffer.path)} onClick={() => { if (buffer.draft === buffer.original || window.confirm(`Discard unsaved changes to ${buffer.path}?`)) { editors.close(projectId, buffer.path); if (file === buffer.path) setEditing(false) } }}>×</button></div>)}</div>}
    <form className="panel-search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setFile('') }}>
      <input aria-label="Find project files" value={query} placeholder="Find files by name…" onChange={event => setQuery(event.target.value)} />
      <button type="submit">Find</button><button type="button" aria-label="Refresh files" onClick={() => { listing.refresh(); preview.refresh() }}><RefreshCw size={15} /></button>
    </form>
    {file ? <>
      <div className="panel-toolbar"><button onClick={() => setFile('')}><ArrowLeft size={14} /> Files</button><span title={file}>{file}</span><button disabled={!preview.data || preview.data.preview.truncated} onClick={() => { setEditing(!editing); preview.refresh() }}>{editing ? 'View file' : 'Edit file'}</button></div>
      {editing ? <FileEditor key={`${projectId}/${file}`} projectId={projectId} path={file} /> : <>
        {preview.loading && <p className="panel-notice" role="status">Reading file…</p>}
        {preview.error && <p className="panel-error" role="alert">{preview.error}</p>}
        {preview.data && <><div className="file-meta">{preview.data.preview.lineCount} lines · {preview.data.preview.size.toLocaleString()} bytes{preview.data.preview.truncated && ' · Preview truncated at 256 KB'}</div><pre className="file-source">{preview.data.preview.content.split('\n').map((line, index) => <div key={index}><span aria-hidden="true">{index + 1}</span><code>{line || ' '}</code></div>)}</pre></>}
      </>}
    </> : <>
      <div className="panel-toolbar"><button disabled={!directory && !search} onClick={() => { setDirectory(directory.split('/').slice(0, -1).join('/')); setSearch(''); setQuery('') }}><ArrowLeft size={14} /> Up</button><span>{search ? `Results for “${search}”` : directory || 'Project files'}</span></div>
      {listing.loading && <p className="panel-notice" role="status">Loading files…</p>}
      {listing.error && <p className="panel-error" role="alert">{listing.error}</p>}
      <div className="file-list">{listing.data?.entries.map(entry => <button key={entry.path} disabled={entry.protected} title={entry.protected ? 'Protected file may contain secrets' : entry.path} onClick={() => {
        if (entry.type === 'directory') { setDirectory(entry.path); setSearch(''); setQuery('') } else { setFile(entry.path); setEditing(Boolean(editors.get(projectId, entry.path))) }
      }}>{entry.protected ? <LockKeyhole size={15} /> : entry.type === 'directory' ? <Folder size={15} /> : <FileCode2 size={15} />}<span>{search ? entry.path : entry.name}</span>{entry.type === 'directory' && <ChevronRight size={14} />}</button>)}</div>
      {listing.data && !listing.data.entries.length && <p className="panel-notice">{search ? 'No matching files.' : 'This folder is empty.'}</p>}
      {listing.data?.truncated && <p className="panel-notice">Showing a bounded result set. Narrow your search to find more files.</p>}
    </>}
  </div>
}

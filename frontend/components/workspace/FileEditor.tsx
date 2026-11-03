'use client'

import { useEffect, useState } from 'react'
import { useResource } from './data'
import { useEditorBuffers, type EditableFile } from './EditorBuffers'

export function FileEditor({ projectId, path }: { projectId: string; path: string }) {
  const store = useEditorBuffers()
  const buffer = store.get(projectId, path)
  const remote = useResource<{ file: EditableFile }>(`/api/v1/projects/${encodeURIComponent(projectId)}/files/editor?path=${encodeURIComponent(path)}`)
  const [openError, setOpenError] = useState('')
  const busy = store.isBusy(projectId, path)
  useEffect(() => {
    if (!store.loaded || buffer || !remote.data?.file.editable) return
    try { store.open(projectId, remote.data.file) }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    catch (error) { setOpenError(error instanceof Error ? error.message : 'Could not open editor.') }
  }, [store, buffer, projectId, remote.data])
  const conflict = Boolean(buffer && remote.data && buffer.sha256 !== remote.data.file.sha256)
  const dirty = Boolean(buffer && buffer.original !== buffer.draft)
  const save = async (undo = false) => { await store.save(projectId, path, undo); remote.refresh() }
  return <section className="file-editor" aria-label={`Editor for ${path}`}>
    <p className="muted">Your direct edits. Save changes only this file; it does not authorize Joe to edit.</p>
    {remote.loading && <p role="status">Opening editor…</p>}
    {(remote.error || openError || store.error(projectId, path)) && <p className="panel-error" role="alert">{remote.error || openError || store.error(projectId, path)}</p>}
    {store.notice && <p className="panel-error" role="alert">{store.notice}</p>}
    {remote.data && !remote.data.file.editable && <p>Locked file saving is available on Windows only.</p>}
    {buffer && <>
      <div className="panel-toolbar"><span role="status">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved version loaded'} · {buffer.lineEnding === 'crlf' ? 'CRLF' : 'LF'}</span><button disabled={busy} onClick={remote.refresh}>Check disk</button></div>
      {conflict && <div className="editor-conflict" role="alert"><strong>This file changed on disk.</strong><p>Your draft is retained. Compare it with the current file before saving.</p><details><summary>Current file on disk</summary><pre>{remote.data!.file.content}</pre></details><button disabled={busy} onClick={() => store.patch(projectId, path, { original: remote.data!.file.content, sha256: remote.data!.file.sha256, lineEnding: remote.data!.file.lineEnding, recoveryId: null })}>I reviewed changes; keep my draft</button></div>}
      <textarea className="source-editor" aria-label="File contents" value={buffer.draft} disabled={busy} maxLength={262144} spellCheck={false} autoCapitalize="off" autoCorrect="off" onChange={event => store.patch(projectId, path, { draft: event.target.value })} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); if (dirty && !conflict && !busy) void save() } }} />
      <div className="panel-toolbar"><button className="primary" disabled={busy || !dirty || conflict || !remote.data?.file.editable || Boolean(remote.error)} onClick={() => void save()}>Save file</button><button disabled={busy || dirty || !buffer.recoveryId || conflict || Boolean(remote.error)} onClick={() => void save(true)}>Undo last save</button><button disabled={busy || !remote.data} onClick={() => { if (!dirty || window.confirm('Discard this unsaved draft and load the current file from disk?')) { store.patch(projectId, path, { original: remote.data!.file.content, draft: remote.data!.file.content, sha256: remote.data!.file.sha256, lineEnding: remote.data!.file.lineEnding, recoveryId: null }); setOpenError(''); remote.refresh() } }}>Discard draft / reload</button></div>
      {buffer.recoveryId && <small className="muted">Recovery copy: {buffer.recoveryId}</small>}
    </>}
  </section>
}

'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../lib/api'

export interface EditableFile { path: string; content: string; sha256: string; lineEnding: 'lf' | 'crlf'; size: number; editable: boolean }
export interface EditorBuffer { projectId: string; path: string; original: string; draft: string; sha256: string; lineEnding: 'lf' | 'crlf'; recoveryId: string | null }
const keyFor = (projectId: string, path: string) => JSON.stringify([projectId, path])
function useBuffers() {
  const [buffers, setBuffers] = useState<Record<string, EditorBuffer>>({})
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const requests = useRef(new Set<string>())
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem('jc.editor.buffers.v1') || '[]')
      const valid: Record<string, EditorBuffer> = {}
      if (Array.isArray(stored)) for (const value of stored.slice(0, 8)) {
        if (value && typeof value.projectId === 'string' && value.projectId.startsWith('proj-') && typeof value.path === 'string' && value.path.length <= 1000 && typeof value.original === 'string' && value.original.length <= 262144 && typeof value.draft === 'string' && value.draft.length <= 262144 && /^[a-f0-9]{64}$/.test(value.sha256) && ['lf', 'crlf'].includes(value.lineEnding)) {
          valid[keyFor(value.projectId, value.path)] = { ...value, recoveryId: typeof value.recoveryId === 'string' && /^edit-[a-f0-9-]{36}$/.test(value.recoveryId) ? value.recoveryId : null }
        }
      }
      setBuffers(valid)
    } catch { setNotice('Draft storage is unavailable. Keep this window open to retain unsaved edits.') }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try { sessionStorage.setItem('jc.editor.buffers.v1', JSON.stringify(Object.values(buffers))) }
    catch { setNotice('Draft storage is full or unavailable. Keep this window open to retain unsaved edits.') }
  }, [buffers, loaded])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.values(buffers).some(buffer => buffer.original !== buffer.draft) || requests.current.size) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [buffers])
  const get = (projectId: string, path: string) => buffers[keyFor(projectId, path)]
  const patch = (projectId: string, path: string, fields: Partial<EditorBuffer>) => setBuffers(values => {
    const key = keyFor(projectId, path)
    return values[key] ? { ...values, [key]: { ...values[key], ...fields } } : values
  })
  const open = (projectId: string, file: EditableFile) => {
    if (get(projectId, file.path)) return
    if (Object.keys(buffers).length >= 8) throw new Error('Eight editor buffers are open. Close a saved buffer before opening another.')
    setBuffers(values => ({ ...values, [keyFor(projectId, file.path)]: { projectId, path: file.path, original: file.content, draft: file.content, sha256: file.sha256, lineEnding: file.lineEnding, recoveryId: null } }))
  }
  const close = (projectId: string, path: string) => {
    const key = keyFor(projectId, path)
    if (requests.current.has(key)) return
    setBuffers(values => { const next = { ...values }; delete next[key]; return next })
  }
  const save = async (projectId: string, path: string, undo = false) => {
    const key = keyFor(projectId, path), buffer = buffers[key]
    if (!buffer || requests.current.has(key)) return
    requests.current.add(key); setBusy(values => ({ ...values, [key]: true })); setErrors(values => ({ ...values, [key]: '' }))
    try {
      const result = await apiRequest<{ sha256: string; recoveryId: string | null }>(`/api/v1/projects/${encodeURIComponent(projectId)}/files/editor`, { method: 'POST', body: JSON.stringify(undo
        ? { action: 'undo-save', path, recoveryId: buffer.recoveryId }
        : { action: 'save-file', path, content: buffer.draft, expectedSha256: buffer.sha256, lineEnding: buffer.lineEnding }) })
      if (undo) {
        const data = await apiRequest<{ file: EditableFile }>(`/api/v1/projects/${encodeURIComponent(projectId)}/files/editor?path=${encodeURIComponent(path)}`)
        patch(projectId, path, { original: data.file.content, draft: data.file.content, sha256: data.file.sha256, lineEnding: data.file.lineEnding, recoveryId: result.recoveryId })
      } else patch(projectId, path, { original: buffer.draft, sha256: result.sha256, recoveryId: result.recoveryId })
    } catch (error) { setErrors(values => ({ ...values, [key]: error instanceof Error ? error.message : 'Save failed. Your draft is retained.' })) }
    finally { requests.current.delete(key); setBusy(values => ({ ...values, [key]: false })) }
  }
  return { buffers, loaded, get, patch, open, close, save, notice, isBusy: (projectId: string, path: string) => Boolean(busy[keyFor(projectId, path)]), error: (projectId: string, path: string) => errors[keyFor(projectId, path)] }
}
const EditorContext = createContext<ReturnType<typeof useBuffers> | null>(null)
export function EditorBuffers({ children }: { children: React.ReactNode }) { return <EditorContext.Provider value={useBuffers()}>{children}</EditorContext.Provider> }
export function useEditorBuffers() { const value = useContext(EditorContext); if (!value) throw new Error('Editor buffers are unavailable'); return value }

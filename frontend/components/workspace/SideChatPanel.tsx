'use client'

import { useEffect, useRef, useState } from 'react'
import { apiRequest, createThread } from '../../lib/api'
import type { ChatMessage } from '../../lib/backendTypes'
import { useJobContext } from '../../contexts/JobContext'
import { useResource } from './data'
import { Message } from './Message'

export function SideChatPanel({ projectId }: { projectId: string }) {
  const ctx = useJobContext()
  const [selected, setSelected] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [visibleCount, setVisibleCount] = useState(60)
  const alive = useRef(true)
  const storageKey = `jc.workspace.sidechat.${projectId}`
  const choices = ctx.threads.filter(item => item.id !== ctx.thread?.id && item.status === 'active')
  const threadId = choices.some(item => item.id === selected) ? selected : ''
  const chat = useResource<{ messages: ChatMessage[] }>(threadId ? `/api/v1/projects/${projectId}/threads/${threadId}/chat` : null, 3000)
  useEffect(() => {
    alive.current = true
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}')
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (typeof saved.selected === 'string') setSelected(saved.selected)
      if (saved.drafts && typeof saved.drafts === 'object') setDrafts(Object.fromEntries(Object.entries(saved.drafts).filter((entry): entry is [string, string] => entry[0].startsWith('thread-') && typeof entry[1] === 'string')))
    } catch { /* Keep drafts in memory when storage is unavailable. */ }
    setLoaded(true)
    return () => { alive.current = false }
  }, [storageKey])
  useEffect(() => {
    if (!loaded) return
    try { sessionStorage.setItem(storageKey, JSON.stringify({ selected, drafts })) } catch { /* In-memory drafts remain usable. */ }
  }, [storageKey, loaded, selected, drafts])
  async function newConversation() {
    setPending(true); setError('')
    try {
      const thread = await createThread(projectId, 'Side conversation')
      if (!alive.current) return
      await ctx.refreshProjectData()
      if (alive.current) setSelected(thread.id)
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (alive.current) setPending(false) }
  }
  async function send() {
    const content = drafts[threadId] || ''
    if (!content.trim() || !threadId || pending) return
    setPending(true); setError('')
    try {
      await apiRequest(`/api/v1/projects/${projectId}/threads/${threadId}/chat`, { method: 'POST', body: JSON.stringify({ content, mode: 'ask' }) })
      if (!alive.current) return
      setDrafts(values => values[threadId] === content ? { ...values, [threadId]: '' } : values)
      chat.refresh()
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (alive.current) setPending(false) }
  }
  return <div className="panel-body side-chat">
    <p className="muted">Ask in a separate conversation while keeping your main task open. Side chat cannot start code changes.</p>
    <div className="panel-toolbar"><select aria-label="Side conversation" value={threadId} disabled={pending} onChange={event => { setSelected(event.target.value); setError('') }}><option value="">Choose a conversation</option>{choices.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button disabled={pending} onClick={() => void newConversation()}>New</button></div>
    {error && <p className="panel-error" role="alert">{error}</p>}
    {threadId && <>
      {chat.loading && <p role="status">Loading side conversation…</p>}
      {chat.error && <p className="panel-error" role="alert">{chat.error}</p>}
      {chat.data && chat.data.messages.length > visibleCount && <button onClick={() => setVisibleCount(count => count + 60)}>Earlier messages</button>}
      <div className="side-chat-messages">{chat.data?.messages.slice(-visibleCount).map(message => <article className="chat-message" key={message.id}><strong>{message.role === 'user' ? 'You' : 'Joe'}</strong><Message content={message.content} /></article>)}</div>
      <form onSubmit={event => { event.preventDefault(); void send() }}><textarea aria-label="Side chat message" placeholder="Ask a separate question…" maxLength={4000} value={drafts[threadId] || ''} onChange={event => setDrafts(values => ({ ...values, [threadId]: event.target.value }))} /><button disabled={pending || !drafts[threadId]?.trim()} type="submit">{pending ? 'Sending…' : 'Ask Joe'}</button></form>
    </>}
  </div>
}

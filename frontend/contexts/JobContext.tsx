'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import * as api from '../lib/api'
import type { AgentJob, ChatMessage, Project, ProjectThread, SessionStatus, SurveyEvidence, SurveySummary, WorkOrder } from '../lib/backendTypes'
import { clearSessionState, storeSessionStatus } from '../lib/session'
import { deriveRailStage } from '../lib/workflow'

type Mode = 'ask' | 'plan' | 'build'
const failure = (error: unknown) => error instanceof Error ? error.message : String(error)

function useWorkspaceController() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<SessionStatus | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [threads, setThreads] = useState<ProjectThread[]>([])
  const [thread, setThread] = useState<ProjectThread | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [surveys, setSurveys] = useState<SurveySummary[]>([])
  const [surveyEvidence, setSurveyEvidence] = useState<SurveyEvidence | null>(null)
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [jobs, setJobs] = useState<AgentJob[]>([])
  const [activeJob, setActiveJob] = useState<AgentJob | null>(null)
  const [mode, setMode] = useState<Mode>('build')
  // A generation invalidates old reads even when switching back to the same ID.
  const selection = useRef({ projectId: '', threadId: '', generation: 0 })
  const refreshSequence = useRef(0)
  const rememberedThreads = useRef(new Map<string, string>())

  const refreshProjectData = useCallback(async () => {
    const snapshot = { ...selection.current }
    if (!snapshot.projectId) return
    const sequence = ++refreshSequence.current
    const current = () => selection.current.generation === snapshot.generation && refreshSequence.current === sequence
    const [threadData, surveyData, orderData, jobData, latestProject] = await Promise.all([
      api.getProjectThreads(snapshot.projectId), api.getProjectSurveys(snapshot.projectId),
      api.getWorkOrders(snapshot.projectId), api.getAgentJobs(snapshot.projectId), api.getProject(snapshot.projectId),
    ])
    if (!current()) return
    const selectedId = selection.current.threadId || rememberedThreads.current.get(snapshot.projectId) || threadData.selectedThreadId
    const selected = threadData.threads.find(item => item.id === selectedId) || threadData.threads.find(item => item.status === 'active') || null
    const [chat, evidence] = await Promise.all([
      selected ? api.getThreadChat(snapshot.projectId, selected.id) : Promise.resolve([]),
      latestProject.latestSurveyId ? api.getEvidenceContent(latestProject.latestSurveyId) : Promise.resolve(null),
    ])
    if (!current()) return
    selection.current.threadId = selected?.id || ''
    if (selected) rememberedThreads.current.set(snapshot.projectId, selected.id)
    setProject(latestProject)
    setProjects(items => items.map(item => item.id === latestProject.id ? latestProject : item))
    setThreads(threadData.threads); setThread(selected); setMessages(chat)
    setSurveys(surveyData); setSurveyEvidence(evidence); setWorkOrders(orderData)
    setJobs(jobData.jobs); setActiveJob(jobData.activeJob)
  }, [])

  const activateProject = useCallback(async (next: Project, initialThread = '') => {
    selection.current = { projectId: next.id, threadId: initialThread, generation: selection.current.generation + 1 }
    const generation = selection.current.generation
    setProject(next); setThread(null); setThreads([]); setMessages([])
    setSurveys([]); setSurveyEvidence(null); setWorkOrders([]); setJobs([]); setActiveJob(null)
    setLoading(true); setError(null)
    try { await refreshProjectData() }
    catch (error) { if (selection.current.generation === generation) setError(failure(error)) }
    finally { if (selection.current.generation === generation) setLoading(false) }
  }, [refreshProjectData])

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const status = await api.getSessionStatus()
        if (disposed) return
        storeSessionStatus(status); setSession(status)
        const items = await api.getProjects()
        if (disposed) return
        setProjects(items)
        const query = new URLSearchParams(window.location.search)
        const initial = items.find(item => item.id === query.get('project')) || items[0]
        if (initial) await activateProject(initial, query.get('thread') || '')
      } catch (error) {
        if (!disposed) { clearSessionState(); setError(failure(error)) }
      } finally { if (!disposed) setLoading(false) }
    })()
    return () => { disposed = true; selection.current.generation++ }
  }, [activateProject])

  // Serial polling reconnects automatically and discovers jobs from other windows.
  useEffect(() => {
    if (!project?.id) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const generation = selection.current.generation
      if (!document.hidden) {
        try { await refreshProjectData() }
        catch (error) { if (!disposed && generation === selection.current.generation) setError(failure(error)) }
      }
      if (!disposed) timer = setTimeout(poll, 3000)
    }
    timer = setTimeout(poll, 3000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [project?.id, refreshProjectData])

  const selectProject = async (id: string) => {
    const next = projects.find(item => item.id === id)
    if (next) await activateProject(next)
  }
  const selectThread = async (id: string) => {
    if (!project || !threads.some(item => item.id === id)) return
    selection.current = { projectId: project.id, threadId: id, generation: selection.current.generation + 1 }
    rememberedThreads.current.set(project.id, id)
    setThread(threads.find(item => item.id === id) || null); setMessages([]); setLoading(true); setError(null)
    const generation = selection.current.generation
    try { await refreshProjectData() }
    catch (error) { if (generation === selection.current.generation) setError(failure(error)) }
    finally { if (generation === selection.current.generation) setLoading(false) }
  }
  const createConversation = async () => {
    if (!project) throw new Error('Open a project first.')
    const snapshot = { ...selection.current }
    const next = await api.createThread(project.id, 'New conversation')
    if (snapshot.generation !== selection.current.generation) return
    selection.current.threadId = next.id; selection.current.generation++
    rememberedThreads.current.set(project.id, next.id)
    setThread(next); setMessages([])
    await refreshProjectData()
  }
  const openBuildFolder = async (folderPath?: string) => {
    const picked = folderPath?.trim() ? { cancelled: false, path: folderPath.trim() } : await api.pickFolder()
    if (picked.cancelled || !picked.path) return
    const existing = projects.find(item => item.path.toLowerCase() === picked.path!.toLowerCase())
    const next = existing || await api.createProject({ name: picked.path.split(/[\\/]/).filter(Boolean).at(-1) || 'Project', path: picked.path })
    setProjects(await api.getProjects())
    await activateProject(next)
    if (!next.latestSurveyId && selection.current.projectId === next.id && selection.current.threadId) {
      await api.startAgentJob(next.id, selection.current.threadId, 'Inspect this build read-only and summarize its current condition.', 'build')
      await refreshProjectData()
    }
  }
  const sendComposer = async (content: string) => {
    const snapshot = { ...selection.current }
    if (!snapshot.projectId || !snapshot.threadId) throw new Error('Select a conversation before sending.')
    setError(null)
    if (mode === 'build') await api.startAgentJob(snapshot.projectId, snapshot.threadId, content, 'build')
    else await api.sendThreadMessage(snapshot.projectId, snapshot.threadId, content, mode)
    if (selection.current.generation === snapshot.generation) await refreshProjectData()
  }
  const inspectBuild = async () => {
    if (!project || !thread) throw new Error('Select a conversation before inspecting.')
    await api.startAgentJob(project.id, thread.id, 'Inspect this build read-only, summarize current condition, and list highest-leverage next work.', 'build')
    await refreshProjectData()
  }
  const resumeJob = async () => { if (activeJob) { await api.resumeAgentJob(activeJob.id); await refreshProjectData() } }
  const stopJob = async () => { if (activeJob) { await api.stopAgentJob(activeJob.id); await refreshProjectData() } }
  return { loading, error, session, projects, project, threads, thread, messages, surveys, surveyEvidence, workOrders, jobs, activeJob,
    mode, setMode, setError, openBuildFolder, selectProject, selectThread, createConversation, sendComposer, inspectBuild,
    resumeJob, stopJob, refreshProjectData, railStage: deriveRailStage(project, activeJob) }
}

const JobContext = createContext<ReturnType<typeof useWorkspaceController> | undefined>(undefined)
export function JobProvider({ children }: { children: React.ReactNode }) {
  const value = useWorkspaceController()
  return <JobContext.Provider value={value}>{children}</JobContext.Provider>
}
export function useJobContext() {
  const context = useContext(JobContext)
  if (!context) throw new Error('useJobContext must be used within JobProvider')
  return context
}

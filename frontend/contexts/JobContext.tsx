'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import * as api from '../lib/api'
import type { AgentJob, ChatMessage, Project, ProjectThread, SessionStatus, SurveyEvidence, SurveySummary, WorkOrder } from '../lib/backendTypes'
import { clearSessionState, storeSessionStatus } from '../lib/session'
import { deriveRailStage } from '../lib/workflow'

import { intentFor, type Intent } from '../lib/jobSteps'
/** Server limit for a job objective (AgentJobStartSchema). */
export const JOB_OBJECTIVE_LIMIT = 500
const INTENTS_KEY = 'jc.workspace.intents.v1'
const INTENT_IDS: Intent[] = ['ask', 'plan', 'survey', 'fix', 'feature', 'refactor']
/** Code-changing jobs from this UI pause after planning and peer review until the operator approves. */
const GUIDED = { approval: 'plan' as const, review: true }
/** The objective text sent for a workflow, enforcing the server's length limit. */
export function jobObjective(intent: Intent, content: string): string {
  const objective = (intentFor(intent).prefix + content.trim()).trim()
  if (objective.length > JOB_OBJECTIVE_LIMIT) throw new Error(`This request is ${objective.length} characters including the workflow label; jobs accept ${JOB_OBJECTIVE_LIMIT}. Shorten it.`)
  return objective
}
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
  // The workflow choice is remembered per conversation. A conversation never chosen defaults
  // to read-only Ask, so a new thread cannot start code changes by accident.
  const [intents, setIntents] = useState<Record<string, Intent>>({})
  const [intentsLoaded, setIntentsLoaded] = useState(false)
  // A generation invalidates old reads even when switching back to the same ID.
  const selection = useRef({ projectId: '', threadId: '', generation: 0 })
  const refreshSequence = useRef(0)
  const rememberedThreads = useRef(new Map<string, string>())

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(INTENTS_KEY) || '{}')
      if (saved && typeof saved === 'object') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIntents(Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, Intent] =>
          entry[0].startsWith('thread-') && INTENT_IDS.includes(entry[1] as Intent))))
      }
    } catch { /* Without storage every conversation starts in Ask. */ }
    setIntentsLoaded(true)
  }, [])
  useEffect(() => {
    if (!intentsLoaded) return
    try { localStorage.setItem(INTENTS_KEY, JSON.stringify(intents)) } catch { /* Choices stay in memory. */ }
  }, [intents, intentsLoaded])
  const intent: Intent = (thread && intents[thread.id]) || 'ask'
  const setIntent = useCallback((next: Intent) => {
    const threadId = selection.current.threadId
    if (threadId) setIntents(values => ({ ...values, [threadId]: next }))
  }, [])

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
    const choice = intentFor(intent)
    if (intent === 'ask' || intent === 'plan') await api.sendThreadMessage(snapshot.projectId, snapshot.threadId, content, intent)
    else {
      const objective = jobObjective(intent, content)
      await api.startAgentJob(snapshot.projectId, snapshot.threadId, objective, 'build', choice.changesCode ? GUIDED : {})
    }
    if (selection.current.generation === snapshot.generation) await refreshProjectData()
  }
  // Starts one guided job from a request the user already sent in Ask or Plan.
  const runRequestAsJob = async (request: string) => {
    const snapshot = { ...selection.current }
    if (!snapshot.projectId || !snapshot.threadId) throw new Error('Select a conversation before starting a job.')
    const objective = request.trim()
    if (objective.length > JOB_OBJECTIVE_LIMIT) throw new Error(`This request is ${objective.length} characters; a job request is limited to ${JOB_OBJECTIVE_LIMIT}. Write a shorter request with Fix, Add feature, or Refactor.`)
    setError(null)
    await api.startAgentJob(snapshot.projectId, snapshot.threadId, objective, 'build', GUIDED)
    if (selection.current.generation === snapshot.generation) await refreshProjectData()
  }
  const decidePlan = async (jobId: string, decision: 'approve' | 'discard') => {
    setError(null)
    await api.decidePlan(jobId, decision)
    await refreshProjectData()
  }
  const inspectBuild = async () => {
    if (!project || !thread) throw new Error('Select a conversation before inspecting.')
    await api.startAgentJob(project.id, thread.id, 'Inspect this build read-only, summarize current condition, and list highest-leverage next work.', 'build')
    await refreshProjectData()
  }
  const resumeJob = async () => { if (activeJob) { await api.resumeAgentJob(activeJob.id); await refreshProjectData() } }
  const surveyBuild = async (focus = '') => {
    if (!project || !thread) throw new Error('Select a conversation before starting a survey.')
    await api.startAgentJob(project.id, thread.id, jobObjective('survey', focus || 'summarize current condition, known issues, missing pieces, and the highest-leverage next work.'), 'build')
    await refreshProjectData()
  }
  const stopJob = async () => { if (activeJob) { await api.stopAgentJob(activeJob.id); await refreshProjectData() } }
  return { loading, error, session, projects, project, threads, thread, messages, surveys, surveyEvidence, workOrders, jobs, activeJob,
    intent, setIntent, setError, openBuildFolder, selectProject, selectThread, createConversation, sendComposer, runRequestAsJob, decidePlan, surveyBuild, inspectBuild,
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

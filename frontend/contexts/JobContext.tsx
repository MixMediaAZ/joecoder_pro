'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  createProject,
  createThread,
  getEvidenceContent,
  getAgentJob,
  getAgentJobs,
  getProjectSurveys,
  getProjectThreads,
  getProjects,
  getSessionStatus,
  getThreadChat,
  getWorkOrders,
  pickFolder,
  resumeAgentJob,
  sendThreadMessage,
  startAgentJob,
  stopAgentJob,
} from '../lib/api'
import type {
  AgentJob,
  ChatMessage,
  Project,
  ProjectThread,
  SessionStatus,
  SurveyEvidence,
  SurveySummary,
  WorkOrder,
} from '../lib/backendTypes'
import { clearSessionState, storeSessionStatus } from '../lib/session'
import { deriveRailStage, type RailStage } from '../lib/workflow'

type ComposerMode = 'ask' | 'plan' | 'build'

type JobContextValue = {
  loading: boolean
  error: string | null
  session: SessionStatus | null
  projects: Project[]
  project: Project | null
  threads: ProjectThread[]
  thread: ProjectThread | null
  messages: ChatMessage[]
  surveys: SurveySummary[]
  surveyEvidence: SurveyEvidence | null
  workOrders: WorkOrder[]
  jobs: AgentJob[]
  activeJob: AgentJob | null
  railStage: RailStage
  mode: ComposerMode
  setMode: (mode: ComposerMode) => void
  setError: (message: string | null) => void
  openBuildFolder: () => Promise<void>
  selectProject: (projectId: string) => Promise<void>
  selectThread: (threadId: string) => Promise<void>
  createConversation: () => Promise<void>
  sendComposer: (content: string) => Promise<void>
  inspectBuild: () => Promise<void>
  resumeJob: () => Promise<void>
  stopJob: () => Promise<void>
  refreshProjectData: () => Promise<void>
}

const JobContext = createContext<JobContextValue | undefined>(undefined)

export function JobProvider({ children }: { children: React.ReactNode }) {
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
  const [mode, setMode] = useState<ComposerMode>('build')
  const pollTimer = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const loadThreadMessages = useCallback(async (projectId: string, threadId: string) => {
    const nextMessages = await getThreadChat(projectId, threadId)
    setMessages(nextMessages)
  }, [])

  const refreshProjectData = useCallback(async () => {
    if (!project) return
    const [threadData, surveyData, orderData, jobData] = await Promise.all([
      getProjectThreads(project.id),
      getProjectSurveys(project.id),
      getWorkOrders(project.id),
      getAgentJobs(project.id),
    ])
    setThreads(threadData.threads)
    const selectedThread = threadData.threads.find((item) => item.id === threadData.selectedThreadId) || null
    setThread(selectedThread)
    if (selectedThread) {
      await loadThreadMessages(project.id, selectedThread.id)
    } else {
      setMessages([])
    }
    setSurveys(surveyData)
    const latestSurveyId = project.latestSurveyId || surveyData[0]?.id
    if (latestSurveyId) {
      const evidence = await getEvidenceContent(latestSurveyId)
      setSurveyEvidence(evidence)
    } else {
      setSurveyEvidence(null)
    }
    setWorkOrders(orderData)
    setJobs(jobData.jobs)
    setActiveJob(jobData.activeJob)
  }, [project, loadThreadMessages])

  const loadProjectsAndSelection = useCallback(async () => {
    const projectList = await getProjects()
    setProjects(projectList)
    if (!projectList.length) {
      setProject(null)
      setThreads([])
      setThread(null)
      setMessages([])
      setSurveys([])
      setSurveyEvidence(null)
      setWorkOrders([])
      setJobs([])
      setActiveJob(null)
      return
    }
    const nextProject = project && projectList.some((candidate) => candidate.id === project.id)
      ? projectList.find((candidate) => candidate.id === project.id) || projectList[0]
      : projectList[0]
    setProject(nextProject)
  }, [project])

  const bootstrap = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const status = await getSessionStatus()
      storeSessionStatus(status)
      setSession(status)
      await loadProjectsAndSelection()
    } catch (sessionError) {
      clearSessionState()
      setSession(null)
      setError(sessionError instanceof Error ? sessionError.message : String(sessionError))
    } finally {
      setLoading(false)
    }
  }, [loadProjectsAndSelection])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    if (!project) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshProjectData().catch((projectError: unknown) => {
      setError(projectError instanceof Error ? projectError.message : String(projectError))
    })
  }, [project, refreshProjectData])

  useEffect(() => {
    stopPolling()
    if (!activeJob) return
    if (!['queued', 'running', 'interrupted'].includes(activeJob.status)) return

    pollTimer.current = window.setInterval(() => {
      void getAgentJob(activeJob.id)
        .then((detail) => {
          setActiveJob(detail.job)
          if (!['queued', 'running', 'interrupted'].includes(detail.job.status)) {
            void refreshProjectData()
            stopPolling()
          }
        })
        .catch((pollError: unknown) => {
          setError(pollError instanceof Error ? pollError.message : String(pollError))
          stopPolling()
        })
    }, 3000)

    return stopPolling
  }, [activeJob, refreshProjectData, stopPolling])

  const openBuildFolder = useCallback(async () => {
    setError(null)
    const selected = await pickFolder()
    if (selected.cancelled || !selected.path) return
    const folderName = selected.path.split(/[\\/]/).filter(Boolean).at(-1) || 'build'
    await createProject({ name: folderName, path: selected.path })
    await loadProjectsAndSelection()
  }, [loadProjectsAndSelection])

  const selectProject = useCallback(async (projectId: string) => {
    const next = projects.find((item) => item.id === projectId) || null
    if (!next) return
    setProject(next)
    setError(null)
  }, [projects])

  const selectThread = useCallback(async (threadId: string) => {
    if (!project) return
    const nextThread = threads.find((item) => item.id === threadId) || null
    setThread(nextThread)
    if (!nextThread) {
      setMessages([])
      return
    }
    await loadThreadMessages(project.id, nextThread.id)
  }, [project, threads, loadThreadMessages])

  const createConversation = useCallback(async () => {
    if (!project) return
    const next = await createThread(project.id, `${project.name} conversation`)
    await refreshProjectData()
    await selectThread(next.id)
  }, [project, refreshProjectData, selectThread])

  const sendComposer = useCallback(async (content: string) => {
    if (!project || !thread) return
    const message = content.trim()
    if (!message) return
    setError(null)

    if (mode === 'build') {
      await startAgentJob(project.id, thread.id, message, 'build')
      await refreshProjectData()
      return
    }

    const response = await sendThreadMessage(project.id, thread.id, message, mode)
    setMessages(response.messages)
  }, [mode, project, refreshProjectData, thread])

  const inspectBuild = useCallback(async () => {
    if (!project || !thread) return
    setError(null)
    await startAgentJob(
      project.id,
      thread.id,
      'Inspect this build read-only, summarize current condition, and list highest-leverage next work.',
      'build'
    )
    await refreshProjectData()
  }, [project, refreshProjectData, thread])

  const resumeJob = useCallback(async () => {
    if (!activeJob) return
    await resumeAgentJob(activeJob.id)
    await refreshProjectData()
  }, [activeJob, refreshProjectData])

  const stopJob = useCallback(async () => {
    if (!activeJob) return
    await stopAgentJob(activeJob.id)
    await refreshProjectData()
  }, [activeJob, refreshProjectData])

  const railStage = useMemo(() => deriveRailStage(project, activeJob), [project, activeJob])

  const value = useMemo<JobContextValue>(() => ({
    loading,
    error,
    session,
    projects,
    project,
    threads,
    thread,
    messages,
    surveys,
    surveyEvidence,
    workOrders,
    jobs,
    activeJob,
    railStage,
    mode,
    setMode,
    setError,
    openBuildFolder,
    selectProject,
    selectThread,
    createConversation,
    sendComposer,
    inspectBuild,
    resumeJob,
    stopJob,
    refreshProjectData,
  }), [
    loading,
    error,
    session,
    projects,
    project,
    threads,
    thread,
    messages,
    surveys,
    surveyEvidence,
    workOrders,
    jobs,
    activeJob,
    railStage,
    mode,
    openBuildFolder,
    selectProject,
    selectThread,
    createConversation,
    sendComposer,
    inspectBuild,
    resumeJob,
    stopJob,
    refreshProjectData,
  ])

  return <JobContext.Provider value={value}>{children}</JobContext.Provider>
}

export function useJobContext(): JobContextValue {
  const context = useContext(JobContext)
  if (!context) throw new Error('useJobContext must be used within JobProvider')
  return context
}

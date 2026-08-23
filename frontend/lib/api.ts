import type {
  AgentJob,
  AgentJobDetailResponse,
  ChatMessage,
  Project,
  ProjectThread,
  SessionStatus,
  SurveyEvidence,
  SurveySummary,
  WorkOrder,
} from './backendTypes'
import { getCsrfToken, clearSessionState } from './session'

type JsonObject = Record<string, unknown>

function buildHeaders(
  method: string,
  body: unknown,
  headers: HeadersInit | undefined
): Record<string, string> {
  const merged: Record<string, string> = { ...(headers as Record<string, string> || {}) }
  if (body !== undefined) {
    merged['Content-Type'] = 'application/json'
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !merged['X-JC-CSRF']) {
    const csrfToken = getCsrfToken()
    if (!csrfToken) {
      throw new Error('Secure local session is not ready. Start JoeCoder and reopen this window.')
    }
    merged['X-JC-CSRF'] = csrfToken
    merged['Idempotency-Key'] = crypto.randomUUID()
  }
  return merged
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase()
  const body = options.body
  const response = await fetch(endpoint, {
    ...options,
    method,
    credentials: 'same-origin',
    headers: buildHeaders(method, body, options.headers),
  })

  const payload = await response.json().catch(() => ({} as JsonObject))
  if (response.status === 401) {
    clearSessionState()
    throw new Error('The local session ended. Restart JoeCoder to open a fresh secure window.')
  }
  if (!response.ok) {
    const message = typeof payload.error === 'string'
      ? payload.error
      : `Request failed (${response.status})`
    throw new Error(message)
  }
  return payload as T
}

export async function getSessionStatus(): Promise<SessionStatus> {
  return apiRequest<SessionStatus>('/api/v1/session/status')
}

export async function logout(): Promise<void> {
  await apiRequest('/api/v1/session/logout', { method: 'POST', body: JSON.stringify({}) })
}

export async function pickFolder(): Promise<{ cancelled: boolean; path: string | null }> {
  const response = await apiRequest<{ ok: true; cancelled: boolean; path: string | null }>(
    '/api/v1/system/pick-folder',
    { method: 'POST', body: JSON.stringify({}) }
  )
  return { cancelled: response.cancelled, path: response.path }
}

export async function createProject(input: {
  name: string
  path: string
  description?: string
}): Promise<Project> {
  const response = await apiRequest<{ ok: true; project: Project }>(
    '/api/v1/projects',
    { method: 'POST', body: JSON.stringify(input) }
  )
  return response.project
}

export async function getProjects(): Promise<Project[]> {
  const response = await apiRequest<{ ok: true; projects: Project[] }>('/api/v1/projects')
  return response.projects
}

export async function getProject(projectId: string): Promise<Project> {
  const response = await apiRequest<{ ok: true; project: Project }>(`/api/v1/projects/${projectId}`)
  return response.project
}

export async function getProjectSurveys(projectId: string): Promise<SurveySummary[]> {
  const response = await apiRequest<{ ok: true; surveys: SurveySummary[] }>(
    `/api/v1/projects/${projectId}/surveys`
  )
  return response.surveys
}

export async function getEvidenceContent(evidenceId: string): Promise<SurveyEvidence | null> {
  try {
    return await apiRequest<SurveyEvidence>(`/api/v1/evidence/${evidenceId}`)
  } catch {
    return null
  }
}

export async function getProjectThreads(projectId: string): Promise<{
  selectedThreadId: string
  threads: ProjectThread[]
}> {
  const response = await apiRequest<{ ok: true; selectedThreadId: string; threads: ProjectThread[] }>(
    `/api/v1/projects/${projectId}/threads`
  )
  return { selectedThreadId: response.selectedThreadId, threads: response.threads }
}

export async function createThread(
  projectId: string,
  title: string,
  objective?: string
): Promise<ProjectThread> {
  const response = await apiRequest<{ ok: true; thread: ProjectThread }>(
    `/api/v1/projects/${projectId}/threads`,
    { method: 'POST', body: JSON.stringify({ title, objective }) }
  )
  return response.thread
}

export async function updateThread(
  projectId: string,
  threadId: string,
  updates: { title?: string; objective?: string; presetId?: string }
): Promise<ProjectThread> {
  const response = await apiRequest<{ ok: true; thread: ProjectThread }>(
    `/api/v1/projects/${projectId}/threads/${threadId}`,
    { method: 'PATCH', body: JSON.stringify(updates) }
  )
  return response.thread
}

export async function getThreadChat(projectId: string, threadId: string): Promise<ChatMessage[]> {
  const response = await apiRequest<{ ok: true; messages: ChatMessage[] }>(
    `/api/v1/projects/${projectId}/threads/${threadId}/chat`
  )
  return response.messages
}

export async function sendThreadMessage(
  projectId: string,
  threadId: string,
  content: string,
  mode: 'ask' | 'plan' | 'build'
): Promise<{ messages: ChatMessage[]; reply: ChatMessage }> {
  const response = await apiRequest<{ ok: true; messages: ChatMessage[]; reply: ChatMessage }>(
    `/api/v1/projects/${projectId}/threads/${threadId}/chat`,
    { method: 'POST', body: JSON.stringify({ content, mode }) }
  )
  return { messages: response.messages, reply: response.reply }
}

export async function getAgentJobs(projectId: string): Promise<{
  jobs: AgentJob[]
  activeJob: AgentJob | null
}> {
  const response = await apiRequest<{ ok: true; jobs: AgentJob[]; activeJob: AgentJob | null }>(
    `/api/v1/projects/${projectId}/agent-jobs`
  )
  return { jobs: response.jobs, activeJob: response.activeJob }
}

export async function getAgentJob(jobId: string): Promise<AgentJobDetailResponse> {
  return apiRequest<AgentJobDetailResponse>(`/api/v1/agent-jobs/${jobId}`)
}

export async function startAgentJob(
  projectId: string,
  threadId: string,
  objective: string,
  mode: 'build'
): Promise<AgentJob> {
  const response = await apiRequest<{ ok: true; job: AgentJob }>(
    `/api/v1/projects/${projectId}/threads/${threadId}/agent-jobs`,
    { method: 'POST', body: JSON.stringify({ objective, mode }) }
  )
  return response.job
}

export async function resumeAgentJob(jobId: string): Promise<AgentJob> {
  const response = await apiRequest<{ ok: true; job: AgentJob }>(
    `/api/v1/agent-jobs/${jobId}/resume`,
    { method: 'POST', body: JSON.stringify({}) }
  )
  return response.job
}

export async function stopAgentJob(jobId: string): Promise<void> {
  await apiRequest(`/api/v1/agent-jobs/${jobId}/stop`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function getWorkOrders(projectId: string): Promise<WorkOrder[]> {
  const response = await apiRequest<{ ok: true; workOrders: WorkOrder[] }>(
    `/api/v1/projects/${projectId}/work-orders`
  )
  return response.workOrders
}

export async function checkBackendHealth(origin?: string): Promise<{
  ok: boolean
  statusText: string
  latencyMs: number
}> {
  const start = performance.now()
  const endpoint = origin
    ? `${origin.replace(/\/$/, '')}/health`
    : '/health'
  try {
    const response = await fetch(endpoint, { method: 'GET' })
    const latencyMs = Math.round(performance.now() - start)
    return {
      ok: response.ok,
      statusText: response.ok ? 'Healthy' : `HTTP ${response.status}`,
      latencyMs,
    }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start)
    return {
      ok: false,
      statusText: error instanceof Error ? error.message : 'Connection failed',
      latencyMs,
    }
  }
}

export type { ChatMessage } from './backendTypes'

// Legacy component compatibility (project-scoped chat is required).
export async function getThreadMessages(threadId: string): Promise<ChatMessage[]> {
  void threadId
  return []
}

export async function sendMessage(_threadId: string, content: string): Promise<ChatMessage> {
  return {
    id: `local-${Date.now()}`,
    role: 'assistant',
    content: `Project-scoped chat is required. Use the guided rail composer instead.\n\nLast message: ${content}`,
    createdAt: new Date().toISOString(),
  }
}
export type WorkflowStage =
  | 'no_project'
  | 'folder_selected'
  | 'surface_inspection_running'
  | 'surface_review_ready'
  | 'project_accepted'
  | 'work_order_draft'
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'complete'
  | 'partial'
  | 'blocked'
  | 'cancelled'

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
  description?: string
  workflowStage: WorkflowStage
  buildCondition: string
  lastInspectedAt?: number
  latestSurveyId?: string
  revision?: number
  activeWorkOrderId?: string
  permissions?: {
    readFiles: boolean
    writeFiles: boolean
    installDeps: boolean
    runApp: boolean
    runTests: boolean
    gitCommit: boolean
    gitPush: boolean
  }
}

export interface SurveySummary {
  id: string
  generatedAt?: string
  projectName?: string
  projectType?: string
  status?: string
  summary?: string
}

export interface SurveyEvidence {
  evidenceId: string
  content: {
    summary?: {
      totalFiles?: number
      totalDirectories?: number
      totalSizeBytes?: number
      maxDepthReached?: number
    }
    findings?: Record<string, string[]>
    observations?: string[]
    unknowns?: string[]
    buildCondition?: string
    status?: string
    projectType?: string
    generatedAt?: string
  }
  integrity?: {
    verified: boolean
    reason: string
  }
}

export interface ProjectThread {
  id: string
  projectId: string
  title: string
  objective: string
  presetId: string
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
  lastMessageAt: number | null
}

export interface ChatSuggestion {
  id: string
  label: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  suggestions?: ChatSuggestion[]
}

export type AgentJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'

export type AgentJobStage =
  | 'understand'
  | 'inspect'
  | 'plan'
  | 'authorize'
  | 'run'
  | 'verify'
  | 'complete'
  | 'blocked'

export interface AgentJob {
  id: string
  projectId: string
  threadId: string
  workOrderId?: string
  objective: string
  status: AgentJobStatus
  stage: AgentJobStage
  terminalState?: string
  message?: string
  errorMessage?: string
  createdAt?: string
  updatedAt?: string
  result?: {
    terminalState?: string
    applied?: Array<{
      relPath?: string
      path?: string
      additions?: number
      deletions?: number
    }>
    verification?: {
      status?: string
      detail?: string
    }
  }
}

export interface AgentJobEvent {
  ordinal: number
  stage: string
  kind: string
  what?: string
  meaning?: string
  next?: string
  occurredAt: string
}

export interface AgentJobDetailResponse {
  ok: true
  job: AgentJob
  events: AgentJobEvent[]
  historySummary?: string
}

export interface WorkOrder {
  id: string
  status: string
  intent: string
  objective: string
  scope: {
    exactPaths: string[]
    operations: string[]
  }
  createdAt: string
  updatedAt: string
  evidenceIds?: string[]
  linkedSurveyIntegrity?: {
    verified: boolean
    reason: string
  }
  completion?: {
    passed: boolean
  }
}

export interface SessionStatus {
  ok: true
  sessionId: string
  csrfToken: string
  idleExpiresIn: number
  absoluteExpiresAt: string
}
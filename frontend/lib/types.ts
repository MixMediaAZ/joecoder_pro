/**
 * TypeScript type definitions for the frontend
 */

/**
 * Session state and management
 */
export interface Session {
  id: string
  cookie: string
  projectId?: string
  threadId?: string
  createdAt: string
  expiresAt: string
}

/**
 * Chat message with role and metadata
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  metadata?: Record<string, unknown>
}

/**
 * Workspace pane configuration
 */
export interface WorkspacePane {
  id: string
  type: 'chat' | 'diff' | 'terminal' | 'browser' | 'files' | 'plan' | 'surveys'
  title: string
  visible: boolean
  data?: Record<string, unknown>
}

/**
 * Permission modes for the agent workflow
 */
export type PermissionMode = 'ask' | 'code' | 'plan'

/**
 * Worktree isolation management
 */
export interface Worktree {
  id: string
  name: string
  branch: string
  status: 'active' | 'inactive' | 'detached'
  projectId: string
  createdAt: string
}

/**
 * Visual diff with line changes
 */
export interface DiffFile {
  relPath: string
  oldContent?: string
  newContent: string
  additions: number
  deletions: number
}

/**
 * Skills and capabilities
 */
export interface Skill {
  id: string
  name: string
  description: string
  icon?: string
  enabled: boolean
}

/**
 * Agent job with detailed state
 */
export interface AgentJobDetail {
  id: string
  objective: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  projectId: string
  threadId: string
  createdAt: string
  updatedAt: string
  runtimeState: {
    completedActions: string[]
    currentStep?: string
    progress?: number
    error?: string
  }
  journal: Array<{
    timestamp: string
    event: string
    details?: Record<string, unknown>
  }>
}

/**
 * UI state management
 */
export interface UIState {
  sidebarOpen: boolean
  workspaceExpanded: boolean
  currentPane: string
  permissionMode: PermissionMode
  notifications: Array<{
    id: string
    message: string
    type: 'success' | 'error' | 'warning'
    timestamp: string
  }>
}
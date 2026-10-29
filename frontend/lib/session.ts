import type { SessionStatus } from './backendTypes'

type SessionState = {
  sessionId: string | null
  csrfToken: string | null
  absoluteExpiresAt: string | null
}

const sessionState: SessionState = {
  sessionId: null,
  csrfToken: null,
  absoluteExpiresAt: null,
}

export function getCsrfToken(): string | null {
  return sessionState.csrfToken
}

export function clearSessionState(): void {
  sessionState.sessionId = null
  sessionState.csrfToken = null
  sessionState.absoluteExpiresAt = null
}

export function storeSessionStatus(status: SessionStatus): void {
  sessionState.sessionId = status.sessionId
  sessionState.csrfToken = status.csrfToken
  sessionState.absoluteExpiresAt = status.absoluteExpiresAt
}

export async function refreshSessionStatus(): Promise<SessionStatus | null> {
  const response = await fetch('/api/v1/session/status', {
    credentials: 'same-origin',
  })
  if (response.status === 401) {
    clearSessionState()
    return null
  }
  if (!response.ok) {
    throw new Error(`Failed to load session status (${response.status})`)
  }
  const status = await response.json() as SessionStatus
  storeSessionStatus(status)
  return status
}
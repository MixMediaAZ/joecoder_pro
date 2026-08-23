import type { ChatMessage } from './backendTypes'

export interface PlanReadiness {
  hasInspection: boolean
  hasNumberedSteps: boolean
  hasFileTargets: boolean
  hasChecks: boolean
  hasRisks: boolean
  steps: string[]
  planText: string
}

export function findLatestPlanText(messages: ChatMessage[]): string {
  const planMessages = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .filter((content) => /\d+\.\s/.test(content))
  return planMessages.at(-1) || ''
}

export function extractPlanSteps(planText: string): string[] {
  if (!planText) return []
  return planText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s/.test(line))
    .slice(0, 12)
}

export function evaluatePlanReadiness(messages: ChatMessage[], hasInspection: boolean): PlanReadiness {
  const planText = findLatestPlanText(messages)
  const steps = extractPlanSteps(planText)
  const normalized = planText.toLowerCase()

  return {
    hasInspection,
    hasNumberedSteps: steps.length >= 3,
    hasFileTargets: /\b(file|files|path|paths|src\/|app\/|components\/|lib\/)\b/.test(normalized),
    hasChecks: /\b(test|lint|build|verify|check|validation)\b/.test(normalized),
    hasRisks: /\b(risk|unknown|failure|fallback|edge|limit)\b/.test(normalized),
    steps,
    planText,
  }
}

export function isPlanExecutionReady(readiness: PlanReadiness, reviewConfirmed: boolean): boolean {
  return readiness.hasInspection
    && readiness.hasNumberedSteps
    && readiness.hasFileTargets
    && readiness.hasChecks
    && readiness.hasRisks
    && reviewConfirmed
}

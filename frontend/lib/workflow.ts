import type { AgentJob, Project, WorkflowStage } from './backendTypes'

export type RailStage = 'select' | 'inspect' | 'plan' | 'review' | 'work' | 'verify'

export const railStageOrder: RailStage[] = [
  'select',
  'inspect',
  'plan',
  'review',
  'work',
  'verify',
]

export function workflowLabel(stage?: WorkflowStage): string {
  const labels: Record<WorkflowStage, string> = {
    no_project: 'No project',
    folder_selected: 'Ready to inspect',
    surface_inspection_running: 'Inspecting',
    surface_review_ready: 'Ready for work',
    project_accepted: 'Planning',
    work_order_draft: 'Plan protected',
    awaiting_approval: 'Protecting',
    approved: 'Ready to run',
    executing: 'Working',
    complete: 'Verified work recorded',
    partial: 'Result has limits',
    blocked: 'Needs attention',
    cancelled: 'Stopped',
  }
  if (!stage) return 'No project'
  return labels[stage] || 'Unknown stage'
}

export function deriveRailStage(project: Project | null, activeJob: AgentJob | null): RailStage {
  if (!project) return 'select'
  if (activeJob && ['queued', 'running', 'interrupted'].includes(activeJob.status)) return 'work'

  switch (project.workflowStage) {
    case 'folder_selected':
    case 'surface_inspection_running':
      return 'inspect'
    case 'surface_review_ready':
    case 'project_accepted':
      return 'plan'
    case 'work_order_draft':
    case 'awaiting_approval':
      return 'review'
    case 'approved':
    case 'executing':
      return 'work'
    case 'complete':
    case 'partial':
    case 'blocked':
    case 'cancelled':
      return 'verify'
    default:
      return 'inspect'
  }
}

export function stageIndex(stage: RailStage): number {
  return railStageOrder.indexOf(stage)
}

import type { AgentJob, AgentJobStage, AgentJobStatus, Project, WorkflowStage } from './backendTypes'

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
    complete: 'Job completed — review results',
    partial: 'Result has limits',
    blocked: 'Needs attention',
    cancelled: 'Stopped',
  }
  if (!stage) return 'No project'
  return labels[stage] || 'Unknown stage'
}

const jobStageRail: Record<AgentJobStage, RailStage> = {
  understand: 'inspect', inspect: 'inspect', plan: 'plan', authorize: 'review',
  run: 'work', verify: 'verify', complete: 'verify', blocked: 'verify',
}

export function deriveRailStage(project: Project | null, activeJob: AgentJob | null): RailStage {
  if (!project) return 'select'
  if (activeJob && ['queued', 'running', 'interrupted'].includes(activeJob.status)) return jobStageRail[activeJob.stage] || 'work'

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

const jobStatusLabels: Record<AgentJobStatus, string> = {
  queued: 'Waiting to start', running: 'Working', completed: 'Finished',
  failed: 'Failed', interrupted: 'Interrupted — can resume', cancelled: 'Stopped',
}
const jobStageLabels: Record<AgentJobStage, string> = {
  understand: 'Understanding the request', inspect: 'Inspecting the project', plan: 'Planning the change',
  authorize: 'Protecting files before changes', run: 'Making changes', verify: 'Checking the result',
  complete: 'Complete', blocked: 'Did not finish',
}
export const jobStatusLabel = (status: string) => jobStatusLabels[status as AgentJobStatus] || status.replaceAll('_', ' ')
export const jobStageLabel = (stage: string) => jobStageLabels[stage as AgentJobStage] || stage.replaceAll('_', ' ')

export function stageIndex(stage: RailStage): number {
  return railStageOrder.indexOf(stage)
}

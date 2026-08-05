import type { Project, WorkflowStage, WorkOrder } from './types.js';

export type AcceptanceState = 'can_accept' | 'already_accepted' | 'blocked';

const ACCEPTED_STAGES = new Set<WorkflowStage>([
  'project_accepted',
  'work_order_draft',
  'awaiting_approval',
  'approved',
  'executing',
  'complete',
  'partial',
  'blocked',
  'cancelled'
]);

export function getAcceptanceState(stage: WorkflowStage): AcceptanceState {
  if (stage === 'surface_review_ready') {
    return 'can_accept';
  }
  if (ACCEPTED_STAGES.has(stage)) {
    return 'already_accepted';
  }
  return 'blocked';
}

export function reconcileTerminalWorkOrder(project: Project, workOrder: WorkOrder | undefined): boolean {
  if (!workOrder || project.activeWorkOrderId !== workOrder.id) return false;

  if (workOrder.status === 'completed') {
    project.workflowStage = 'complete';
  } else if (workOrder.status === 'failed') {
    project.workflowStage = 'blocked';
  } else if (workOrder.status === 'cancelled' || workOrder.status === 'rolled_back') {
    project.workflowStage = 'project_accepted';
  } else {
    return false;
  }

  delete project.activeWorkOrderId;
  return true;
}
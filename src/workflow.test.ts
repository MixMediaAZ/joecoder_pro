import assert from 'node:assert/strict';
import test from 'node:test';
import { getAcceptanceState, reconcileTerminalWorkOrder } from './workflow.js';
import type { Project, WorkOrder } from './types.js';

test('acceptance is available only before the project advances', () => {
  assert.equal(getAcceptanceState('folder_selected'), 'blocked');
  assert.equal(getAcceptanceState('surface_inspection_running'), 'blocked');
  assert.equal(getAcceptanceState('surface_review_ready'), 'can_accept');
});

test('acceptance is idempotent after the project advances', () => {
  assert.equal(getAcceptanceState('project_accepted'), 'already_accepted');
  assert.equal(getAcceptanceState('approved'), 'already_accepted');
  assert.equal(getAcceptanceState('complete'), 'already_accepted');
});

test('completed work orders release the project active slot', () => {
  const project = {
    id: 'proj-test',
    name: 'Test',
    path: 'C:\build',
    createdAt: 1,
    workflowStage: 'approved',
    buildCondition: 'unknown',
    activeWorkOrderId: 'JC20-M2-001'
  } as Project;
  const workOrder = { id: 'JC20-M2-001', status: 'completed' } as WorkOrder;

  assert.equal(reconcileTerminalWorkOrder(project, workOrder), true);
  assert.equal(project.workflowStage, 'complete');
  assert.equal(project.activeWorkOrderId, undefined);
});
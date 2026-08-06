import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getActiveMutatingWorkOrder,
  terminalStatusForDeadWorkOrder,
  TERMINAL_WORK_ORDER_STATUSES
} from './workOrder.js';
import { reconcileTerminalWorkOrder } from './workflow.js';
import type { Project, WorkOrder } from './types.js';

function wo(id: string, status: WorkOrder['status']): WorkOrder {
  return {
    id, planVersion: '1.3.1', status, intent: 'repair', objective: `objective for ${id}`,
    scope: { exactPaths: [`src/${id}.ts`], operations: ['edit_files'] },
    dependsOn: [], dependencyCompletionState: 'none_required',
    acceptance: [{ id: `${id}-A`, criterion: 'does the thing', mandatory: true }],
    budgets: { maxFiles: 5, maxDurationMs: 60_000 }
  } as unknown as WorkOrder;
}

function project(id: string, activeWorkOrderId?: string): Project {
  return { id, name: id, path: `D:/tmp/${id}`, workflowStage: 'executing', activeWorkOrderId } as unknown as Project;
}

test('the one-active rule is scoped per project, never global', () => {
  // Regression: getActiveMutatingWorkOrder scanned every Work Order in the application and
  // returned the first authorized/executing one. A stuck job on any project blocked mutating
  // work on every other project — observed live: brand-new proj-55b2a7106003 was refused
  // because JC20-M2-004 (a different project's order) was authorized. Law L3 and all shipped
  // docs say "per project".
  const orders = new Map<string, WorkOrder>([
    ['WO-A', wo('WO-A', 'authorized')],
    ['WO-B', wo('WO-B', 'executing')],
    ['WO-C', wo('WO-C', 'rolled_back')]
  ]);

  // A project holding no slot is never blocked, regardless of other projects' active orders.
  assert.equal(getActiveMutatingWorkOrder(orders, null), null);
  assert.equal(getActiveMutatingWorkOrder(orders, undefined), null);

  // A project holding its own active order sees exactly that order.
  assert.equal(getActiveMutatingWorkOrder(orders, 'WO-A')?.id, 'WO-A');
  assert.equal(getActiveMutatingWorkOrder(orders, 'WO-B')?.id, 'WO-B');

  // A slot pointing at a terminal or missing order holds nothing.
  assert.equal(getActiveMutatingWorkOrder(orders, 'WO-C'), null);
  assert.equal(getActiveMutatingWorkOrder(orders, 'WO-GONE'), null);
});

test('a dead job retires its Work Order to a truthful terminal status', () => {
  // draft never held authority -> cancelled; authorized/executing had authority and did not
  // finish -> failed; already-terminal orders have nothing to retire.
  assert.equal(terminalStatusForDeadWorkOrder('draft'), 'cancelled');
  assert.equal(terminalStatusForDeadWorkOrder('authorized'), 'failed');
  assert.equal(terminalStatusForDeadWorkOrder('executing'), 'failed');
  for (const status of TERMINAL_WORK_ORDER_STATUSES) {
    assert.equal(terminalStatusForDeadWorkOrder(status), null, `${status} is already terminal`);
  }
});

test('every terminal status releases the project slot on reconcile', () => {
  // Regression for the wedge: the slot must never survive its order reaching a terminal state.
  for (const status of ['completed', 'failed', 'cancelled', 'rolled_back'] as const) {
    const order = wo('WO-T', status);
    const holder = project('proj-holder', 'WO-T');
    assert.equal(reconcileTerminalWorkOrder(holder, order), true, `${status} reconciles`);
    assert.equal(holder.activeWorkOrderId, undefined, `${status} releases the slot`);
  }

  // Non-terminal orders are untouched, and other projects' slots are never affected.
  const active = wo('WO-live', 'authorized');
  const holder = project('proj-live', 'WO-live');
  assert.equal(reconcileTerminalWorkOrder(holder, active), false);
  assert.equal(holder.activeWorkOrderId, 'WO-live');
  const bystander = project('proj-bystander', 'WO-other');
  assert.equal(reconcileTerminalWorkOrder(bystander, wo('WO-T', 'failed')), false);
  assert.equal(bystander.activeWorkOrderId, 'WO-other');
});

test('the wedge sequence self-heals end to end', () => {
  // The exact live sequence: a job dies mid-run leaving its order authorized; the slot is held;
  // retire + reconcile must free the project for the next request.
  const order = wo('JC20-M2-004', 'authorized');
  const holder = project('proj-e522f0e697cf', 'JC20-M2-004');

  // While authorized with no retirement, the slot blocks (per-project only).
  const orders = new Map([[order.id, order]]);
  assert.equal(getActiveMutatingWorkOrder(orders, holder.activeWorkOrderId)?.id, 'JC20-M2-004');

  // Dead job -> retire truthfully -> reconcile -> slot free.
  const retired = terminalStatusForDeadWorkOrder(order.status);
  assert.equal(retired, 'failed');
  order.status = retired!;
  assert.equal(reconcileTerminalWorkOrder(holder, order), true);
  assert.equal(holder.activeWorkOrderId, undefined);
  assert.equal(getActiveMutatingWorkOrder(orders, holder.activeWorkOrderId), null);
});

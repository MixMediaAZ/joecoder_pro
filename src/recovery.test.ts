import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyInterruptedExecution } from './recovery.js';
import type { WorkOrder } from './types.js';

function executing(phase?: string, snapshotId?: string, action: 'apply_edits' | 'export_handoff' = 'apply_edits'): WorkOrder {
  const now = '2026-08-01T00:00:00.000Z';
  return {
    id: 'JC20-M2-970',
    planVersion: '20.0',
    status: 'executing',
    intent: action === 'apply_edits' ? 'repair' : 'export',
    objective: 'Recover safely',
    scope: { exactPaths: ['C:\\target'], operations: action === 'apply_edits' ? ['edit_files'] : ['export_handoff'] },
    dependsOn: [],
    dependencyCompletionState: 'none_required',
    acceptance: [],
    budgets: { maxFiles: 2, maxDurationMs: 60000 },
    authorization: { required: true, granted: true, grantedAt: now, grantedBy: 'test' },
    evidenceIds: [],
    linkedSurveyId: null,
    ...(phase ? { execution: { action, phase, startedAt: now, ...(snapshotId ? { snapshotId } : {}) } } : {}),
    createdAt: now,
    updatedAt: now
  };
}

test('interrupted execution recovery is conservative and deterministic', () => {
  assert.equal(classifyInterruptedExecution(executing()).kind, 'blocked');
  assert.equal(classifyInterruptedExecution(executing('starting', undefined, 'export_handoff')).kind, 'safe_fail');
  assert.equal(classifyInterruptedExecution(executing('planning')).kind, 'safe_fail');
  assert.equal(classifyInterruptedExecution(executing('snapshot_ready', 'SNAP-1-aa')).kind, 'safe_fail');

  const committing = classifyInterruptedExecution(executing('committing', 'SNAP-1-aa'));
  assert.equal(committing.kind, 'rollback');
  if (committing.kind === 'rollback') assert.equal(committing.snapshotId, 'SNAP-1-aa');

  assert.equal(classifyInterruptedExecution(executing('committing')).kind, 'blocked');
  assert.equal(classifyInterruptedExecution(executing('verifying', 'SNAP-1-aa')).kind, 'rollback');
});
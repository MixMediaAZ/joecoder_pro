import type { WorkOrder } from './types.js';

export type RecoveryDecision =
  | { kind: 'safe_fail'; reason: string }
  | { kind: 'rollback'; snapshotId: string; reason: string }
  | { kind: 'blocked'; reason: string };

export function classifyInterruptedExecution(workOrder: WorkOrder): RecoveryDecision {
  const execution = workOrder.execution;
  if (!execution) {
    return { kind: 'blocked', reason: 'Legacy execution has no durable phase record; source state is unknown.' };
  }
  if (execution.action === 'export_handoff') {
    return { kind: 'safe_fail', reason: 'Export interruption cannot modify the source project.' };
  }
  if (['planning', 'generating', 'generated', 'snapshot_ready'].includes(execution.phase)) {
    return { kind: 'safe_fail', reason: 'The durable phase proves no source write completed.' };
  }
  if (execution.snapshotId) {
    return { kind: 'rollback', snapshotId: execution.snapshotId, reason: 'A source write may have completed; restore the named snapshot.' };
  }
  return { kind: 'blocked', reason: 'A source write may have completed, but no valid snapshot is recorded.' };
}
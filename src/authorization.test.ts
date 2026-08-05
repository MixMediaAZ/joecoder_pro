import assert from 'node:assert/strict';
import test from 'node:test';
import { sealAuthorizationEnvelope, verifyAuthorizationEnvelope } from './authorization.js';
import type { Project, WorkOrder } from './types.js';

function fixture(): { project: Project; workOrder: WorkOrder } {
  const now = '2026-08-01T00:00:00.000Z';
  const project: Project = {
    id: 'proj-auth',
    name: 'Auth',
    path: 'C:\\auth',
    createdAt: 1,
    workflowStage: 'approved',
    buildCondition: 'partly_working'
  };
  const workOrder: WorkOrder = {
    id: 'JC20-M2-950',
    planVersion: '20.0',
    status: 'authorized',
    intent: 'export',
    objective: 'Create handoff',
    scope: {
      exactPaths: ['C:\\auth'],
      operations: ['inspect', 'export_handoff'],
      network: ['loopback only'],
      providers: []
    },
    dependsOn: [],
    dependencyCompletionState: 'none_required',
    acceptance: [{ id: 'AC-1', criterion: 'Export stays contained', mandatory: true }],
    budgets: { maxFiles: 5, maxDurationMs: 60000, maxCloudCostUsd: 0 },
    risk: { level: 'low', rollbackRequired: false },
    authorization: {
      required: true,
      granted: true,
      grantedAt: now,
      grantedBy: 'test',
      envelopeVersion: 1,
      envelopeHash: null
    },
    evidenceIds: ['EVC-1'],
    linkedSurveyId: 'EVC-1',
    createdAt: now,
    updatedAt: now
  };
  workOrder.authorization.envelopeHash = sealAuthorizationEnvelope(workOrder, project);
  return { project, workOrder };
}

test('immutable authorization envelope rejects post-grant expansion', () => {
  const { project, workOrder } = fixture();
  assert.equal(verifyAuthorizationEnvelope(workOrder, project).valid, true);
  workOrder.status = 'executing';
  workOrder.updatedAt = 'later';
  assert.equal(verifyAuthorizationEnvelope(workOrder, project).valid, true, 'lifecycle fields are not authority');
  workOrder.scope.operations.push('network');
  const result = verifyAuthorizationEnvelope(workOrder, project);
  assert.equal(result.valid, false);
  assert.equal(result.code, 'AUTHORIZATION_ENVELOPE_MISMATCH');
});

test('authorization seal covers objective, budgets, evidence, and project identity', () => {
  const mutations: Array<(project: Project, workOrder: WorkOrder) => void> = [
    (_project, wo) => { wo.objective = 'Expanded objective'; },
    (_project, wo) => { wo.budgets.maxFiles += 1; },
    (_project, wo) => { wo.evidenceIds.push('EVC-2'); },
    (project) => { project.path = 'C:\\other'; }
  ];
  for (const mutate of mutations) {
    const { project, workOrder } = fixture();
    mutate(project, workOrder);
    assert.equal(verifyAuthorizationEnvelope(workOrder, project).valid, false);
  }
});

test('legacy grants without an envelope fail closed', () => {
  const { project, workOrder } = fixture();
  delete workOrder.authorization.envelopeHash;
  delete workOrder.authorization.envelopeVersion;
  const result = verifyAuthorizationEnvelope(workOrder, project);
  assert.equal(result.valid, false);
  assert.equal(result.code, 'AUTHORIZATION_ENVELOPE_MISSING');
});
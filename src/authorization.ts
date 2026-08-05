import { createHash } from 'node:crypto';
import type { Project, WorkOrder } from './types.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

export function authorizationEnvelopeHash(workOrder: WorkOrder, project: Project): string {
  const envelope = {
    version: 1,
    workOrderId: workOrder.id,
    project: { id: project.id, path: project.path, revision: project.revision ?? 0 },
    planVersion: workOrder.planVersion,
    intent: workOrder.intent,
    objective: workOrder.objective,
    scope: workOrder.scope,
    dependsOn: workOrder.dependsOn,
    dependencyCompletionState: workOrder.dependencyCompletionState,
    acceptance: workOrder.acceptance,
    budgets: workOrder.budgets,
    risk: workOrder.risk ?? null,
    linkedSurveyId: workOrder.linkedSurveyId,
    projectRevision: workOrder.projectRevision ?? null,
    evidenceIds: workOrder.evidenceIds,
    taskSpecific: workOrder.taskSpecific ?? null,
    donorDisposition: workOrder.donorDisposition ?? null,
    stopLoss: workOrder.stopLoss ?? null,
    grant: {
      required: workOrder.authorization.required,
      granted: workOrder.authorization.granted,
      grantedAt: workOrder.authorization.grantedAt,
      grantedBy: workOrder.authorization.grantedBy
    }
  };
  return createHash('sha256').update(JSON.stringify(canonicalize(envelope))).digest('hex');
}

export function sealAuthorizationEnvelope(workOrder: WorkOrder, project: Project): string {
  return authorizationEnvelopeHash(workOrder, project);
}

export interface AuthorizationEnvelopeVerification {
  valid: boolean;
  code: 'AUTHORIZATION_ENVELOPE_VALID' | 'AUTHORIZATION_ENVELOPE_MISSING' | 'AUTHORIZATION_ENVELOPE_MISMATCH';
  reason: string;
  authorizedHash: string | null;
  currentHash: string;
}

export function verifyAuthorizationEnvelope(
  workOrder: WorkOrder,
  project: Project
): AuthorizationEnvelopeVerification {
  const currentHash = authorizationEnvelopeHash(workOrder, project);
  const authorizedHash = workOrder.authorization.envelopeHash ?? null;
  if (workOrder.authorization.envelopeVersion !== 1 || !authorizedHash) {
    return {
      valid: false,
      code: 'AUTHORIZATION_ENVELOPE_MISSING',
      reason: 'The authorization predates immutable envelope sealing and cannot be executed.',
      authorizedHash,
      currentHash
    };
  }
  if (authorizedHash !== currentHash) {
    return {
      valid: false,
      code: 'AUTHORIZATION_ENVELOPE_MISMATCH',
      reason: 'The Work Order or project changed after authorization. Review and authorize a new immutable scope.',
      authorizedHash,
      currentHash
    };
  }
  return {
    valid: true,
    code: 'AUTHORIZATION_ENVELOPE_VALID',
    reason: 'The current Work Order matches the exact authorized envelope.',
    authorizedHash,
    currentHash
  };
}
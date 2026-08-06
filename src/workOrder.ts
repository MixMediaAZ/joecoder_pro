import { z } from 'zod';
import type { WorkOrder } from './types.js';

// JC-COMMS laws (from founding 1.3.2) - enforced in core paths
export const COMMS_LAWS = {
  "JC-COMMS-001": {
    title: "Direct evidence-first answer before ceremony",
    rule: "For any direct question, output answer + observed facts + unknowns + recommendation FIRST. Only then ceremony/Work Order."
  },
  "JC-COMMS-002": {
    title: "Blocking questions only; cap at 3",
    rule: "At most 3 blocking questions per turn. Label non-blocking as ASSUMPTION (reversible). Never stall with questions."
  },
  "JC-COMMS-003": {
    title: "Progressive response + no false agreement",
    rule: "For long ops emit progressive status. Reject false premises with evidence. 'I don't know yet' is valid."
  }
} as const;

export type CommsViolation = {
  law: keyof typeof COMMS_LAWS;
  reason: string;
  evidence: string;
};

export function validateCommsCompliance(output: string, context: string = ""): CommsViolation[] {
  const violations: CommsViolation[] = [];
  const lower = output.toLowerCase();

  // Simple heuristic checks (lean enforcement; expand with fixtures later)
  const questionCount = (output.match(/\?/g) || []).length;
  if (questionCount > 3) {
    violations.push({
      law: "JC-COMMS-002",
      reason: `More than 3 questions (${questionCount})`,
      evidence: context || output.slice(0, 200)
    });
  }

  // Check if starts with question without direct answer (rough)
  if (/^\s*\?/.test(output) || (questionCount > 0 && !lower.includes("evidence") && !lower.includes("observed"))) {
    violations.push({
      law: "JC-COMMS-001",
      reason: "Question-first or buried answer without evidence-first structure",
      evidence: context || output.slice(0, 200)
    });
  }

  // No sycophantic agreement on false premises (simple keyword)
  if (lower.includes("you're right") || lower.includes("great point") && lower.includes("but")) {
    violations.push({
      law: "JC-COMMS-003",
      reason: "Potential false agreement or sycophancy detected",
      evidence: context || output.slice(0, 200)
    });
  }

  return violations;
}

export const WorkOrderCreateSchema = z.object({
  id: z.string().regex(/^JC[0-9]+-M[0-9]+-[0-9]{3}$/),
  planVersion: z.string().optional(),
  intent: z.enum(['build', 'survey', 'repair', 'inspect', 'export']),
  objective: z.string().min(1),
  scope: z.object({
    exactPaths: z.array(z.string()).min(1),
    operations: z.array(z.string()).min(1),
    network: z.array(z.string()).optional(),
    providers: z.array(z.string()).optional()
  }).strict(),
  dependsOn: z.array(z.string()).optional(),
  dependencyCompletionState: z.enum(['none_required', 'pending', 'satisfied', 'blocked']).optional(),
  acceptance: z.array(z.object({
    id: z.string(),
    criterion: z.string(),
    mandatory: z.boolean()
  }).strict()).min(1),
  budgets: z.object({
    maxFiles: z.number().int().min(1),
    maxChangedLines: z.number().int().min(1).optional(),
    maxDurationMs: z.number().int().min(1000),
    maxAttempts: z.number().int().min(1).optional(),
    maxCloudCostUsd: z.number().min(0).optional()
  }).strict(),
  risk: z.object({
    level: z.enum(['low', 'medium', 'high']),
    isolationRequired: z.string().optional(),
    rollbackRequired: z.boolean().optional()
  }).strict().optional(),
  evidenceIds: z.array(z.string()).optional(),
  linkedSurveyId: z.string().nullable().optional(),
  taskSpecific: z.object({
    assumptions: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    risks: z.array(z.string()).optional(),
    evidenceArtifacts: z.array(z.string()).optional(),
    evidenceTargets: z.array(z.string()).optional()
  }).strict().optional(),
  donorDisposition: z.object({
    origin: z.string(),
    decision: z.string(),
    fitScore: z.number(),
    evidenceId: z.string().optional()
  }).strict().optional(),
  stopLoss: z.object({
    maxElapsedMin: z.number().int().min(1),
    maxAttempts: z.number().int().min(1),
    maxComputeUnits: z.number().int().min(1),
    maxCloudUsd: z.number().min(0)
  }).strict().optional()
}).strict();

export function buildDraftWorkOrder(body: z.infer<typeof WorkOrderCreateSchema>): WorkOrder {
  const now = new Date().toISOString();
  const budgets: WorkOrder['budgets'] = {
    maxFiles: body.budgets.maxFiles,
    maxDurationMs: body.budgets.maxDurationMs,
    maxAttempts: body.budgets.maxAttempts ?? 1,
    maxCloudCostUsd: body.budgets.maxCloudCostUsd ?? 0
  };
  if (body.budgets.maxChangedLines !== undefined) {
    budgets.maxChangedLines = body.budgets.maxChangedLines;
  }

  const risk: WorkOrder['risk'] = body.risk
    ? {
        level: body.risk.level,
        ...(body.risk.isolationRequired !== undefined
          ? { isolationRequired: body.risk.isolationRequired }
          : {}),
        ...(body.risk.rollbackRequired !== undefined
          ? { rollbackRequired: body.risk.rollbackRequired }
          : {})
      }
    : { level: 'low', rollbackRequired: false };

  const wo: WorkOrder = {
    id: body.id,
    planVersion: body.planVersion || '20.0',
    status: 'draft',
    intent: body.intent,
    objective: body.objective,
    scope: {
      exactPaths: body.scope.exactPaths,
      operations: body.scope.operations,
      network: body.scope.network || ['loopback only'],
      providers: body.scope.providers || []
    },
    dependsOn: body.dependsOn || [],
    dependencyCompletionState:
      body.dependencyCompletionState || (body.dependsOn?.length ? 'pending' : 'none_required'),
    acceptance: body.acceptance,
    budgets,
    risk,
    authorization: {
      required: true,
      granted: false,
      grantedAt: null,
      grantedBy: null,
      envelopeVersion: null,
      envelopeHash: null
    },
    evidenceIds: body.evidenceIds || [],
    linkedSurveyId: body.linkedSurveyId ?? null,
    createdAt: now,
    updatedAt: now
  };

  // exactOptionalPropertyTypes-safe optional fields
  wo.taskSpecific = {
    assumptions: body.taskSpecific?.assumptions || [],
    constraints: body.taskSpecific?.constraints || [],
    risks: body.taskSpecific?.risks || [],
    evidenceArtifacts: body.taskSpecific?.evidenceArtifacts || [],
    // Evidence-identified files the edit stage is required to touch; dropped here would mean
    // the enforcement silently never fires.
    evidenceTargets: body.taskSpecific?.evidenceTargets || []
  };

  if (body.donorDisposition) {
    const dd: NonNullable<WorkOrder['donorDisposition']> = {
      origin: body.donorDisposition.origin,
      decision: body.donorDisposition.decision,
      fitScore: body.donorDisposition.fitScore
    };
    if (body.donorDisposition.evidenceId !== undefined) {
      dd.evidenceId = body.donorDisposition.evidenceId;
    }
    wo.donorDisposition = dd;
  }

  wo.stopLoss = body.stopLoss || {
    maxElapsedMin: 30,
    maxAttempts: 3,
    maxComputeUnits: 100,
    maxCloudUsd: 0
  };

  return wo;
}

/**
 * The active mutating Work Order **for one project**.
 *
 * This previously scanned every Work Order in the application and returned the first authorized or
 * executing one, with no project filter -- so a single in-flight or stuck job on any project
 * blocked mutating work on every other project. Law L3 and the shipped documentation all state the
 * rule is per project ("One active Work Order per project", "One active mutating job is allowed
 * per project"), so the global scan was both a capability defect and a law violation.
 *
 * WorkOrder carries no projectId, so ownership comes from the project's own activeWorkOrderId,
 * which is the existing linkage. Callers pass that id; undefined or null means the project holds
 * no slot and mutating work may begin.
 */
export function getActiveMutatingWorkOrder(
  workOrders: Map<string, WorkOrder>,
  projectActiveWorkOrderId: string | null | undefined
): WorkOrder | null {
  if (!projectActiveWorkOrderId) return null;
  const wo = workOrders.get(projectActiveWorkOrderId);
  if (!wo) return null;
  return wo.status === 'authorized' || wo.status === 'executing' ? wo : null;
}

export const TERMINAL_WORK_ORDER_STATUSES = new Set<WorkOrder['status']>([
  'completed', 'failed', 'rolled_back', 'cancelled'
]);

/**
 * The truthful terminal status for a Work Order whose job died without one.
 *
 * A job that fails safe records its own terminal state but previously left its Work Order in
 * `draft` or `authorized` forever. The project slot then stayed held, every new request was
 * refused with "Resume that exact job" -- and resume only accepts `interrupted` jobs, so the
 * instruction was impossible to follow. The tool wedged itself with no exposed way out.
 *
 * Mapping: a draft never held authority, so it is `cancelled`; an authorized or executing order
 * had authority and did not finish, so it is `failed`. Returns null when the order is already
 * terminal (nothing to retire).
 */
export function terminalStatusForDeadWorkOrder(status: WorkOrder['status']): 'cancelled' | 'failed' | null {
  if (TERMINAL_WORK_ORDER_STATUSES.has(status)) return null;
  return status === 'draft' ? 'cancelled' : 'failed';
}

// N2: Real DAG enforcement + cycle detection (founding 1.3.2 point 4)
export function detectCycle(woId: string, dependsOn: string[], workOrders: Map<string, WorkOrder>, visited = new Set<string>(), recStack = new Set<string>()): boolean {
  visited.add(woId);
  recStack.add(woId);

  for (const depId of dependsOn) {
    if (!workOrders.has(depId)) continue;
    if (!visited.has(depId)) {
      if (detectCycle(depId, workOrders.get(depId)!.dependsOn, workOrders, visited, recStack)) {
        return true;
      }
    } else if (recStack.has(depId)) {
      return true;
    }
  }

  recStack.delete(woId);
  return false;
}

export function areDependenciesSatisfied(wo: WorkOrder, workOrders: Map<string, WorkOrder>): { satisfied: boolean; incomplete: string[] } {
  const incomplete: string[] = [];
  for (const depId of wo.dependsOn || []) {
    const dep = workOrders.get(depId);
    if (!dep || dep.status !== 'completed') {
      incomplete.push(depId);
    }
  }
  return { satisfied: incomplete.length === 0, incomplete };
}

export function validateDAG(wo: WorkOrder, workOrders: Map<string, WorkOrder>): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  
  // Cycle check
  if (detectCycle(wo.id, wo.dependsOn || [], workOrders)) {
    violations.push(`Cycle detected involving ${wo.id}`);
  }
  
  // Dependency satisfaction (for authorize)
  const depCheck = areDependenciesSatisfied(wo, workOrders);
  if (!depCheck.satisfied) {
    violations.push(`Incomplete dependencies: ${depCheck.incomplete.join(', ')}`);
  }
  
  return { valid: violations.length === 0, violations };
}

// N4: Lightweight donor disposition stub (founding 8) - read-only scan of evidence
export async function performDonorDisposition(
  objective: string,
  workOrders: Map<string, WorkOrder>
): Promise<NonNullable<WorkOrder['donorDisposition']>> {
  // Simple heuristic: look for similar past WOs by objective keywords
  const keywords = objective.toLowerCase().split(/\s+/).slice(0, 5);
  let bestMatch: { id: string; score: number } | null = null;

  for (const [id, wo] of workOrders) {
    const woText = (wo.objective + ' ' + JSON.stringify(wo.scope)).toLowerCase();
    const score = keywords.filter(k => woText.includes(k)).length / keywords.length;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { id, score };
    }
  }

  if (bestMatch && bestMatch.score > 0.4) {
    const result: NonNullable<WorkOrder['donorDisposition']> = {
      origin: `past-wo-${bestMatch.id}`,
      decision: 'reuse concept + adapt',
      fitScore: Math.round(bestMatch.score * 100)
    };
    return result;
  }

  return {
    origin: 'none',
    decision: 'no useful donor — clean impl',
    fitScore: 0
  };
}

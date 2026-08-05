import type { SurveyResult, WorkOrder } from './types.js';
import { detectNoProgress } from './structuredControl.js';

export interface ObjectiveFrame {
  objective: string;
  successConditions: string[];
  constraints: string[];
  ambiguities: string[];
}

export interface HypothesisLedger {
  knownFacts: string[];
  inferences: string[];
  unknowns: string[];
}

export interface AgentWorkingPlan {
  targetFiles: string[];
  intendedChanges: string[];
  risks: string[];
  rollbackMethod: string;
  verificationCommands: string[];
}

export interface VerificationDecision {
  passed: boolean;
  reason: string;
  evidenceFingerprint: string;
}

export interface VerificationAttempt<TVerification> {
  attempt: number;
  correctionCycle: number;
  verification: TVerification;
  decision: VerificationDecision;
}

export interface CorrectionLoopResult<TVerification> {
  passed: boolean;
  reason: string;
  verification: TVerification;
  attempts: VerificationAttempt<TVerification>[];
  corrections: number;
  stoppedBy: 'success' | 'attempt_limit' | 'time_limit' | 'no_progress';
}

export function frameObjective(request: string): ObjectiveFrame {
  const objective = request.replace(/\s+/g, ' ').trim().slice(0, 500);
  return {
    objective,
    successConditions: [
      `The requested outcome is observable: ${objective}`,
      'All mandatory project-supported checks pass or any unavailable proof is reported as a limitation.',
      'Every changed path remains inside the sealed authorization and is backed by recorded evidence.'
    ],
    constraints: [
      'Use only evidence observed from the selected project.',
      'Make the smallest coherent change inside the sealed path, operation, time, cost, and attempt budgets.',
      'Keep every write reversible until completion is proven.'
    ],
    ambiguities: objective ? [] : ['The requested outcome is empty.']
  };
}

export function buildHypothesisLedger(survey: SurveyResult): HypothesisLedger {
  const stack = survey.stackProfiles?.map((profile) => profile.label).join(', ') || survey.projectType || 'unknown';
  const knownFacts = [
    `The bounded survey observed ${survey.summary.totalFiles} files and ${survey.summary.totalDirectories} directories.`,
    `Observed project stack: ${stack}.`,
    `Observed build condition: ${survey.buildCondition}.`,
    ...survey.findings.broken.map((item) => `Observed broken or blocked: ${item}`),
    ...survey.observations.map((item) => `Observed: ${item}`)
  ];
  const inferences = [
    ...survey.findings.questionable.map((item) => `Needs confirmation: ${item}`),
    ...survey.findings.mockOrPlaceholder.map((item) => `May be incomplete or placeholder: ${item}`)
  ];
  const unknowns = [
    ...survey.unknowns,
    ...survey.findings.unknown,
    ...(survey.status === 'truncated' ? [survey.truncatedReason || 'The survey reached a configured limit.'] : [])
  ];
  return {
    knownFacts: Array.from(new Set(knownFacts)).slice(0, 100),
    inferences: Array.from(new Set(inferences)).slice(0, 100),
    unknowns: Array.from(new Set(unknowns)).slice(0, 100)
  };
}

export function buildAgentWorkingPlan(workOrder: WorkOrder, survey?: SurveyResult | null): AgentWorkingPlan {
  const verificationCommands = Array.from(new Set(
    (survey?.stackProfiles || []).flatMap((profile) => profile.commands.map((command) => command.display))
  ));
  const statedRisks = workOrder.taskSpecific?.risks || [];
  return {
    targetFiles: [...workOrder.scope.exactPaths],
    intendedChanges: [
      workOrder.taskSpecific?.assumptions?.[0] || `Implement the smallest coherent change for: ${workOrder.objective}`
    ],
    risks: Array.from(new Set([
      ...statedRisks,
      ...(workOrder.risk?.rollbackRequired ? ['The change must remain restorable until verification passes.'] : []),
      ...(verificationCommands.length ? [] : ['No runnable project verification command was discovered.'])
    ])),
    rollbackMethod: workOrder.risk?.rollbackRequired
      ? 'Restore every scoped file from the pre-write hash-verified snapshot.'
      : 'No mutation is authorized, or the sealed work order does not require rollback.',
    verificationCommands
  };
}

/**
 * Server-controlled verification and correction loop. Model output is never
 * trusted here: callers supply a verified assessment and a governed correction
 * operation. Success is possible only after a fresh verification says passed.
 */
export async function runVerificationCorrectionLoop<TVerification>(options: {
  maxAttempts: number;
  deadlineAt: number;
  verify: (attempt: number) => Promise<TVerification>;
  assess: (verification: TVerification) => VerificationDecision;
  correct: (input: {
    correctionCycle: number;
    failedVerification: TVerification;
    decision: VerificationDecision;
    history: VerificationAttempt<TVerification>[];
  }) => Promise<void>;
  onAttempt?: (attempt: VerificationAttempt<TVerification>) => void | Promise<void>;
}): Promise<CorrectionLoopResult<TVerification>> {
  const maxAttempts = Math.max(1, Math.min(Math.trunc(options.maxAttempts), 10));
  const attempts: VerificationAttempt<TVerification>[] = [];
  let corrections = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (Date.now() >= options.deadlineAt) {
      const previous = attempts.at(-1);
      if (!previous) throw new Error('VERIFICATION_TIME_LIMIT_BEFORE_FIRST_CHECK');
      return {
        passed: false,
        reason: 'The sealed time limit expired before another evidence-backed check could run.',
        verification: previous.verification,
        attempts,
        corrections,
        stoppedBy: 'time_limit'
      };
    }
    const verification = await options.verify(attempt);
    const decision = options.assess(verification);
    const record = { attempt, correctionCycle: corrections, verification, decision };
    attempts.push(record);
    await options.onAttempt?.(record);
    if (decision.passed) {
      return {
        passed: true,
        reason: decision.reason,
        verification,
        attempts,
        corrections,
        stoppedBy: 'success'
      };
    }
    const progress = detectNoProgress(attempts.map((item) => ({
      action: 'verify',
      evidenceFingerprint: item.decision.evidenceFingerprint,
      outcome: item.decision.passed ? 'progress' as const : 'failure' as const
    })));
    if (progress.blocked) {
      return {
        passed: false,
        reason: progress.reason || decision.reason,
        verification,
        attempts,
        corrections,
        stoppedBy: 'no_progress'
      };
    }
    if (attempt === maxAttempts) {
      return {
        passed: false,
        reason: decision.reason,
        verification,
        attempts,
        corrections,
        stoppedBy: 'attempt_limit'
      };
    }
    if (Date.now() >= options.deadlineAt) {
      return {
        passed: false,
        reason: 'The sealed time limit expired after verification failed; no further correction was permitted.',
        verification,
        attempts,
        corrections,
        stoppedBy: 'time_limit'
      };
    }
    corrections += 1;
    await options.correct({
      correctionCycle: corrections,
      failedVerification: verification,
      decision,
      history: [...attempts]
    });
  }
  throw new Error('VERIFICATION_LOOP_UNREACHABLE');
}

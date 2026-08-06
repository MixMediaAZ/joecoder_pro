import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkOrder } from './types.js';
import type { ApplyEditsResult } from './mutation.js';
import { verificationProofLevel, type VerificationReport } from './verification.js';

export interface AcceptanceResult {
  id: string;
  criterion: string;
  passed: boolean;
  evidenceIds: string[];
  detail: string;
}

export interface CompletionDecision {
  passed: boolean;
  results: AcceptanceResult[];
  reason: string;
}

export async function evaluateExportCompletion(
  workOrder: WorkOrder,
  exportRoot: string,
  exportPath: string,
  applyEvidenceId: string,
  evidenceVerified: (id: string) => Promise<boolean>
): Promise<CompletionDecision> {
  const resolvedRoot = path.resolve(exportRoot);
  const resolvedExport = path.resolve(exportPath);
  const contained = resolvedExport.startsWith(`${resolvedRoot}${path.sep}`);
  const summaryPath = path.join(resolvedExport, 'job-summary.json');
  const surveyPath = path.join(resolvedExport, 'survey-handoff.md');
  const [summaryExists, surveyExists, applyVerified, surveyVerified] = await Promise.all([
    fs.stat(summaryPath).then((item) => item.isFile()).catch(() => false),
    fs.stat(surveyPath).then((item) => item.isFile()).catch(() => false),
    evidenceVerified(applyEvidenceId),
    workOrder.linkedSurveyId ? evidenceVerified(workOrder.linkedSurveyId) : Promise.resolve(false)
  ]);

  const observed = [
    {
      id: `${workOrder.id}-AUTH`,
      criterion: 'Explicit authorization remains active for the declared operation',
      passed: workOrder.authorization.granted && workOrder.scope.operations.includes('export_handoff'),
      evidenceIds: [],
      detail: workOrder.authorization.granted ? 'Authorization present.' : 'Authorization absent.'
    },
    {
      id: `${workOrder.id}-BOUNDARY`,
      criterion: 'Output is contained under JoeCoder protected export storage',
      passed: contained,
      evidenceIds: [applyEvidenceId],
      detail: contained ? resolvedExport : `Escaped export root: ${resolvedExport}`
    },
    {
      id: `${workOrder.id}-ARTIFACTS`,
      criterion: 'Required handoff artifacts exist',
      passed: summaryExists && surveyExists,
      evidenceIds: [applyEvidenceId],
      detail: `summary=${summaryExists}; survey=${surveyExists}`
    },
    {
      id: `${workOrder.id}-EVIDENCE`,
      criterion: 'Source survey and completion evidence pass content-hash verification',
      passed: applyVerified && surveyVerified,
      evidenceIds: [workOrder.linkedSurveyId, applyEvidenceId].filter((id): id is string => Boolean(id)),
      detail: `apply=${applyVerified}; survey=${surveyVerified}`
    }
  ] satisfies AcceptanceResult[];

  const passed = observed.every((result) => result.passed);
  return {
    passed,
    results: observed,
    reason: passed ? 'All mandatory completion checks passed.' : 'One or more mandatory completion checks failed.'
  };
}

/**
 * Completion reducer for model-backed repair applies. Completion is derived
 * from evidence — authorization, scope containment, budget adherence, runtime
 * verification, and hash-verified apply evidence — never declared.
 */
export async function evaluateRepairCompletion(
  workOrder: WorkOrder,
  applyResult: ApplyEditsResult,
  verification: VerificationReport,
  applyEvidenceId: string,
  evidenceVerified: (id: string) => Promise<boolean>
): Promise<CompletionDecision> {
  const scope = new Set((workOrder.scope.exactPaths || []).map((p) => p.replace(/\\/g, '/')));
  const outOfScope = applyResult.applied.filter((change) => !scope.has(change.relPath));
  const withinFiles = applyResult.applied.length <= workOrder.budgets.maxFiles;
  const withinLines = workOrder.budgets.maxChangedLines === undefined
    || applyResult.totalChangedLines <= workOrder.budgets.maxChangedLines;
  const applyVerified = await evidenceVerified(applyEvidenceId);
  const proofLevel = verificationProofLevel(verification);

  const observed = [
    {
      id: `${workOrder.id}-AUTH`,
      criterion: 'Explicit authorization remains active for the edit_files operation',
      passed: workOrder.authorization.granted && workOrder.scope.operations.includes('edit_files'),
      evidenceIds: [],
      detail: workOrder.authorization.granted ? 'Authorization present.' : 'Authorization absent.'
    },
    {
      id: `${workOrder.id}-SCOPE`,
      criterion: 'Every written file is inside the authorized exactPaths scope',
      passed: outOfScope.length === 0,
      evidenceIds: [applyEvidenceId],
      detail: outOfScope.length === 0
        ? `${applyResult.applied.length} file(s) written, all in scope.`
        : `Out of scope: ${outOfScope.map((c) => c.relPath).join(', ')}`
    },
    {
      id: `${workOrder.id}-BUDGET`,
      criterion: 'File and changed-line budgets were respected',
      passed: withinFiles && withinLines,
      evidenceIds: [applyEvidenceId],
      detail: `files=${applyResult.applied.length}/${workOrder.budgets.maxFiles}; changedLines=${applyResult.totalChangedLines}/${workOrder.budgets.maxChangedLines ?? 'unlimited'}`
    },
    {
      id: `${workOrder.id}-VERIFY`,
      criterion: verification.status === 'passed'
        ? (verification.preexistingFailures?.length
          ? 'Runtime verification shows no regression against the recorded baseline (pre-existing failures recorded as limitations, not fixed by this change)'
          : (verification.items || []).some((i) => i.script === 'file_integrity')
            ? 'Post-apply file-integrity verification passed (not full test suite)'
            : 'Runtime verification (build/test) passed')
        : verification.status === 'no_scripts'
          ? 'No runnable scripts/hashes — verification inconclusive (not treated as failure)'
          : 'Runtime verification (build/test) failed',
      passed: verification.status !== 'failed',
      evidenceIds: [applyEvidenceId],
      detail: `${verification.status}: ${verification.detail}`
    },
    {
      id: `${workOrder.id}-EVIDENCE`,
      criterion: 'Apply evidence passes content-hash verification',
      passed: applyVerified,
      evidenceIds: [applyEvidenceId],
      detail: applyVerified ? 'Evidence hash verified.' : 'Evidence unverified.'
    }
  ] satisfies AcceptanceResult[];

  const passed = observed.every((result) => result.passed);
  return {
    passed,
    results: observed,
    reason: passed
      ? proofLevel === 'runtime'
        ? 'The authorized repair completed with passing runtime build/test proof.'
        : proofLevel === 'integrity'
          ? 'The authorized file change completed with hash integrity proof; runtime behavior remains unproven.'
          : 'The authorized repair lifecycle completed without runtime proof.'
      : `Repair completion denied: ${observed.filter((r) => !r.passed).map((r) => r.criterion).join('; ')}.`
  };
}

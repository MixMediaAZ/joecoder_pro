export function isSubstantialObjective(objective: string): boolean {
  const concernGroups = [
    /\b(browser|ui|user|display|view|control panel|dashboard|polished)\b/i,
    /\b(api|server|upload|analy[sz]e|cli|http|create|edit|delete|filter|complete)\b/i,
    /\b(persist|durable|storage|restart|jsonl?|state|record)\b/i
  ];
  return concernGroups.filter((pattern) => pattern.test(objective)).length >= 3;
}

/**
 * Apply-phase duration only — planning has already finished when this budget starts.
 * Substantial local-model jobs need several 3-file generation batches plus install,
 * verification, and at least one correction cycle. A flat 10-minute ceiling exhausted
 * qwen3.6 mid-generation after a correct 12-file InspectorCode seal.
 */
export function sealedDurationMsForPlan(objective: string, fileCount: number): number {
  const files = Math.max(1, Math.trunc(fileCount));
  if (isSubstantialObjective(objective) || files >= 8) {
    return Math.min(1_800_000, Math.max(1_200_000, 300_000 + files * 120_000));
  }
  return 600_000;
}

export function requiresOperationalRuntimeProof(intent: string, objective: string): boolean {
  return intent === 'build'
    || /\b(run|runnable|start|launch|work(?:ing)?|end[ -]to[ -]end)\b/i.test(objective);
}

/** Operational repair with recorded survey/doctor targets — causal completeness beats file-count theater. */
export function isCausalEvidenceRepair(objective: string, evidenceTargets: string[] | undefined): boolean {
  return requiresOperationalRuntimeProof('repair', objective) && Array.isArray(evidenceTargets) && evidenceTargets.length > 0;
}

export function topLevelAreaCount(paths: string[]): number {
  return new Set(
    paths.map((file) => {
      const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
      return normalized.includes('/') ? normalized.split('/')[0] : '.';
    })
  ).size;
}

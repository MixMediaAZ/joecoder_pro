export const REQUIRED_RELEASE_GATE_COMMANDS = [
  'npm test',
  'npm run verify:governance',
  'node tools/e2e-live.mjs'
] as const;

export interface ReleaseGateReceipt {
  schemaVersion?: unknown;
  kind?: unknown;
  sourceCommit?: unknown;
  modelMode?: unknown;
  worktreeClean?: unknown;
  status?: unknown;
  results?: unknown;
}

export function validateReleaseGateReceipt(receipt: ReleaseGateReceipt, sourceCommit: string): string[] {
  const failures: string[] = [];
  if (receipt.schemaVersion !== 1) failures.push('schemaVersion');
  if (receipt.kind !== 'release-gates') failures.push('kind');
  if (receipt.sourceCommit !== sourceCommit) failures.push('sourceCommit');
  if (receipt.modelMode !== 'real') failures.push('modelMode');
  if (receipt.worktreeClean !== true) failures.push('worktreeClean');
  if (receipt.status !== 'passed') failures.push('status');
  if (!Array.isArray(receipt.results)) {
    failures.push('results');
    return failures;
  }
  const results = receipt.results as Array<Record<string, unknown>>;
  if (results.length !== REQUIRED_RELEASE_GATE_COMMANDS.length) failures.push('resultCount');
  for (const command of REQUIRED_RELEASE_GATE_COMMANDS) {
    const matches = results.filter(result => result.command === command);
    if (matches.length !== 1 || matches[0]?.exitCode !== 0 || matches[0]?.passed !== true) {
      failures.push(`command:${command}`);
    }
  }
  return failures;
}

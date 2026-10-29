import assert from 'node:assert/strict';
import test from 'node:test';
import { REQUIRED_RELEASE_GATE_COMMANDS, validateReleaseGateReceipt } from './releaseGate.js';

const commit = 'a'.repeat(40);
const valid = () => ({
  schemaVersion: 1,
  kind: 'release-gates',
  sourceCommit: commit,
  modelMode: 'real',
  worktreeClean: true,
  status: 'passed',
  results: REQUIRED_RELEASE_GATE_COMMANDS.map(command => ({ command, exitCode: 0, passed: true }))
});

test('release gate accepts only a complete real-model receipt for the exact source commit', () => {
  assert.deepEqual(validateReleaseGateReceipt(valid(), commit), []);
});

test('release gate rejects stale, mock, dirty, failed, missing, and duplicated evidence', () => {
  const cases = [
    { ...valid(), sourceCommit: 'b'.repeat(40) },
    { ...valid(), modelMode: 'mock' },
    { ...valid(), worktreeClean: false },
    { ...valid(), status: 'failed' },
    { ...valid(), results: valid().results.slice(1) },
    { ...valid(), results: [...valid().results, valid().results[0]] },
    { ...valid(), results: valid().results.map((result, index) => index === 0 ? { ...result, exitCode: 1, passed: false } : result) }
  ];
  for (const receipt of cases) assert.ok(validateReleaseGateReceipt(receipt, commit).length > 0);
});

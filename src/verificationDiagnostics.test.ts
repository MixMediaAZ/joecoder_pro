import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticExcerpt, verificationEvidenceFingerprint } from './verification.js';

test('bounded verification diagnostics retain the failure lead and final stack context', () => {
  const lines = [
    'TAP version 13',
    'not ok 1 - migration and API',
    'error: SQLITE_ERROR: no such column: fullname',
    ...Array.from({ length: 120 }, (_, index) => `stack line ${index + 1}`),
    '# fail 1'
  ];
  const excerpt = diagnosticExcerpt(lines.join('\n'), 80);
  assert.ok(excerpt.length <= 80);
  assert.ok(excerpt.includes('error: SQLITE_ERROR: no such column: fullname'));
  assert.equal(excerpt.at(-1), '# fail 1');
  assert.ok(excerpt.some((line) => /line\(s\) omitted/.test(line)));
});
test('verification evidence fingerprint ignores timing noise but preserves behavior changes', () => {
  const report = (actual: string, duration: string) => ({
    status: 'failed' as const,
    detail: 'Verification failed.',
    items: [{
      script: 'test' as const,
      command: 'npm run test',
      root: '.',
      exitCode: 1,
      timedOut: false,
      passed: false,
      outputTail: ['  duration_ms: 1.23', `  actual: '${actual}'`, `# duration_ms ${duration}`]
    }]
  });
  assert.equal(verificationEvidenceFingerprint(report('6', '400.1')), verificationEvidenceFingerprint(report('6', '900.9')));
  assert.notEqual(verificationEvidenceFingerprint(report('6', '400.1')), verificationEvidenceFingerprint(report('5', '400.1')));
});
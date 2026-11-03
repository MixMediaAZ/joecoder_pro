import assert from 'node:assert/strict';
import test from 'node:test';
import { requireRuntimeVerification, verificationProofLevel, type VerificationReport } from './verification.js';

function report(items: VerificationReport['items'], status: VerificationReport['status'] = 'passed'): VerificationReport {
  return { status, detail: 'test report', items };
}

const item = (script: 'build' | 'test' | 'file_integrity', passed = true) => ({
  script,
  command: script,
  root: '.',
  exitCode: passed ? 0 : 1,
  timedOut: false,
  passed,
  outputTail: []
});

test('proof level never promotes file integrity to runtime verification', () => {
  assert.equal(verificationProofLevel(report([item('file_integrity')])), 'integrity');
  assert.equal(verificationProofLevel(report([item('build')])), 'runtime');
  assert.equal(verificationProofLevel(report([], 'no_scripts')), 'none');
  assert.equal(verificationProofLevel(report([item('test', false)], 'failed')), 'failed');
});

test('runnable objectives receive actionable correction evidence when only file integrity passed', () => {
  const result = requireRuntimeVerification(report([item('file_integrity')]));
  assert.equal(result.status, 'failed');
  assert.equal(verificationProofLevel(result), 'failed');
  assert.match(result.detail, /RUNTIME_VERIFICATION_REQUIRED/);
  assert.ok(result.items.some(check => !check.passed && check.outputTail.some(line => line.includes('package.json'))));
  const runtime = report([item('test')]);
  assert.equal(requireRuntimeVerification(runtime), runtime);
});

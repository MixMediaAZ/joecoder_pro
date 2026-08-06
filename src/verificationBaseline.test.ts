import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustVerificationForBaseline, type VerificationItem, type VerificationReport } from './verification.js';

function item(script: VerificationItem['script'], command: string, passed: boolean, root = '.'): VerificationItem {
  return { script, command, root, exitCode: passed ? 0 : 1, timedOut: false, passed, outputTail: [] };
}

function report(status: VerificationReport['status'], items: VerificationItem[]): VerificationReport {
  return { status, detail: `${status} fixture`, items };
}

// The live Stage 2 case: the qualification project carries 1,931 pre-existing analyzer issues.
// JoeCoder made the correct one-line dependency fix, `flutter analyze`/`flutter test` failed on
// the inherited mess, the correction loop could not fix 1,931 pre-existing problems, and the
// right change was rolled back. The honest standard for a bounded repair is no-regression.
test('pre-existing failures do not veto a change that caused no regression', () => {
  const baseline = report('failed', [
    item('analyze', 'flutter analyze', false),
    item('test', 'flutter test', false)
  ]);
  const post = report('failed', [
    item('analyze', 'flutter analyze', false),
    item('test', 'flutter test', false)
  ]);
  const adjusted = adjustVerificationForBaseline(baseline, post);
  assert.equal(adjusted.status, 'passed');
  assert.equal(adjusted.preexistingFailures?.length, 2);
  assert.match(adjusted.detail, /No regression against the recorded baseline/);
  assert.match(adjusted.detail, /recorded as limitations/);
});

test('a genuine regression still fails, even alongside pre-existing failures', () => {
  const baseline = report('failed', [
    item('analyze', 'flutter analyze', false),
    item('test', 'flutter test', true)
  ]);
  const post = report('failed', [
    item('analyze', 'flutter analyze', false),
    item('test', 'flutter test', false) // passed at baseline, fails now: the change broke it
  ]);
  const adjusted = adjustVerificationForBaseline(baseline, post);
  assert.equal(adjusted.status, 'failed');
  assert.equal(adjusted.preexistingFailures?.length, 1);
  assert.match(adjusted.detail, /pre-existing from the baseline/);
});

test('file integrity is never excusable as pre-existing', () => {
  // Integrity judges the exact bytes this change wrote; a baseline cannot pre-fail it.
  const baseline = report('failed', [item('file_integrity', 'file_integrity', false)]);
  const post = report('failed', [item('file_integrity', 'file_integrity', false)]);
  const adjusted = adjustVerificationForBaseline(baseline, post);
  assert.equal(adjusted.status, 'failed');
});

test('without a baseline, or with a passing post report, nothing changes', () => {
  const post = report('failed', [item('analyze', 'flutter analyze', false)]);
  assert.equal(adjustVerificationForBaseline(null, post), post);

  const passing = report('passed', [item('analyze', 'flutter analyze', true)]);
  assert.equal(adjustVerificationForBaseline(report('failed', [item('analyze', 'flutter analyze', false)]), passing), passing);
});

test('a check new since baseline that fails is a failure, not pre-existing', () => {
  const baseline = report('passed', []);
  const post = report('failed', [item('test', 'flutter test', false)]);
  const adjusted = adjustVerificationForBaseline(baseline, post);
  assert.equal(adjusted.status, 'failed');
  assert.equal(adjusted.preexistingFailures, undefined);
});

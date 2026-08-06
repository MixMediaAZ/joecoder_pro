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

test('a both-sides failure that got measurably worse is a regression, not pre-existing', () => {
  // Live job-2 case: flutter analyze failed at baseline with 25 issues and after the edit with
  // 39; pass/fail comparison alone called that "pre-existing" and let the job complete.
  const before = item('analyze', 'flutter analyze', false);
  before.outputTail = ['25 issues found. (ran in 5.1s)'];
  const after = item('analyze', 'flutter analyze', false);
  after.outputTail = ['39 issues found. (ran in 4.2s)'];
  const adjusted = adjustVerificationForBaseline(report('failed', [before]), report('failed', [after]));
  assert.equal(adjusted.status, 'failed');

  // Same or fewer issues stays pre-existing.
  const sameAfter = item('analyze', 'flutter analyze', false);
  sameAfter.outputTail = ['25 issues found. (ran in 3.9s)'];
  const same = adjustVerificationForBaseline(report('failed', [before]), report('failed', [sameAfter]));
  assert.equal(same.status, 'passed');
  assert.equal(same.preexistingFailures?.length, 1);
});

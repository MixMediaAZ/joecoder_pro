import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyExecutionResult, inferIntent, successfulTerminal } from './agentJobDriver.js';

test('explicit read-only inspection cannot grant mutation through the noun build', () => {
  for (const objective of [
    'Inspect this build read-only and summarize its current condition.',
    'Inspect this build and report the problems.',
    'Review how to fix this code, without modifying files.',
    'Explain how to repair this build.',
    'What do you think of this project?'
  ]) assert.equal(inferIntent(objective, { summary: { totalFiles: 20 } }), 'inspect', objective);
  assert.equal(inferIntent('Inspect this build and then fix the startup error.', { summary: { totalFiles: 20 } }), 'repair');
  assert.equal(inferIntent('Build a local Workboard.', { summary: { totalFiles: 0 } }), 'build');
});

test('ordinary make-it-work language is classified as a repair', () => {
  assert.equal(
    inferIntent('Make this app run locally end to end and still work after restart.', { summary: { totalFiles: 20 } }),
    'repair'
  );
});

test('an explicit read-only analysis remains inspection', () => {
  assert.equal(
    inferIntent('Analyze this project and report what is broken.', { summary: { totalFiles: 20 } }),
    'inspect'
  );
});

const runtimeVerification = {
  status: 'passed' as const,
  detail: 'Tests passed.',
  items: [{
    script: 'test' as const,
    command: 'npm test',
    root: '.',
    exitCode: 0,
    timedOut: false,
    passed: true,
    outputTail: ['pass']
  }]
};

test('mock model can never produce an unqualified terminal success', () => {
  const result = successfulTerminal({
    model: 'jc-mock-model',
    mockModel: true,
    verification: runtimeVerification
  });
  assert.equal(result.terminalState, 'completed_with_limits');
  assert.equal(result.proofLevel, 'runtime');
  assert.match(result.reason, /mock output cannot prove production coding capability/i);
});

test('real model with passing runtime proof remains eligible for terminal success', () => {
  const result = successfulTerminal({
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    mockModel: false,
    verification: runtimeVerification
  });
  assert.equal(result.terminalState, 'completed');
  assert.equal(result.proofLevel, 'runtime');
});

test('real model without runtime proof reports an explicit limitation', () => {
  const result = successfulTerminal({
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    mockModel: false,
    verification: {
      status: 'no_scripts',
      detail: 'No runnable scripts.',
      items: [{
        script: 'file_integrity',
        command: 'sha256',
        root: '.',
        exitCode: 0,
        timedOut: false,
        passed: true,
        outputTail: ['hash matched']
      }]
    }
  });
  assert.equal(result.terminalState, 'completed_with_limits');
});

test('completion denials classify as failed_safe with acceptance criteria text', () => {
  const result = classifyExecutionResult({
    code: 'COMPLETION_EVIDENCE_FAILED',
    error: 'Repair completion denied: Runtime verification (build/test) failed.',
    rolledBack: true,
    acceptanceResults: [
      { id: 'X-VERIFY', criterion: 'Runtime verification (build/test) failed', passed: false }
    ],
    verification: {
      status: 'failed',
      detail: 'build failed',
      items: [{
        script: 'build',
        command: 'npm run build',
        root: '.',
        exitCode: 1,
        timedOut: false,
        passed: false,
        outputTail: ['error']
      }]
    }
  });
  assert.equal(result.terminalState, 'failed_safe');
  assert.equal(result.proofLevel, 'failed');
  assert.match(result.reason, /Runtime verification \(build\/test\) failed/);
});

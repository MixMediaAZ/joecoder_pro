import test from 'node:test';
import assert from 'node:assert/strict';
import { inferIntent, successfulTerminal } from './agentJobDriver.js';

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

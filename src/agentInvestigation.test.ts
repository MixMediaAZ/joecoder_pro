import assert from 'node:assert/strict';
import test from 'node:test';
import { generateInvestigationTurn, investigationTurnFitsBudget, parseInvestigationAction } from './agentInvestigation.js';
import { ModelRouter, ModelRoutingError, type ModelProviderAdapter, type ModelRouteAttempt } from './modelRouter.js';

const provider = { available: true, provider: 'powerrouter' as const, model: 'auto', reason: 'test', capabilities: ['code', 'tools'] };
const request = { system: 'Investigate using read-only JSON actions.', prompt: 'Inspect startup.', maxTokens: 200, timeoutMs: 20, format: 'json' as const };
const done = '{"done":true,"summary":"Observed startup configuration; runtime remains unverified."}';

test('investigation reserves room for edits without expanding the twelve-turn budget', () => {
  assert.equal(investigationTurnFitsBudget(4), true);
  assert.equal(investigationTurnFitsBudget(5), false);
  assert.equal(investigationTurnFitsBudget(8, 2), true);
  assert.equal(investigationTurnFitsBudget(9, 2), false);
});

test('verbose read annotations are bounded without altering tool arguments or accepting new authority', () => {
  const request = { tool: 'files.read', input: { path: 'start.bat', startLine: 1, endLine: 50 }, reason: 'Read the actual startup entry. '.repeat(30) };
  const result = parseInvestigationAction(JSON.stringify(request));
  assert.ok('tool' in result);
  assert.equal(result.tool, 'files.read');
  assert.deepEqual(result.input, request.input);
  assert.ok(result.reason.length <= 500);
  assert.match(result.reason, /\[excerpt truncated\]$/);
  assert.throws(() => parseInvestigationAction(JSON.stringify({ ...request, tool: 'files.write' })), /INVALID_MODEL_OUTPUT/);
  assert.throws(() => parseInvestigationAction(JSON.stringify({ ...request, approval: true })), /INVALID_MODEL_OUTPUT/);
  assert.throws(() => parseInvestigationAction(JSON.stringify({ ...request, reason: 'x'.repeat(2001) })), /INVALID_MODEL_OUTPUT/);
});

test('investigation failures expose actual provider causes and classify malformed output correctly', async () => {
  const attempts: ModelRouteAttempt[] = [];
  const router = new ModelRouter([
    adapter('gateway', async () => ({ text: '{"tool":"files.write","input":{},"reason":"not authorized"}' })),
    adapter('local', async () => { throw new Error('MODEL_REQUEST_TIMEOUT'); })
  ]);
  await assert.rejects(generateInvestigationTurn(provider, request, attempt => attempts.push(attempt), (turn, observe) => router.execute(turn, observe)),
    (error: unknown) => error instanceof ModelRoutingError && /powerrouter: INVALID_MODEL_OUTPUT/.test(error.message) && /ollama: MODEL_REQUEST_TIMEOUT/.test(error.message));
  assert.equal(attempts.find(attempt => attempt.status === 'failed')?.errorClass, 'invalid_output');
});
function adapter(id: string, generate: ModelProviderAdapter['generate'], cloud = false): ModelProviderAdapter {
  return { profile: { id, provider: cloud ? 'anthropic' : id === 'gateway' ? 'powerrouter' : 'ollama',
    model: id, location: cloud ? 'cloud' : 'local', enabled: true, capabilities: ['code', 'tools'],
    contextWindowTokens: 32768, taskTypes: ['investigation'], qualityTier: id === 'gateway' ? 6 : 5,
    inputCostPerMillionTokens: 0, outputCostPerMillionTokens: 0 }, generate };
}

test('a stalled investigation gateway is aborted and a local model supplies the validated action', async () => {
  let gatewaySignal: AbortSignal | undefined, cloudCalls = 0;
  const attempts: ModelRouteAttempt[] = [];
  const router = new ModelRouter([
    adapter('gateway', async input => { gatewaySignal = input.signal; return new Promise(() => {}); }),
    adapter('local', async input => { assert.equal(input.structuredSchemaName, 'investigation_action'); return { text: done }; }),
    adapter('cloud', async () => { cloudCalls++; return { text: done }; }, true)
  ]);
  const result = await generateInvestigationTurn(provider, request, item => attempts.push(item), (turn, observe) => router.execute(turn, observe));
  assert.equal(result.provider, 'ollama');
  assert.equal(result.model, 'local');
  assert.equal(result.costUsd, 0);
  assert.equal(gatewaySignal?.aborted, true);
  assert.equal(cloudCalls, 0);
  assert.equal(attempts.find(item => item.status === 'failed')?.errorClass, 'timeout');
  assert.equal(attempts.at(-1)?.status, 'succeeded');
});

test('a proposed write is rejected before the fallback returns a read-only action', async () => {
  const router = new ModelRouter([
    adapter('gateway', async () => ({ text: '{"tool":"files.write","input":{"path":"start.bat"},"reason":"change it"}' })),
    adapter('local', async () => ({ text: '{"tool":"files.read","input":{"path":"start.bat"},"reason":"inspect startup"}' }))
  ]);
  const result = await generateInvestigationTurn(provider, request, undefined, (turn, observe) => router.execute(turn, observe));
  assert.equal(result.provider, 'ollama');
  assert.equal(JSON.parse(result.text).tool, 'files.read');
});

test('investigation fallback preserves capability requirements and cannot reach cloud', async () => {
  let cloudCalls = 0, incompatibleCalls = 0;
  const incompatible = adapter('local', async () => { incompatibleCalls++; return { text: done }; });
  incompatible.profile.capabilities = ['code'];
  const router = new ModelRouter([
    adapter('gateway', async () => { throw new Error('MODEL_UNAVAILABLE'); }), incompatible,
    adapter('cloud', async () => { cloudCalls++; return { text: done }; }, true)
  ]);
  await assert.rejects(generateInvestigationTurn(provider, request, undefined, (turn, observe) => router.execute(turn, observe)), ModelRoutingError);
  assert.equal(cloudCalls, 0);
  assert.equal(incompatibleCalls, 0);
});

test('operator cancellation stops investigation without attempting a local fallback', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const router = new ModelRouter([
    adapter('gateway', async () => { calls++; return { text: done }; }),
    adapter('local', async () => { calls++; return { text: done }; })
  ]);
  await assert.rejects(generateInvestigationTurn(provider, { ...request, signal: controller.signal }, undefined,
    (turn, observe) => router.execute(turn, observe)), /cancelled/i);
  assert.equal(calls, 0);
});

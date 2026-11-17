import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCodingTurn } from './agentGeneration.js';
import { ModelRouter, type ModelProviderAdapter } from './modelRouter.js';
import type { ProviderResolution } from './providers.js';
import { generateStructured } from './repair.js';

const provider: ProviderResolution = { available: true, provider: 'powerrouter', model: 'gateway', reason: 'local', capabilities: ['code'], eligibleProviders: ['powerrouter', 'ollama'] };
const request = { system: 'Return JSON', prompt: 'Build', format: 'json' as const, maxTokens: 64000 };
function adapter(name: string, generate: ModelProviderAdapter['generate']): ModelProviderAdapter {
  return { profile: { id: name, provider: name, model: name, location: 'local', enabled: true,
    capabilities: ['code'], contextWindowTokens: 32768, taskTypes: ['implementation'],
    qualityTier: name === 'powerrouter' ? 3 : 2, inputCostPerMillionTokens: 0, outputCostPerMillionTokens: 0 }, generate };
}

test('coding retries invalid gateway output through the existing authorized local router', async () => {
  const calls: string[] = [];
  const router = new ModelRouter([
    adapter('powerrouter', async () => { calls.push('gateway'); return { text: 'invalid' }; }),
    adapter('ollama', async incoming => {
      calls.push('local');
      assert.equal(incoming.structuredSchemaName, 'coding_plan');
      assert.ok(incoming.maxOutputTokens < 32768);
      return { text: '{"ok":true}' };
    })
  ]);
  const result = await generateCodingTurn(provider, request, { task: 'implementation', validate: JSON.parse }, async (incoming, listener) => {
    assert.equal(incoming.authorizedCloudBudgetUsd, 0);
    assert.equal(incoming.privacyMode, 'local_only');
    assert.deepEqual(incoming.allowedProviders, ['powerrouter', 'ollama']);
    return router.execute(incoming, listener);
  });
  assert.deepEqual(calls, ['gateway', 'local']);
  assert.equal(result.provider, 'ollama');
  assert.equal(result.model, 'ollama');
});

test('coding rejects an unauthorized selected provider before dispatch', async () => {
  let called = false;
  await assert.rejects(generateCodingTurn(provider, request, { task: 'implementation', validate: JSON.parse, allowedProviders: ['ollama'] }, async () => { called = true; throw Error('unexpected'); }), /OUTSIDE_AUTHORITY/);
  assert.equal(called, false);
});

test('rejected routed output still receives bounded structured-format recovery', async () => {
  let calls = 0;
  const generate: ModelProviderAdapter['generate'] = async incoming => {
    calls++;
    return { text: incoming.messages.some(message => message.content.includes('PREVIOUS RESPONSE WAS INVALID')) ? '{"ok":true}' : 'bad json' };
  };
  const router = new ModelRouter([adapter('powerrouter', generate), adapter('ollama', generate)]);
  const result = await generateStructured({ generate: incoming => generateCodingTurn(provider, incoming,
    { task: 'implementation', validate: JSON.parse }, (incoming, listener) => router.execute(incoming, listener)) },
    { system: 'JSON', prompt: 'Generate', parse: JSON.parse, label: 'test', maxAttempts: 2, maxTokens: 100 });
  assert.equal(calls, 3);
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.attempts.length, 2);
});

test('router excludes providers outside the sealed allowlist before any generation', async () => {
  let excludedCalls = 0;
  const router = new ModelRouter([
    adapter('powerrouter', async () => { excludedCalls++; return { text: '{}' }; }),
    adapter('ollama', async () => ({ text: '{}' }))
  ]);
  const result = await router.execute({ messages: [{ role: 'user', content: 'test' }], taskType: 'implementation',
    requiredCapabilities: ['code'], privacyMode: 'local_only', authorizedCloudBudgetUsd: 0,
    allowedProviders: ['ollama'], maxOutputTokens: 100, temperature: 0, timeoutMs: 1000 });
  assert.equal(result.provider, 'ollama');
  assert.equal(excludedCalls, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelRouter, ModelRoutingError, type ModelProviderAdapter, type ModelProviderProfile } from './modelRouter.js';

function adapter(profile: Partial<ModelProviderProfile> & Pick<ModelProviderProfile, 'id' | 'provider' | 'model' | 'location'>, generate: ModelProviderAdapter['generate']): ModelProviderAdapter {
  return {
    profile: {
      enabled: true,
      capabilities: ['chat', 'code', 'tools'],
      contextWindowTokens: 32_000,
      taskTypes: ['conversation', 'investigation', 'implementation', 'review', 'structured_control'],
      qualityTier: 1,
      inputCostPerMillionTokens: profile.location === 'cloud' ? 3 : 0,
      outputCostPerMillionTokens: profile.location === 'cloud' ? 15 : 0,
      ...profile
    },
    generate
  };
}

const baseRequest = {
  messages: [{ role: 'user' as const, content: 'Return valid control JSON.' }],
  maxOutputTokens: 200,
  temperature: 0,
  timeoutMs: 5_000,
  taskType: 'structured_control' as const,
  requiredCapabilities: ['code', 'tools'],
  privacyMode: 'local_only' as const,
  authorizedCloudBudgetUsd: 0,
  validate: (text: string) => {
    const value = JSON.parse(text) as { ok?: unknown };
    if (value.ok !== true) throw new Error('invalid structured response');
  }
};

test('weak local invalid output reroutes to a stronger eligible local model and records every reason', async () => {
  const records: string[] = [];
  const router = new ModelRouter([
    adapter({ id: 'local-weak', provider: 'ollama', model: 'coder:7b', location: 'local', qualityTier: 3 }, async () => ({ text: 'not json' })),
    adapter({ id: 'local-strong', provider: 'ollama', model: 'coder:32b', location: 'local', qualityTier: 2 }, async () => ({ text: '{"ok":true}', usage: { inputTokens: 10, outputTokens: 4, costUsd: 0 } }))
  ]);
  const result = await router.execute(baseRequest, (attempt) => { records.push(`${attempt.model}:${attempt.status}`); });
  assert.equal(result.model, 'coder:32b');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.errorClass, 'invalid_output');
  assert.deepEqual(records, ['coder:7b:selected', 'coder:7b:failed', 'coder:32b:selected', 'coder:32b:succeeded']);
  assert.match(result.routingReason, /task=structured_control specialized/);
});

test('disabled and failed providers reroute, but local-only never crosses to cloud', async () => {
  const router = new ModelRouter([
    adapter({ id: 'disabled', provider: 'ollama', model: 'off', location: 'local', enabled: false, qualityTier: 9 }, async () => ({ text: '{"ok":true}' })),
    adapter({ id: 'failing', provider: 'ollama', model: 'broken', location: 'local', qualityTier: 3 }, async () => { throw new Error('connection unavailable'); }),
    adapter({ id: 'cloud', provider: 'anthropic', model: 'cloud-strong', location: 'cloud', qualityTier: 9 }, async () => ({ text: '{"ok":true}' })),
    adapter({ id: 'healthy', provider: 'ollama', model: 'local-good', location: 'local', qualityTier: 1 }, async () => ({ text: '{"ok":true}' }))
  ]);
  const result = await router.execute(baseRequest);
  assert.equal(result.model, 'local-good');
  assert.ok(result.attempts.every((attempt) => attempt.provider !== 'anthropic'));
});

test('cloud fallback requires authorized privacy and fits estimated and actual cost budget', async () => {
  const cloud = adapter({
    id: 'cloud', provider: 'anthropic', model: 'cloud-review', location: 'cloud', qualityTier: 5,
    inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 1
  }, async () => ({ text: '{"ok":true}', usage: { inputTokens: 10, outputTokens: 10, costUsd: 0.00002 } }));
  const router = new ModelRouter([cloud]);
  await assert.rejects(router.execute(baseRequest), (error: unknown) => error instanceof ModelRoutingError && error.attempts.length === 0);
  const result = await router.execute({
    ...baseRequest,
    privacyMode: 'authorized_cloud',
    authorizedCloudBudgetUsd: 0.01
  });
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.usage.costUsd, 0.00002);
});

test('capability, context, and cost gaps stop clearly when no eligible model exists', async () => {
  const router = new ModelRouter([
    adapter({ id: 'tiny', provider: 'ollama', model: 'tiny', location: 'local', contextWindowTokens: 4, capabilities: ['chat'] }, async () => ({ text: '{"ok":true}' }))
  ]);
  await assert.rejects(
    router.execute(baseRequest),
    (error: unknown) => error instanceof ModelRoutingError && /No configured model satisfies/.test(error.message)
  );
});

test('provider errors are redacted before routing records are persisted', async () => {
  const router = new ModelRouter([
    adapter({ id: 'leaky', provider: 'anthropic', model: 'bad', location: 'local' }, async () => {
      throw new Error('401 Bearer sk-ant-supersecret012345678901234567890123456789');
    })
  ]);
  await assert.rejects(
    router.execute(baseRequest),
    (error: unknown) => error instanceof ModelRoutingError &&
      !JSON.stringify(error.attempts).includes('supersecret') &&
      JSON.stringify(error.attempts).includes('[REDACTED]')
  );
});

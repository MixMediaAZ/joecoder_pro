import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateWithProvider,
  missingProviderCapabilities,
  providerCapabilities,
  resetProviderCache,
  resolveProvider
} from './providers.js';

test('provider capability comparison is explicit and deterministic', () => {
  assert.deepEqual(missingProviderCapabilities('anthropic', ['vision', 'code', 'vision']), []);
  assert.deepEqual(missingProviderCapabilities('anthropic', ['realtime_audio']), ['realtime_audio']);
});

test('preset capability requirements fail closed when the local model cannot meet them', async () => {
  const originalFetch = globalThis.fetch;
  const originalCapabilities = process.env.JC_OLLAMA_CAPABILITIES;
  try {
    process.env.JC_OLLAMA_CAPABILITIES = 'chat,code';
    globalThis.fetch = async () => new Response(JSON.stringify({ models: [{ name: 'local-coder' }] }), { status: 200 });
    resetProviderCache();

    const resolution = await resolveProvider({
      allowCloud: false,
      privacyMode: 'local_first',
      requiredCapabilities: ['vision', 'code']
    });

    assert.equal(resolution.available, false);
    assert.deepEqual(resolution.unmetCapabilities, ['vision']);
    assert.match(resolution.reason, /local model is healthy/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCapabilities === undefined) delete process.env.JC_OLLAMA_CAPABILITIES;
    else process.env.JC_OLLAMA_CAPABILITIES = originalCapabilities;
    resetProviderCache();
  }
});

test('declared local capabilities satisfy a matching preset without cloud', async () => {
  const originalFetch = globalThis.fetch;
  const originalCapabilities = process.env.JC_OLLAMA_CAPABILITIES;
  try {
    process.env.JC_OLLAMA_CAPABILITIES = 'chat,code,vision,tools';
    globalThis.fetch = async () => new Response(JSON.stringify({ models: [{ name: 'local-vision-coder' }] }), { status: 200 });
    resetProviderCache();

    const resolution = await resolveProvider({
      allowCloud: false,
      privacyMode: 'local_only',
      requiredCapabilities: ['vision', 'tools']
    });

    assert.equal(resolution.available, true);
    assert.equal(resolution.provider, 'ollama');
    assert.ok(providerCapabilities('ollama').includes('vision'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCapabilities === undefined) delete process.env.JC_OLLAMA_CAPABILITIES;
    else process.env.JC_OLLAMA_CAPABILITIES = originalCapabilities;
    resetProviderCache();
  }
});
test('mock planner keeps repair scope distinct from greenfield scaffolding', async () => {
  const originalMock = process.env.JC_MOCK_MODEL;
  try {
    process.env.JC_MOCK_MODEL = '1';
    const repair = await generateWithProvider(
      { available: true, provider: 'ollama', model: 'jc-mock-model', reason: 'test' },
      {
        system: 'You are a careful build-repair planner. Respond with STRICT JSON for files that must be modified.',
        prompt: 'Key files: package.json. File inventory: package.json, src/lib.js. Objective: Fix add() in src/lib.js.',
        maxTokens: 1024,
        timeoutMs: 30_000,
        temperature: 0.2
      }
    );
    assert.deepEqual(JSON.parse(repair.text).files, ['src/lib.js']);

    const greenfield = await generateWithProvider(
      { available: true, provider: 'ollama', model: 'jc-mock-model', reason: 'test' },
      {
        system: 'You are a careful greenfield app planner. The target folder is empty or nearly empty. Respond with STRICT JSON.',
        prompt: 'Return the strict JSON plan for files to CREATE now.',
        maxTokens: 1024,
        timeoutMs: 30_000,
        temperature: 0.2
      }
    );
    assert.deepEqual(JSON.parse(greenfield.text).files, ['package.json', 'src/index.js', 'README.md']);
  } finally {
    if (originalMock === undefined) delete process.env.JC_MOCK_MODEL;
    else process.env.JC_MOCK_MODEL = originalMock;
    resetProviderCache();
  }
});

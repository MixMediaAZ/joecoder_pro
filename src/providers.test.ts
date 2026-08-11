import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configuredModelAdapters,
  DEFAULT_LOCAL_CODING_MODEL,
  generateWithProvider,
  missingProviderCapabilities,
  pickOllamaModel,
  providerCapabilities,
  providerStatus,
  resetProviderCache,
  resolveProvider
} from './providers.js';
import { resetPowerRouterCache } from './powerrouterClient.js';

test('pickOllamaModel prefers the small coding default over large general models', () => {
  const previous = process.env.JC_OLLAMA_MODEL;
  try {
    delete process.env.JC_OLLAMA_MODEL;
    assert.equal(
      pickOllamaModel([
        { name: 'qwen3.6:latest' },
        { name: 'qwen2.5-coder:7b' },
        { name: DEFAULT_LOCAL_CODING_MODEL },
        { name: 'llama3.1:8b' }
      ]),
      DEFAULT_LOCAL_CODING_MODEL
    );
    assert.equal(
      pickOllamaModel([{ name: 'qwen3.6:latest' }, { name: 'qwen2.5-coder:7b' }, { name: 'deepseek-coder-v2:16b' }]),
      'qwen2.5-coder:7b'
    );
    process.env.JC_OLLAMA_MODEL = 'qwen3.6:latest';
    assert.equal(
      pickOllamaModel([{ name: 'qwen3.6:latest' }, { name: DEFAULT_LOCAL_CODING_MODEL }]),
      'qwen3.6:latest'
    );
  } finally {
    if (previous === undefined) delete process.env.JC_OLLAMA_MODEL;
    else process.env.JC_OLLAMA_MODEL = previous;
  }
});

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

test('configuredModelAdapters prefers powerrouter when router is healthy', async () => {
  const priorUrl = process.env.JC_POWERROUTER_URL;
  const priorKey = process.env.JC_POWERROUTER_KEY;
  const priorMock = process.env.JC_MOCK_MODEL;
  const originalFetch = globalThis.fetch;
  try {
    delete process.env.JC_MOCK_MODEL;
    process.env.JC_POWERROUTER_URL = 'http://127.0.0.1:7474';
    process.env.JC_POWERROUTER_KEY = 'sk-pr-joecoder';
    resetProviderCache();
    resetPowerRouterCache();
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, name: 'powerrouter-pro' }), { status: 200 });
      }
      if (url.includes('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:14b' }] }), { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    };
    const adapters = await configuredModelAdapters();
    assert.equal(adapters[0]?.profile.provider, 'powerrouter');
    assert.equal(adapters[0]?.profile.location, 'local');
    assert.ok(adapters.some((adapter) => adapter.profile.provider === 'ollama'));
  } finally {
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) delete process.env.JC_POWERROUTER_URL; else process.env.JC_POWERROUTER_URL = priorUrl;
    if (priorKey === undefined) delete process.env.JC_POWERROUTER_KEY; else process.env.JC_POWERROUTER_KEY = priorKey;
    if (priorMock === undefined) delete process.env.JC_MOCK_MODEL; else process.env.JC_MOCK_MODEL = priorMock;
    resetProviderCache();
    resetPowerRouterCache();
  }
});

test('resolveProvider selects powerrouter before direct ollama when reachable', async () => {
  const priorUrl = process.env.JC_POWERROUTER_URL;
  const priorKey = process.env.JC_POWERROUTER_KEY;
  const priorMock = process.env.JC_MOCK_MODEL;
  const originalFetch = globalThis.fetch;
  try {
    delete process.env.JC_MOCK_MODEL;
    process.env.JC_POWERROUTER_URL = 'http://127.0.0.1:7474';
    process.env.JC_POWERROUTER_KEY = 'sk-pr-joecoder';
    resetProviderCache();
    resetPowerRouterCache();
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url.includes('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:14b' }] }), { status: 200 });
      return new Response('no', { status: 500 });
    };
    const resolution = await resolveProvider({ allowCloud: false, privacyMode: 'local_first', taskType: 'implementation' });
    assert.equal(resolution.available, true);
    assert.equal(resolution.provider, 'powerrouter');
    assert.equal(resolution.allowCloud, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) delete process.env.JC_POWERROUTER_URL; else process.env.JC_POWERROUTER_URL = priorUrl;
    if (priorKey === undefined) delete process.env.JC_POWERROUTER_KEY; else process.env.JC_POWERROUTER_KEY = priorKey;
    if (priorMock === undefined) delete process.env.JC_MOCK_MODEL; else process.env.JC_MOCK_MODEL = priorMock;
    resetProviderCache();
    resetPowerRouterCache();
  }
});

test('resolveProvider keeps PowerRouter allowCloud false under local_only', async () => {
  const priorUrl = process.env.JC_POWERROUTER_URL;
  const priorKey = process.env.JC_POWERROUTER_KEY;
  const priorMock = process.env.JC_MOCK_MODEL;
  const originalFetch = globalThis.fetch;
  try {
    delete process.env.JC_MOCK_MODEL;
    process.env.JC_POWERROUTER_URL = 'http://127.0.0.1:7474';
    process.env.JC_POWERROUTER_KEY = 'sk-pr-joecoder';
    resetProviderCache();
    resetPowerRouterCache();
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url.includes('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:14b' }] }), { status: 200 });
      return new Response('no', { status: 500 });
    };
    const resolution = await resolveProvider({
      allowCloud: true,
      privacyMode: 'local_only',
      maxCloudCostUsd: 5,
      taskType: 'implementation'
    });
    assert.equal(resolution.available, true);
    assert.equal(resolution.provider, 'powerrouter');
    assert.equal(resolution.allowCloud, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) delete process.env.JC_POWERROUTER_URL; else process.env.JC_POWERROUTER_URL = priorUrl;
    if (priorKey === undefined) delete process.env.JC_POWERROUTER_KEY; else process.env.JC_POWERROUTER_KEY = priorKey;
    if (priorMock === undefined) delete process.env.JC_MOCK_MODEL; else process.env.JC_MOCK_MODEL = priorMock;
    resetProviderCache();
    resetPowerRouterCache();
  }
});

test('configuredModelAdapters powerrouter generate keeps allow_cloud false under local_only', async () => {
  const priorUrl = process.env.JC_POWERROUTER_URL;
  const priorKey = process.env.JC_POWERROUTER_KEY;
  const priorMock = process.env.JC_MOCK_MODEL;
  const originalFetch = globalThis.fetch;
  let seenBody: any = null;
  try {
    delete process.env.JC_MOCK_MODEL;
    process.env.JC_POWERROUTER_URL = 'http://127.0.0.1:7474';
    process.env.JC_POWERROUTER_KEY = 'sk-pr-joecoder';
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/dispatch')) {
        seenBody = JSON.parse(String(init?.body || '{}'));
        return new Response(JSON.stringify({
          content: 'routed',
          model: 'qwen2.5-coder:14b',
          provider: 'ollama',
          tier: 'local',
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          fallback: false,
          request_id: 'r1'
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const adapters = await configuredModelAdapters();
    const powerRouter = adapters.find((adapter) => adapter.profile.provider === 'powerrouter');
    assert.ok(powerRouter);
    if (!powerRouter) throw new Error('expected powerrouter adapter');
    const result = await powerRouter.generate({
      taskType: 'implementation',
      requiredCapabilities: [],
      privacyMode: 'local_only',
      authorizedCloudBudgetUsd: 5,
      messages: [{ role: 'user', content: 'user' }],
      maxOutputTokens: 64,
      temperature: 0.2,
      timeoutMs: 5000
    } as any);
    assert.equal(seenBody.allow_cloud, false);
    assert.equal(result.text, 'routed');
  } finally {
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) delete process.env.JC_POWERROUTER_URL; else process.env.JC_POWERROUTER_URL = priorUrl;
    if (priorKey === undefined) delete process.env.JC_POWERROUTER_KEY; else process.env.JC_POWERROUTER_KEY = priorKey;
    if (priorMock === undefined) delete process.env.JC_MOCK_MODEL; else process.env.JC_MOCK_MODEL = priorMock;
    resetProviderCache();
    resetPowerRouterCache();
  }
});

test('generateWithProvider passes through explicit powerrouter allowCloud=false', async () => {
  const priorUrl = process.env.JC_POWERROUTER_URL;
  const priorKey = process.env.JC_POWERROUTER_KEY;
  const priorMock = process.env.JC_MOCK_MODEL;
  const originalFetch = globalThis.fetch;
  let seenBody: any = null;
  try {
    delete process.env.JC_MOCK_MODEL;
    process.env.JC_POWERROUTER_URL = 'http://127.0.0.1:7474';
    process.env.JC_POWERROUTER_KEY = 'sk-pr-joecoder';
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/dispatch')) {
        seenBody = JSON.parse(String(init?.body || '{}'));
        return new Response(JSON.stringify({
          content: 'routed',
          model: 'qwen2.5-coder:14b',
          provider: 'ollama',
          tier: 'local',
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          fallback: false,
          request_id: 'r1'
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const result = await generateWithProvider(
      { available: true, provider: 'powerrouter', model: 'auto', reason: 'test', allowCloud: false },
      { system: 'sys', prompt: 'user', maxTokens: 64, timeoutMs: 5000 }
    );
    assert.equal(result.provider, 'powerrouter');
    assert.equal(seenBody.allow_cloud, false);
    assert.equal(result.text, 'routed');
  } finally {
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) delete process.env.JC_POWERROUTER_URL; else process.env.JC_POWERROUTER_URL = priorUrl;
    if (priorKey === undefined) delete process.env.JC_POWERROUTER_KEY; else process.env.JC_POWERROUTER_KEY = priorKey;
    if (priorMock === undefined) delete process.env.JC_MOCK_MODEL; else process.env.JC_MOCK_MODEL = priorMock;
  }
});

test('configuredModelAdapters excludes powerrouter when health fails but keeps ollama', async () => {
  const priorUrl = process.env.JC_POWERROUTER_URL;
  const priorKey = process.env.JC_POWERROUTER_KEY;
  const priorMock = process.env.JC_MOCK_MODEL;
  const originalFetch = globalThis.fetch;
  try {
    delete process.env.JC_MOCK_MODEL;
    process.env.JC_POWERROUTER_URL = 'http://127.0.0.1:7474';
    process.env.JC_POWERROUTER_KEY = 'sk-pr-joecoder';
    resetProviderCache();
    resetPowerRouterCache();
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: false }), { status: 503 });
      if (url.includes('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:14b' }] }), { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    };
    const adapters = await configuredModelAdapters();
    assert.equal(adapters.some((adapter) => adapter.profile.provider === 'powerrouter'), false);
    assert.equal(adapters.some((adapter) => adapter.profile.provider === 'ollama'), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) delete process.env.JC_POWERROUTER_URL; else process.env.JC_POWERROUTER_URL = priorUrl;
    if (priorKey === undefined) delete process.env.JC_POWERROUTER_KEY; else process.env.JC_POWERROUTER_KEY = priorKey;
    if (priorMock === undefined) delete process.env.JC_MOCK_MODEL; else process.env.JC_MOCK_MODEL = priorMock;
    resetProviderCache();
    resetPowerRouterCache();
  }
});

test('resolveProvider prefers direct anthropic when authorized cloud is granted', async () => {
  const priorUrl = process.env.JC_POWERROUTER_URL;
  const priorKey = process.env.JC_POWERROUTER_KEY;
  const priorAnthropic = process.env.ANTHROPIC_API_KEY;
  const priorMock = process.env.JC_MOCK_MODEL;
  const originalFetch = globalThis.fetch;
  try {
    delete process.env.JC_MOCK_MODEL;
    process.env.JC_POWERROUTER_URL = 'http://127.0.0.1:7474';
    process.env.JC_POWERROUTER_KEY = 'sk-pr-joecoder';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    resetProviderCache();
    resetPowerRouterCache();
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url.includes('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:14b' }] }), { status: 200 });
      return new Response('unexpected', { status: 500 });
    };
    const resolution = await resolveProvider({
      allowCloud: true,
      privacyMode: 'authorized_cloud',
      maxCloudCostUsd: 5,
      taskType: 'implementation'
    });
    assert.equal(resolution.provider, 'anthropic');
  } finally {
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) delete process.env.JC_POWERROUTER_URL; else process.env.JC_POWERROUTER_URL = priorUrl;
    if (priorKey === undefined) delete process.env.JC_POWERROUTER_KEY; else process.env.JC_POWERROUTER_KEY = priorKey;
    if (priorAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = priorAnthropic;
    if (priorMock === undefined) delete process.env.JC_MOCK_MODEL; else process.env.JC_MOCK_MODEL = priorMock;
    resetProviderCache();
    resetPowerRouterCache();
  }
});

test('providerStatus reports powerrouter reachability without secrets', async () => {
  const priorUrl = process.env.JC_POWERROUTER_URL;
  const priorKey = process.env.JC_POWERROUTER_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.JC_POWERROUTER_URL = 'http://127.0.0.1:7474';
    process.env.JC_POWERROUTER_KEY = 'sk-pr-secret-should-not-appear';
    resetPowerRouterCache();
    globalThis.fetch = async (input) => {
      if (String(input).endsWith('/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (String(input).includes('/api/tags')) return new Response(JSON.stringify({ models: [] }), { status: 200 });
      return new Response('x', { status: 500 });
    };
    const status = await providerStatus();
    assert.equal(status.powerRouter?.configured, true);
    assert.equal(status.powerRouter?.reachable, true);
    assert.equal(JSON.stringify(status).includes('sk-pr-secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) delete process.env.JC_POWERROUTER_URL; else process.env.JC_POWERROUTER_URL = priorUrl;
    if (priorKey === undefined) delete process.env.JC_POWERROUTER_KEY; else process.env.JC_POWERROUTER_KEY = priorKey;
    resetPowerRouterCache();
  }
});

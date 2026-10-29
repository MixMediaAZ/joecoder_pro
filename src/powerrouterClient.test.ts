import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLoopbackPowerRouterUrl,
  powerRouterAvailable,
  powerRouterConfigured,
  powerRouterDispatch,
  resetPowerRouterCache,
  PowerRouterClientError
} from './powerrouterClient.js';

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prior = new Map<string, string | undefined>();
  for (const key of Object.keys(vars)) {
    prior.set(key, process.env[key]);
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetPowerRouterCache();
  });
}

test('powerRouterConfigured requires URL and key', async () => {
  await withEnv({ JC_POWERROUTER_URL: undefined, JC_POWERROUTER_KEY: undefined }, async () => {
    assert.equal(powerRouterConfigured(), false);
  });
  await withEnv({ JC_POWERROUTER_URL: 'http://127.0.0.1:7474', JC_POWERROUTER_KEY: 'sk-pr-joecoder' }, async () => {
    assert.equal(powerRouterConfigured(), true);
  });
});

test('powerRouterConfigured rejects non-loopback URL and powerRouterAvailable avoids fetch', async () => {
  await withEnv({ JC_POWERROUTER_URL: 'http://10.0.0.5:7474', JC_POWERROUTER_KEY: 'sk-pr-joecoder' }, async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called for non-loopback powerrouter URL');
    };
    try {
      assert.equal(isLoopbackPowerRouterUrl('http://10.0.0.5:7474'), false);
      assert.equal(powerRouterConfigured(), false);
      assert.equal(await powerRouterAvailable(true), false);
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('powerRouterAvailable returns false on network failure without throwing', async () => {
  await withEnv({ JC_POWERROUTER_URL: 'http://127.0.0.1:7474', JC_POWERROUTER_KEY: 'sk-pr-joecoder' }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
      resetPowerRouterCache();
      assert.equal(await powerRouterAvailable(true), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('powerRouterDispatch posts /api/dispatch with auth, project, and allow_cloud', async () => {
  await withEnv({
    JC_POWERROUTER_URL: 'http://127.0.0.1:7474',
    JC_POWERROUTER_KEY: 'sk-pr-joecoder',
    JC_POWERROUTER_PROJECT: 'joecoder-pro-20.1'
  }, async () => {
    const originalFetch = globalThis.fetch;
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = async (input, init) => {
      seenUrl = String(input);
      seenHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      seenBody = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({
        content: 'ok',
        model: 'qwen2.5-coder:14b',
        provider: 'ollama',
        tier: 'local',
        usage: { prompt_tokens: 10, completion_tokens: 4 },
        fallback: false,
        request_id: 'req-1'
      }), { status: 200 });
    };
    try {
      const result = await powerRouterDispatch({
        messages: [{ role: 'user', content: 'ping' }],
        allowCloud: false,
        sessionId: 'sess-1',
        stage: 'plan'
      });
      assert.equal(seenUrl, 'http://127.0.0.1:7474/api/dispatch');
      assert.match(seenHeaders.authorization || '', /Bearer sk-pr-joecoder/i);
      assert.equal(seenBody.allow_cloud, false);
      assert.equal(seenBody.project, 'joecoder-pro-20.1');
      assert.deepEqual((seenBody.routing as { sessionId: string; stage: string }), { sessionId: 'sess-1', stage: 'plan' });
      assert.equal(result.content, 'ok');
      assert.equal(result.model, 'qwen2.5-coder:14b');
      assert.equal(result.requestId, 'req-1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('powerRouterDispatch maps HTTP errors to PowerRouterClientError', async () => {
  await withEnv({ JC_POWERROUTER_URL: 'http://127.0.0.1:7474', JC_POWERROUTER_KEY: 'bad' }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid key' }), { status: 401 });
    try {
      await assert.rejects(
        () => powerRouterDispatch({ messages: [{ role: 'user', content: 'x' }], allowCloud: false }),
        (err: unknown) => err instanceof PowerRouterClientError && err.status === 401
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { cloudCost, cloudInputTokens, cloudKey, cloudProfile, generateCloud } from './cloudProviders.js';
import { configuredModelAdapters, generateRoutedModelTurn, generateWithProvider, providerStatus, resetProviderCache, resolveProvider } from './providers.js';
import { ModelRouter, ModelRoutingError, type ModelGenerateRequest, type ModelProviderAdapter } from './modelRouter.js';

const nativeFetch = globalThis.fetch;
const request: ModelGenerateRequest = {
  messages: [{ role: 'system', content: 'Return JSON.' }, { role: 'user', content: 'Say hello.' }],
  maxOutputTokens: 128, temperature: 0.2, timeoutMs: 3000
};
function environment(t: TestContext) {
  const names = Object.keys(process.env).filter(name => /^(JC_(DEEPSEEK_|REPLICATE_|CLOUD_PROVIDER|MOCK_MODEL)|DEEPSEEK_API_KEY|REPLICATE_API_|ANTHROPIC_API_KEY)/.test(name));
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  names.forEach(name => delete process.env[name]);
  process.env.DEEPSEEK_API_KEY = 'sk-test-secret';
  process.env.REPLICATE_API_TOKEN = 'r8_test-secret';
  resetProviderCache();
  t.after(() => {
    Object.keys(process.env).filter(name => /^(JC_(DEEPSEEK_|REPLICATE_|CLOUD_PROVIDER|MOCK_MODEL)|DEEPSEEK_API_KEY|REPLICATE_API_|ANTHROPIC_API_KEY)/.test(name)).forEach(name => delete process.env[name]);
    for (const [name, value] of Object.entries(saved)) if (value !== undefined) process.env[name] = value;
    resetProviderCache();
  });
}
const fixtures = new WeakMap<TestContext, Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void> | void>>();
let fixtureId = 0;

// Default tests exercise the complete HTTP protocol using Request/Response streams
// without OS sockets. JC_TEST_HTTP_NETWORK=1 runs these same cases over real TCP.
async function server(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void) {
  if (process.env.JC_TEST_HTTP_NETWORK !== '1') {
    let routes = fixtures.get(t);
    if (!routes) {
      routes = new Map();
      fixtures.set(t, routes);
      const original = globalThis.fetch;
      const routeMap = routes;
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        const entry = [...routeMap.entries()].find(([base]) => url.startsWith(base + '/'));
        if (!entry) return original(input, init);
        return new Promise<Response>((resolve, reject) => {
          const headers = new Headers();
          let controller: ReadableStreamDefaultController<Uint8Array>;
          let finished = false;
          const bytes = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { finished = true; } });
          const incoming = Readable.from(init?.body ? [String(init.body)] : []) as IncomingMessage;
          incoming.url = url.slice(entry[0].length);
          incoming.method = init?.method || 'GET';
          incoming.headers = Object.fromEntries(new Headers(init?.headers).entries());
          const abort = () => { if (!finished) { finished = true; const error = new DOMException('Aborted', 'AbortError'); controller.error(error); reject(error); } };
          const response = {
            statusCode: 200,
            setHeader(name: string, value: string) { headers.set(name, value); return response; },
            writeHead(status: number, values: Record<string, string>) { response.statusCode = status; Object.entries(values).forEach(([key, value]) => headers.set(key, value)); return response; },
            write(value: string) { if (!finished) { resolve(new Response(bytes, { status: response.statusCode, headers })); controller.enqueue(new TextEncoder().encode(value)); } return true; },
            end(value = '') { response.write(value); if (!finished) { finished = true; controller.close(); } init?.signal?.removeEventListener('abort', abort); return response; }
          };
          init?.signal?.addEventListener('abort', abort, { once: true });
          if (init?.signal?.aborted) { abort(); return; }
          Promise.resolve().then(() => entry[1](incoming, response as unknown as ServerResponse)).catch(reject);
        });
      };
      t.after(() => { globalThis.fetch = nativeFetch; });
    }
    const base = `http://127.0.0.1:0/fixture-${++fixtureId}`;
    routes.set(base, handler);
    return base;
  }

  const app = createServer((req, res) => { Promise.resolve(handler(req, res)).catch(error => { res.statusCode = 500; res.end(String(error)); }); });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(async () => { app.closeAllConnections(); await new Promise<void>(resolve => app.close(() => resolve())); });
  const address = app.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}
async function body(req: IncomingMessage) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw);
}
function stream(res: ServerResponse, text = '{"ok":true}', finish = 'stop', usage = { prompt_tokens: 23, completion_tokens: 9 }) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.write(': keepalive\n\n');
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'do not expose' } }] })}\n\n`);
  const content = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`;
  res.write(content.slice(0, 13));
  res.write(content.slice(13));
  res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage })}\n\ndata: [DONE]\n\n`);
}
function discoveryOffline(t: TestContext) {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/tags')) return Promise.resolve(new Response('{"models":[]}'));
    if (url.endsWith('/health')) return Promise.resolve(new Response('{}', { status: 503 }));
    return original(input, init);
  };
  t.after(() => { globalThis.fetch = nativeFetch; });
}

test('DeepSeek sends authenticated chat SSE with bounded output and preserves usage and Unicode', async t => {
  environment(t);
  let received: unknown;
  process.env.JC_DEEPSEEK_URL = await server(t, async (req, res) => {
    assert.equal(req.url, '/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer sk-test-secret');
    received = await body(req);
    stream(res, '{"ok":"音楽 🎵"}');
  });
  const result = await generateCloud('deepseek', request, 1);
  assert.equal(result.text, '{"ok":"音楽 🎵"}');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage?.inputTokens, 23);
  assert.equal(result.usage?.outputTokens, 9);
  assert.equal(result.usage?.costUsd, (23 * 0.3 + 9 * 1.2) / 1e6);
  assert.deepEqual(received, { model: 'deepseek-flash', messages: request.messages, max_tokens: 128, temperature: 0.2, thinking: { type: 'disabled' }, stream: true, stream_options: { include_usage: true } });
});

test('DeepSeek incomplete, empty and malformed streams fail explicitly; truncation is preserved', async t => {
  environment(t);
  let mode = 'incomplete';
  process.env.JC_DEEPSEEK_URL = await server(t, (_req, res) => {
    if (mode === 'incomplete') res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n');
    else if (mode === 'empty') stream(res, '');
    else if (mode === 'malformed') res.end('data: {oops}\n');
    else stream(res, '{"ok":', 'length');
  });
  for (const value of ['incomplete', 'empty', 'malformed']) { mode = value; await assert.rejects(generateCloud('deepseek', request, 1), /INVALID_OUTPUT/); }
  mode = 'length';
  assert.equal((await generateCloud('deepseek', request, 1)).finishReason, 'length');
});

test('Replicate polls only its own API, joins output, strips only leading reasoning, counts billed tokens', async t => {
  environment(t);
  const paths: string[] = [];
  process.env.JC_REPLICATE_URL = await server(t, async (req, res) => {
    paths.push(req.url || '');
    assert.equal(req.headers.authorization, 'Bearer r8_test-secret');
    if (req.method === 'POST') {
      const sent = await body(req);
      assert.equal(sent.input.max_tokens, 128);
      assert.match(sent.input.prompt, /SYSTEM:\nReturn JSON/);
      assert.equal(req.headers['cancel-after'], '5s');
      res.end(JSON.stringify({ id: 'test-prediction', status: 'processing', urls: { get: 'https://untrusted.example/steal' } }));
    } else res.end(JSON.stringify({ id: 'test-prediction', status: 'succeeded', output: ['<think>private reasoning', '</think>\n===FILE: a.ts===\nconst x = "<think>";\n===END FILE==='], metrics: { input_token_count: 50, output_token_count: 100 } }));
  });
  const result = await generateCloud('replicate', request, 1);
  assert.equal(result.text, '===FILE: a.ts===\nconst x = "<think>";\n===END FILE===');
  assert.equal(result.usage?.costUsd, (50 * 3.75 + 100 * 10) / 1e6);
  assert.deepEqual(paths, ['/v1/models/deepseek-ai/deepseek-r1/predictions', '/v1/predictions/test-prediction']);
});

test('Replicate timeout and user cancellation cancel the remote prediction', async t => {
  environment(t);
  let cancellations = 0;
  let onStarted: (() => void) | undefined;
  process.env.JC_REPLICATE_URL = await server(t, (_req, res) => {
    if (_req.url?.endsWith('/cancel')) { cancellations++; res.end('{"id":"job","status":"canceled"}'); }
    else { res.end('{"id":"job","status":"starting"}'); onStarted?.(); }
  });
  await assert.rejects(generateCloud('replicate', { ...request, timeoutMs: 150 }, 1), /TIMEOUT/);
  assert.equal(cancellations, 1);
  const controller = new AbortController();
  onStarted = () => setTimeout(() => controller.abort(), 25);
  await assert.rejects(generateCloud('replicate', { ...request, signal: controller.signal }, 1), /CANCELLED/);
  assert.equal(cancellations, 2);
});

test('DeepSeek timeout aborts an in-progress response body', async t => {
  environment(t);
  process.env.JC_DEEPSEEK_URL = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': pending\n\n'); });
  await assert.rejects(generateCloud('deepseek', { ...request, timeoutMs: 100 }, 1), /TIMEOUT/);
});

test('provider errors do not expose credentials or response bodies', async t => {
  environment(t);
  let status = 401;
  const url = await server(t, (_req, res) => { res.statusCode = status; res.end('sk-test-secret r8_test-secret private project text'); });
  process.env.JC_DEEPSEEK_URL = url;
  process.env.JC_REPLICATE_URL = url;
  for (const provider of ['deepseek', 'replicate'] as const) for (const code of [401, 403, 429, 500]) {
    status = code;
    await assert.rejects(generateCloud(provider, request, 1), (error: unknown) => error instanceof Error && error.message.includes(`HTTP_${code}`) && !/secret|private project/.test(error.message));
  }
});

test('Replicate validates terminal status and answer, and reserves output when metrics are absent', async t => {
  environment(t);
  let data: object = {};
  process.env.JC_REPLICATE_URL = await server(t, (_req, res) => { res.end(JSON.stringify(data)); });
  for (const invalid of [
    { id: 'job', status: 'failed' }, { id: 'job', status: 'canceled' },
    { id: 'job', status: 'succeeded', output: [] }, { id: 'job', status: 'succeeded', output: ['<think>unfinished'] },
    { id: 'job', status: 'succeeded', output: { url: 'wrong' } }
  ]) { data = invalid; await assert.rejects(generateCloud('replicate', request, 1)); }
  data = { id: 'job', status: 'succeeded', output: ['answer'] };
  const result = await generateCloud('replicate', request, 1);
  assert.equal(result.usage?.outputTokens, request.maxOutputTokens);
  assert.equal(result.usage?.costUsd, cloudCost(cloudProfile('replicate'), cloudInputTokens(request), 128));
});

test('missing keys, invalid settings, excessive context, and bad budgets make no API calls', async t => {
  environment(t);
  let calls = 0;
  const url = await server(t, (_req, res) => { calls++; stream(res); });
  process.env.JC_DEEPSEEK_URL = url;
  process.env.JC_REPLICATE_URL = url;
  for (const budget of [0, -1, NaN, Infinity, 0.000001]) await assert.rejects(generateCloud('deepseek', request, budget), /BUDGET/);
  process.env.JC_DEEPSEEK_INPUT_COST_PER_MILLION = 'NaN';
  await assert.rejects(generateCloud('deepseek', request, 1), /INVALID_PROVIDER_CONFIG/);
  delete process.env.JC_DEEPSEEK_INPUT_COST_PER_MILLION;
  process.env.JC_DEEPSEEK_MODEL = 'unknown-model';
  await assert.rejects(generateCloud('deepseek', request, 1), /INVALID_PROVIDER_CONFIG/);
  delete process.env.JC_DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
  await assert.rejects(generateCloud('deepseek', request, 1), /AUTHENTICATION/);
  await assert.rejects(generateCloud('replicate', { ...request, messages: [{ role: 'user', content: 'a'.repeat(66000) }] }, 10), /CONTEXT/);
  assert.equal(calls, 0);
  delete process.env.REPLICATE_API_TOKEN;
  process.env.REPLICATE_API_KEY = 'r8_legacy-key';
  assert.equal(cloudKey('replicate'), 'r8_legacy-key');
});

test('both providers are discoverable and selectable in routed chat and direct planning while local-only stays private', async t => {
  environment(t); discoveryOffline(t);
  process.env.JC_DEEPSEEK_URL = await server(t, (_req, res) => stream(res));
  process.env.JC_REPLICATE_URL = await server(t, (_req, res) => { res.end(JSON.stringify({ id: 'job', status: 'succeeded', output: ['{"ok":true}'], metrics: { input_token_count: 20, output_token_count: 5 } })); });
  const adapters = await configuredModelAdapters();
  assert.deepEqual(adapters.map(adapter => adapter.profile.provider), ['deepseek', 'replicate']);
  const status = await providerStatus();
  assert.equal(status.cloudConfigured, true);
  assert.ok(status.cloudProviders.filter(provider => provider.configured).every(provider => provider.status.includes('not verified')));
  assert.doesNotMatch(JSON.stringify(status), /sk-test-secret|r8_test-secret/);
  for (const provider of ['deepseek', 'replicate'] as const) {
    process.env.JC_CLOUD_PROVIDER = provider;
    resetProviderCache();
    assert.equal((await resolveProvider({ allowCloud: true, privacyMode: 'local_only', maxCloudCostUsd: 1 })).available, false);
    const resolution = await resolveProvider({ allowCloud: true, privacyMode: 'authorized_cloud', maxCloudCostUsd: 1, requiredCapabilities: ['code', 'tools'] });
    assert.equal(resolution.provider, provider);
    const direct = await generateWithProvider(resolution, { system: 'Return JSON', prompt: 'Say hello', maxTokens: 128 });
    assert.deepEqual(JSON.parse(direct.text), { ok: true });
    const routed = await generateRoutedModelTurn({ ...request, taskType: 'implementation', requiredCapabilities: ['code', 'tools'], privacyMode: 'authorized_cloud', authorizedCloudBudgetUsd: 1 });
    assert.equal(routed.provider, provider);
    assert.ok(routed.usage.costUsd > 0);
  }
});

test('legacy planning retries retain the same remaining cloud budget', async t => {
  environment(t); discoveryOffline(t);
  let calls = 0;
  process.env.JC_DEEPSEEK_URL = await server(t, (_req, res) => { calls++; res.statusCode = 500; res.end('failed'); });
  process.env.JC_CLOUD_PROVIDER = 'deepseek';
  const resolution = await resolveProvider({ allowCloud: true, maxCloudCostUsd: 0.006 });
  assert.equal(resolution.provider, 'deepseek');
  await assert.rejects(generateWithProvider(resolution, { system: 'Return JSON', prompt: 'Hello', maxTokens: 4096 }), /HTTP_500/);
  await assert.rejects(generateWithProvider(resolution, { system: 'Return JSON', prompt: 'Hello', maxTokens: 4096 }), /BUDGET/);
  assert.equal(calls, 1);
});

test('routed fallback accounts for rejected paid output and does not reuse an exhausted budget', async () => {
  let fallbackCalls = 0;
  const profile = cloudProfile('deepseek');
  const first: ModelProviderAdapter = { profile: { ...profile, id: 'first', enabled: true, qualityTier: 9, inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 1 },
    generate: async () => ({ text: 'invalid', usage: { inputTokens: 100, outputTokens: 100, costUsd: 0.0002 } }) };
  const second: ModelProviderAdapter = { profile: { ...first.profile, id: 'second', qualityTier: 1 }, generate: async () => { fallbackCalls++; return { text: '{"ok":true}' }; } };
  const router = new ModelRouter([first, second]);
  await assert.rejects(router.execute({ ...request, maxOutputTokens: 100, taskType: 'implementation', requiredCapabilities: [], privacyMode: 'authorized_cloud', authorizedCloudBudgetUsd: 0.0003, validate: text => { JSON.parse(text); } }), (error: unknown) => error instanceof ModelRoutingError && error.attempts.length === 1 && error.attempts[0]?.usage?.costUsd === 0.0002);
  assert.equal(fallbackCalls, 0);
});

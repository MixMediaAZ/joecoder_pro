# PowerRouter ↔ JoeCoder Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PowerRouter-primary provider path in JoeCoder that calls `POST /api/dispatch` when the router is healthy, with direct Ollama/Anthropic fallback when it is not.

**Architecture:** Thin `powerrouterClient.ts` talks to loopback PowerRouter. `providers.ts` prefers a `powerrouter` adapter (location `local` for policy ranking; cloud still gated by Work Order `allow_cloud`). Legacy `resolveProvider` / `generateWithProvider` and `generateRoutedModelTurn` both use the same client. PowerRouter keeps Operating Standard injection; JoeCoder does not inject STANDARD on that path.

**Tech Stack:** Node.js 22+, TypeScript, built-in `fetch`, existing `node:test` suite, PowerRouter Pro on `127.0.0.1:7474`

**Spec:** `docs/superpowers/specs/2026-08-10-powerrouter-connectivity-design.md`

## Global Constraints

- Node.js >= 22.0.0; no new npm dependencies
- Loopback PowerRouter URL default: `http://127.0.0.1:7474`
- Use `/api/dispatch` (not only `/v1/chat/completions`) for JoeCoder gateway calls
- Never double-inject FORGE Operating Standard on the PowerRouter path
- `allow_cloud` only when privacy is not `local_only` and authorized cloud budget > 0
- Secrets never logged, persisted in evidence, or returned from `providerStatus`
- Unset `JC_POWERROUTER_URL` / `JC_POWERROUTER_KEY` → existing direct Ollama/Anthropic behavior unchanged
- `JC_MOCK_MODEL=1` path unchanged (no PowerRouter required)
- Windows-first verification; do not hardcode JoeCoder ports
- Commit only when the operator explicitly asks (plan commit steps are optional gates)

## File map

| File | Responsibility |
|---|---|
| `src/powerrouterClient.ts` | Health check + dispatch client |
| `src/powerrouterClient.test.ts` | Client unit tests (mocked fetch) |
| `src/providers.ts` | Prefer powerrouter adapter; resolve/generate/status wiring |
| `src/providers.test.ts` | Adapter preference, allow_cloud gating, fallback |
| `src/database/database.ts` | Seed `provider-powerrouter` profile row |
| `docs/superpowers/specs/2026-08-10-powerrouter-connectivity-design.md` | Already written — reference only |
| PowerRouter `config/keys.json` (via keys script) | Mint `joecoder` key (operator machine) |
| PowerRouter `INTEGRATING.md` | Add JoeCoder wiring row (optional doc sync) |

---

### Task 1: PowerRouter client

**Files:**
- Create: `src/powerrouterClient.ts`
- Create: `src/powerrouterClient.test.ts`

**Interfaces:**
- Consumes: `process.env.JC_POWERROUTER_URL`, `JC_POWERROUTER_KEY`, `JC_POWERROUTER_PROJECT`; global `fetch`
- Produces:
  - `export interface PowerRouterDispatchRequest { messages: Array<{ role: string; content: string }>; allowCloud: boolean; sessionId?: string; stage?: string; model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number; signal?: AbortSignal }`
  - `export interface PowerRouterDispatchResult { content: string; model: string; provider: string; tier: string | null; fallback: boolean; usage: { prompt_tokens: number; completion_tokens: number }; requestId: string | null }`
  - `export function powerRouterConfigured(): boolean`
  - `export function powerRouterBaseUrl(): string`
  - `export async function powerRouterAvailable(force?: boolean): Promise<boolean>`
  - `export async function powerRouterDispatch(request: PowerRouterDispatchRequest): Promise<PowerRouterDispatchResult>`
  - `export function resetPowerRouterCache(): void`
  - `export class PowerRouterClientError extends Error { status?: number; tried?: unknown }`

- [ ] **Step 1: Write the failing tests**

Create `src/powerrouterClient.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bat
cd /d "D:\AI Builds-OM\0_PROJECTS\CODING_Builds\JoeCoder_Builds\JoeCoder_Pro_20.1"
npm run build
node --test dist/powerrouterClient.test.js
```

Expected: FAIL — module or exports missing

- [ ] **Step 3: Implement `src/powerrouterClient.ts`**

```ts
const DEFAULT_URL = 'http://127.0.0.1:7474';
const HEALTH_TIMEOUT_MS = 1500;
const HEALTH_CACHE_MS = 5000;
const DEFAULT_DISPATCH_TIMEOUT_MS = 300_000;

export class PowerRouterClientError extends Error {
  status?: number;
  tried?: unknown;
  constructor(message: string, opts: { status?: number; tried?: unknown } = {}) {
    super(message);
    this.name = 'PowerRouterClientError';
    this.status = opts.status;
    this.tried = opts.tried;
  }
}

export interface PowerRouterDispatchRequest {
  messages: Array<{ role: string; content: string }>;
  allowCloud: boolean;
  sessionId?: string;
  stage?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface PowerRouterDispatchResult {
  content: string;
  model: string;
  provider: string;
  tier: string | null;
  fallback: boolean;
  usage: { prompt_tokens: number; completion_tokens: number };
  requestId: string | null;
}

let healthCache: { checkedAt: number; ok: boolean } | null = null;

function env(name: string, fallback = ''): string {
  return (process.env[name] || '').trim() || fallback;
}

export function powerRouterBaseUrl(): string {
  return env('JC_POWERROUTER_URL', DEFAULT_URL).replace(/\/+$/, '').replace(/\/v1$/, '');
}

export function powerRouterConfigured(): boolean {
  return Boolean(env('JC_POWERROUTER_URL') && env('JC_POWERROUTER_KEY'));
}

export function resetPowerRouterCache(): void {
  healthCache = null;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; data: any }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new PowerRouterClientError(`powerrouter timed out after ${timeoutMs}ms`)), timeoutMs);
  if (init.signal) {
    init.signal.addEventListener('abort', () => ac.abort(init.signal?.reason), { once: true });
  }
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const raw = await res.text();
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {
      throw new PowerRouterClientError(`unreadable powerrouter response (HTTP ${res.status}): ${raw.slice(0, 200)}`, { status: res.status });
    }
    return { status: res.status, data };
  } catch (error: unknown) {
    if (error instanceof PowerRouterClientError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PowerRouterClientError(`powerrouter unreachable at ${url}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function powerRouterAvailable(force = false): Promise<boolean> {
  if (!powerRouterConfigured()) return false;
  if (!force && healthCache && Date.now() - healthCache.checkedAt < HEALTH_CACHE_MS) {
    return healthCache.ok;
  }
  let ok = false;
  try {
    const { status, data } = await fetchJson(`${powerRouterBaseUrl()}/health`, { method: 'GET' }, HEALTH_TIMEOUT_MS);
    ok = status === 200 && data?.ok === true;
  } catch {
    ok = false;
  }
  healthCache = { checkedAt: Date.now(), ok };
  return ok;
}

export async function powerRouterDispatch(request: PowerRouterDispatchRequest): Promise<PowerRouterDispatchResult> {
  if (!powerRouterConfigured()) {
    throw new PowerRouterClientError('powerrouter is not configured (set JC_POWERROUTER_URL and JC_POWERROUTER_KEY)');
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${env('JC_POWERROUTER_KEY')}`
  };
  const project = env('JC_POWERROUTER_PROJECT');
  if (project) headers['x-powerrouter-project'] = project;

  const body: Record<string, unknown> = {
    messages: request.messages,
    allow_cloud: request.allowCloud === true,
    project: project || undefined,
    routing: {
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...(request.stage ? { stage: request.stage } : {})
    }
  };
  if (request.model) body.model = request.model;
  if (request.temperature != null) body.temperature = request.temperature;
  if (request.maxTokens != null) body.max_tokens = request.maxTokens;

  const { status, data } = await fetchJson(
    `${powerRouterBaseUrl()}/api/dispatch`,
    { method: 'POST', headers, body: JSON.stringify(body), signal: request.signal },
    request.timeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS
  );

  if (status >= 400) {
    throw new PowerRouterClientError(
      String(data?.error?.message || data?.error || `HTTP ${status}`),
      { status, tried: data?.tried }
    );
  }

  const content = typeof data?.content === 'string' ? data.content : '';
  if (!content.trim()) {
    throw new PowerRouterClientError('POWERROUTER_EMPTY_RESPONSE', { status });
  }

  return {
    content,
    model: String(data.model || 'powerrouter'),
    provider: String(data.provider || 'powerrouter'),
    tier: data.tier == null ? null : String(data.tier),
    fallback: Boolean(data.fallback),
    usage: {
      prompt_tokens: Number(data.usage?.prompt_tokens || 0),
      completion_tokens: Number(data.usage?.completion_tokens || 0)
    },
    requestId: data.request_id == null ? null : String(data.request_id)
  };
}
```

- [ ] **Step 4: Run client tests**

```bat
npm run build
node --test dist/powerrouterClient.test.js
```

Expected: PASS

- [ ] **Step 5: Commit (only if operator asks)**

```bat
git add src/powerrouterClient.ts src/powerrouterClient.test.ts
git commit -m "feat: add PowerRouter dispatch client for JoeCoder"
```

---

### Task 2: Prefer PowerRouter in providers

**Files:**
- Modify: `src/providers.ts`
- Modify: `src/providers.test.ts`
- Modify: `src/powerrouterClient.ts` only if a small export tweak is required

**Interfaces:**
- Consumes: Task 1 client APIs
- Produces:
  - `ProviderName` includes `'powerrouter'`
  - `ProviderResolution.allowCloud?: boolean` (set when resolving)
  - `configuredModelAdapters()` inserts powerrouter adapter first when `powerRouterAvailable()`
  - `resolveProvider()` prefers powerrouter when healthy and configured
  - `generateWithProvider()` dispatches via client for `provider === 'powerrouter'`
  - `providerStatus()` adds `powerRouter: { configured: boolean; reachable: boolean }` (no secrets)
  - `resetProviderCache()` also calls `resetPowerRouterCache()`

- [ ] **Step 1: Write failing provider tests**

Append to `src/providers.test.ts`:

```ts
import {
  configuredModelAdapters,
  providerStatus,
  // ...keep existing imports and add:
} from './providers.js';
import { resetPowerRouterCache } from './powerrouterClient.js';

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
    assert.ok(adapters.some((a) => a.profile.provider === 'ollama'));
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

test('generateWithProvider never sets allow_cloud under local_only', async () => {
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
```

Also export `configuredModelAdapters` from `providers.ts` if not already exported (it is currently exported).

- [ ] **Step 2: Run new provider tests — expect FAIL**

```bat
npm run build
node --test dist/providers.test.js
```

Expected: FAIL on powerrouter assertions / missing fields

- [ ] **Step 3: Implement provider wiring in `src/providers.ts`**

Minimal behavioral changes (apply surgically):

1. Import client helpers.
2. Extend types:

```ts
export type ProviderName = 'ollama' | 'anthropic' | 'powerrouter';

export interface ProviderResolution {
  // ...existing fields...
  allowCloud?: boolean;
}

export async function providerStatus(): Promise<{
  localModel: string | null;
  localCapabilities: string[];
  cloudConfigured: boolean;
  policy: string;
  mockModel?: boolean;
  powerRouter?: { configured: boolean; reachable: boolean };
}>
```

3. In `providerCapabilities`, treat `powerrouter` like ollama capabilities (reuse ollama capability list).

4. In `resolveProvider`, after mock check and before/alongside local selection:

```ts
const routerUp = await powerRouterAvailable();
if (routerUp) {
  const reason = `PowerRouter-primary route selected; task=${taskType};${presetNote} direct Ollama kept as fallback.`;
  return {
    available: true,
    provider: 'powerrouter',
    model: 'auto',
    reason,
    routingReason: reason,
    taskType,
    eligibleProviders: ['powerrouter', ...(localEligible ? ['ollama' as const] : []), ...(cloudEligible ? ['anthropic' as const] : [])],
    capabilities: providerCapabilities('powerrouter'),
    allowCloud: Boolean(options.allowCloud && options.privacyMode !== 'local_only' && (options.maxCloudCostUsd ?? 0) > 0)
  };
}
```

Keep existing local/cloud logic when router is down. When frontier grant prefers Anthropic today, **do not** bypass PowerRouter for cloud — if router is up, still select powerrouter and set `allowCloud: true` so PowerRouter owns frontier escalation. Only use direct Anthropic when router is down.

Clarified order when router up:
1. powerrouter (allowCloud from budget/privacy)
2. else existing local/cloud logic (unreachable when router up returns early)

5. In `configuredModelAdapters`, after mock branch:

```ts
if (await powerRouterAvailable()) {
  adapters.push({
    profile: {
      id: 'powerrouter:auto',
      provider: 'powerrouter',
      model: 'auto',
      location: 'local',
      enabled: true,
      capabilities: providerCapabilities('powerrouter'),
      contextWindowTokens: Math.max(4096, Number(process.env.JC_OLLAMA_CONTEXT_WINDOW || 32768)),
      taskTypes: ['conversation', 'investigation', 'implementation', 'review', 'structured_control', 'visual_analysis'],
      qualityTier: 5,
      inputCostPerMillionTokens: 0,
      outputCostPerMillionTokens: 0
    },
    generate: async (request) => {
      const routed = request as RoutedModelTurnRequest;
      const allowCloud = (routed.authorizedCloudBudgetUsd ?? 0) > 0 && routed.privacyMode !== 'local_only';
      const system = routed.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const rest = routed.messages.filter((m) => m.role !== 'system');
      const messages = [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...rest.map((m) => ({ role: m.role, content: m.content }))
      ];
      // Do NOT inject FORGE STANDARD here — PowerRouter injects on /api/dispatch.
      const out = await powerRouterDispatch({
        messages,
        allowCloud,
        temperature: routed.temperature,
        maxTokens: routed.maxOutputTokens,
        timeoutMs: routed.timeoutMs,
        signal: routed.signal
      });
      return {
        text: out.content,
        usage: {
          inputTokens: out.usage.prompt_tokens,
          outputTokens: out.usage.completion_tokens,
          costUsd: out.fallback ? undefined : 0
        }
      };
    }
  });
}
```

Still push ollama/anthropic adapters afterward for ModelRouter failover.

6. In `generateWithProvider`:

```ts
if (resolution.provider === 'powerrouter') {
  const messages = [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    { role: 'user', content: request.prompt }
  ];
  const out = await powerRouterDispatch({
    messages,
    allowCloud: resolution.allowCloud === true,
    maxTokens: request.maxTokens,
    temperature: request.temperature,
    timeoutMs: request.timeoutMs
  });
  return {
    text: out.content,
    provider: 'powerrouter',
    model: out.model,
    durationMs: Date.now() - startedAt
  };
}
```

(`startedAt` = `Date.now()` at function entry.)

7. Update `providerStatus` and `resetProviderCache` as specified.

- [ ] **Step 4: Run provider + client tests**

```bat
npm run build
node --test dist/powerrouterClient.test.js dist/providers.test.js
```

Expected: PASS

- [ ] **Step 5: Run broader unit suite**

```bat
npm run test:unit
```

Expected: PASS (or only pre-existing unrelated failures — do not weaken tests)

- [ ] **Step 6: Commit (only if operator asks)**

```bat
git add src/providers.ts src/providers.test.ts src/powerrouterClient.ts src/powerrouterClient.test.ts
git commit -m "feat: route JoeCoder model turns through PowerRouter when healthy"
```

---

### Task 3: Provider profile seed + health consumers

**Files:**
- Modify: `src/database/database.ts` (provider seed list near `provider-ollama`)
- Modify: any health JSON builder in `src/index.ts` that spreads `providerStatus()` — only if it currently enumerates fields explicitly and would drop `powerRouter`

**Interfaces:**
- Consumes: `JC_POWERROUTER_URL`, `JC_POWERROUTER_KEY` (configured boolean only)
- Produces: DB row `provider-powerrouter` with `secret_env_var` = `JC_POWERROUTER_KEY`, kind `local`, endpoint from URL env

- [ ] **Step 1: Extend provider seed**

In `src/database/database.ts` providers array, add:

```ts
['provider-powerrouter', 'powerrouter', 'PowerRouter (local gateway)', 'local',
  process.env.JC_POWERROUTER_URL || 'http://127.0.0.1:7474', 'auto', 'JC_POWERROUTER_KEY']
```

Configured rule already treats non-local as needing secret; this row is `kind: 'local'` but still has a secret env — update the configured check for this row to:

```ts
const configured = provider[1] === 'powerrouter'
  ? Boolean(process.env.JC_POWERROUTER_URL && process.env.JC_POWERROUTER_KEY)
  : provider[3] === 'local' || Boolean(provider[6] && process.env[provider[6]]);
```

(Adjust indexes to match the tuple: id, provider, display, kind, endpoint, model, secretEnv.)

- [ ] **Step 2: Ensure `/health` or status API surfaces `powerRouter`**

Search `providerStatus(` in `src/index.ts`. If response is `res.json(await providerStatus())`, no change. If fields are picked manually, add `powerRouter`.

- [ ] **Step 3: Build and run database + provider tests**

```bat
npm run build
node --test dist/providers.test.js dist/database/database.test.js
```

Expected: PASS

- [ ] **Step 4: Commit (only if operator asks)**

```bat
git add src/database/database.ts src/index.ts
git commit -m "feat: register PowerRouter provider profile in JoeCoder DB seed"
```

---

### Task 4: Operator wiring on PowerRouter + JoeCoder env

**Files:**
- PowerRouter: mint key via script (writes `config/keys.json`, gitignored)
- JoeCoder: document env in existing README or start.bat echo (minimal)
- Modify (optional): `D:\AI Builds-OM\0_PROJECTS\PowerRouter_Pro\INTEGRATING.md` JoeCoder row

**Interfaces:**
- Consumes: PowerRouter running on 7474
- Produces: `joecoder` API key; JoeCoder env vars set for live use

- [ ] **Step 1: Start PowerRouter**

```bat
cd /d "D:\AI Builds-OM\0_PROJECTS\PowerRouter_Pro"
start.bat
```

Open `http://127.0.0.1:7474` — dashboard loads.

- [ ] **Step 2: Mint JoeCoder key**

```bat
cd /d "D:\AI Builds-OM\0_PROJECTS\PowerRouter_Pro"
node scripts/keys.js add joecoder
```

Copy the printed key (form `sk-pr-...`).

- [ ] **Step 3: Set JoeCoder env (session or `.env` if project uses one)**

```bat
set JC_POWERROUTER_URL=http://127.0.0.1:7474
set JC_POWERROUTER_KEY=sk-pr-PASTE_KEY_HERE
set JC_POWERROUTER_PROJECT=joecoder-pro-20.1
```

Optional: add the same three lines to JoeCoder `start.bat` as commented examples near the Ollama model echo — do not hardcode the secret.

- [ ] **Step 4: Update PowerRouter INTEGRATING.md table**

Add/replace JoeCoder row:

| **JoeCoder Pro 20.1** | Set `JC_POWERROUTER_URL=http://127.0.0.1:7474`, mint key `joecoder`, set `JC_POWERROUTER_KEY`. JoeCoder calls `/api/dispatch` via its provider adapter and keeps direct Ollama fallback. Do not also inject Operating Standard in JoeCoder. |

- [ ] **Step 5: Manual live check**

1. Start JoeCoder with the env vars set  
2. Hit JoeCoder health — `powerRouter.reachable: true`  
3. Run one local authorized chat/plan turn  
4. In PowerRouter dashboard Recent calls / `GET /api/calls`, confirm `project_id` includes `joecoder-pro-20.1`  
5. Stop PowerRouter; confirm JoeCoder health shows reachable false and a local Ollama turn still works  

- [ ] **Step 6: Commit docs only if operator asks**

```bat
git add README.md start.bat
git commit -m "docs: document PowerRouter env wiring for JoeCoder"
```

(And separately in the PowerRouter repo if INTEGRATING.md changed.)

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| `/api/dispatch` client | Task 1 |
| Prefer PowerRouter when healthy | Task 2 |
| Direct Ollama/Anthropic fallback | Task 2 (`configuredModelAdapters` still adds them; resolve early-return only when up) |
| `allow_cloud` from Work Order budget/privacy | Task 2 |
| No double STANDARD injection | Task 2 comment + messages pass-through only |
| Status without secrets | Task 2 |
| DB/provider visibility | Task 3 |
| Mint key + manual verification | Task 4 |
| Unset env = unchanged behavior | Task 1–2 (`powerRouterConfigured()`) |
| Mock model unchanged | Task 2 (mock branch still first) |

## Self-review notes

- No TBD/placeholder steps remain
- Types aligned: `PowerRouterDispatchRequest/Result`, `ProviderName` includes `powerrouter`, `allowCloud` on `ProviderResolution`
- Stage 4 second-cloud evidence remains out of scope (spec non-goal)

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-powerrouter-connectivity.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?

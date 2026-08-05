/**
 * Model provider layer — local-first, fail-closed.
 *
 * Ollama (loopback) is the preferred provider and is auto-detected at runtime.
 * Anthropic (cloud) is a fallback that activates only when ANTHROPIC_API_KEY is
 * set AND the caller explicitly allows cloud (a Work Order must carry a
 * non-zero maxCloudCostUsd budget). Dependency-free by design: this package
 * installs with --ignore-scripts --prefer-offline, so both clients use the
 * Node 22 global fetch instead of SDKs.
 */

export type ProviderName = 'ollama' | 'anthropic';

export interface ModelRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Sampling temperature. Structured-output calls (plan/edit) pin this low so
   *  strict-format responses stay parseable; omit for the provider default. */
  temperature?: number;
}

export interface ModelResponse {
  text: string;
  provider: ProviderName;
  model: string;
  durationMs: number;
}

export interface ProviderResolution {
  available: boolean;
  provider: ProviderName | null;
  model: string | null;
  reason: string;
  capabilities?: string[];
  unmetCapabilities?: string[];
}

export interface ProviderRoutingOptions {
  allowCloud: boolean;
  privacyMode?: 'local_only' | 'local_first' | 'authorized_cloud';
  requiredCapabilities?: string[];
}

const OLLAMA_BASE_URL = process.env.JC_OLLAMA_URL || 'http://127.0.0.1:11434';
const ANTHROPIC_BASE_URL = process.env.JC_ANTHROPIC_URL || 'https://api.anthropic.com';
const ANTHROPIC_DEFAULT_MODEL = process.env.JC_ANTHROPIC_MODEL || 'claude-opus-5';
const OLLAMA_DETECT_TIMEOUT_MS = 2000;
const OLLAMA_DETECT_CACHE_MS = 30000;
const DEFAULT_GENERATE_TIMEOUT_MS = 120000;

let ollamaCache: { checkedAt: number; model: string | null } | null = null;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`MODEL_REQUEST_TIMEOUT after ${Math.round(timeoutMs / 1000)}s (${url})`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function pickOllamaModel(models: Array<{ name?: string }>): string | null {
  const names = models.map((m) => m.name).filter((n): n is string => typeof n === 'string');
  if (!names.length) return null;
  const requested = process.env.JC_OLLAMA_MODEL;
  if (requested && names.includes(requested)) return requested;
  return names.find((n) => n.includes('coder')) || names[0] || null;
}

/** Detect a running local Ollama and choose a model. Cached for 30s. */
export async function detectOllama(force = false): Promise<string | null> {
  if (!force && ollamaCache && Date.now() - ollamaCache.checkedAt < OLLAMA_DETECT_CACHE_MS) {
    return ollamaCache.model;
  }
  let model: string | null = null;
  try {
    const res = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/tags`, { method: 'GET' }, OLLAMA_DETECT_TIMEOUT_MS);
    if (res.ok) {
      const data = await res.json() as { models?: Array<{ name?: string }> };
      model = pickOllamaModel(data.models || []);
    }
  } catch {
    model = null;
  }
  ollamaCache = { checkedAt: Date.now(), model };
  return model;
}

export function anthropicKeyPresent(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Resolve which provider may serve a request. Local-first: Ollama wins when
 * reachable. Cloud requires both a key and explicit allowCloud (derived from
 * an authorized budget). Fail-closed with a plain-language reason.
 */
export function providerCapabilities(provider: ProviderName): string[] {
  if (provider === 'anthropic') return ['chat', 'code', 'long_context', 'vision', 'tools'];
  const configured = (process.env.JC_OLLAMA_CAPABILITIES || 'chat,code,long_context,tools')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(configured));
}

export function missingProviderCapabilities(provider: ProviderName, required: string[] = []): string[] {
  const available = new Set(providerCapabilities(provider));
  return Array.from(new Set(required.map(value => value.trim().toLowerCase()).filter(Boolean)))
    .filter(capability => !available.has(capability));
}

export async function resolveProvider(options: ProviderRoutingOptions): Promise<ProviderResolution> {
  const required = Array.from(new Set(options.requiredCapabilities || []));
  // Offline / e2e seam: deterministic mock satisfies local-first routing without Ollama.
  if (process.env.JC_MOCK_MODEL === '1') {
    return {
      available: true,
      provider: 'ollama',
      model: 'jc-mock-model',
      reason: 'JC_MOCK_MODEL=1 — deterministic mock provider for offline certification and e2e.',
      capabilities: providerCapabilities('ollama')
    };
  }
  const localModel = await detectOllama();
  const localCapabilities = providerCapabilities('ollama');
  const localMissing = missingProviderCapabilities('ollama', required);
  if (localModel && localMissing.length === 0) {
    return {
      available: true,
      provider: 'ollama',
      model: localModel,
      reason: 'Local Ollama service satisfies the selected privacy and capability policy.',
      capabilities: localCapabilities
    };
  }

  const cloudAllowed = options.allowCloud && options.privacyMode !== 'local_only';
  const cloudCapabilities = providerCapabilities('anthropic');
  const cloudMissing = missingProviderCapabilities('anthropic', required);
  if (anthropicKeyPresent() && cloudAllowed && cloudMissing.length === 0) {
    return {
      available: true,
      provider: 'anthropic',
      model: ANTHROPIC_DEFAULT_MODEL,
      reason: localModel
        ? `The local model lacks: ${localMissing.join(', ')}. The authorized cloud provider satisfies the preset.`
        : 'No local model is available; the cloud fallback is explicitly allowed and satisfies the preset.',
      capabilities: cloudCapabilities
    };
  }

  if (localModel && localMissing.length > 0) {
    return {
      available: false,
      provider: null,
      model: null,
      reason: `The local model is healthy but the selected preset requires: ${localMissing.join(', ')}. Cloud fallback is not authorized or cannot satisfy the preset.`,
      capabilities: localCapabilities,
      unmetCapabilities: localMissing
    };
  }
  if (anthropicKeyPresent() && !cloudAllowed) {
    return {
      available: false,
      provider: null,
      model: null,
      reason: options.privacyMode === 'local_only'
        ? 'No local Ollama model is running, and the selected preset is local-only.'
        : 'No local Ollama model is running, and cloud use is blocked because this conversation has no authorized cloud budget.',
      unmetCapabilities: required
    };
  }
  if (anthropicKeyPresent() && cloudMissing.length > 0) {
    return {
      available: false,
      provider: null,
      model: null,
      reason: `No configured provider satisfies: ${cloudMissing.join(', ')}.`,
      unmetCapabilities: cloudMissing
    };
  }
  return {
    available: false,
    provider: null,
    model: null,
    reason: `No model available: Ollama is not reachable at ${OLLAMA_BASE_URL} and ANTHROPIC_API_KEY is not set. Start Ollama or configure a cloud provider for an explicitly budgeted job.`,
    unmetCapabilities: required
  };
}
async function generateOllama(model: string, request: ModelRequest): Promise<ModelResponse> {
  const startedAt = Date.now();
  const res = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      // Thinking-class models (qwen3.5, deepseek-r1, …) stream reasoning into a
      // separate `thinking` field and can exhaust num_predict before emitting any
      // content, which surfaces here as an empty response. JoeCoder consumes only
      // the structured answer, so thinking is disabled; Ollama ignores the flag
      // for models without the capability.
      think: false,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt }
      ],
      keep_alive: '30m',
      options: {
        num_predict: request.maxTokens ?? 4096,
        ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {})
      }
    })
  }, request.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`OLLAMA_HTTP_${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json() as { message?: { content?: string; thinking?: string } };
  const text = data.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    const thinkingLen = data.message?.thinking?.length ?? 0;
    throw new Error(
      thinkingLen > 0
        ? `OLLAMA_EMPTY_RESPONSE: model produced ${thinkingLen} chars of thinking but no answer (token budget likely consumed by reasoning)`
        : 'OLLAMA_EMPTY_RESPONSE'
    );
  }
  return { text, provider: 'ollama', model, durationMs: Date.now() - startedAt };
}

async function generateAnthropic(model: string, request: ModelRequest): Promise<ModelResponse> {
  const startedAt = Date.now();
  const res = await fetchWithTimeout(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: request.maxTokens ?? 4096,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
      ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {})
    })
  }, request.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS);
  const data = await res.json().catch(() => ({})) as {
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(`ANTHROPIC_HTTP_${res.status}: ${data.error?.message || 'request failed'}`);
  }
  if (data.stop_reason === 'refusal') {
    throw new Error('ANTHROPIC_REFUSAL: the model declined this request; content was not produced.');
  }
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('');
  if (!text.trim()) throw new Error('ANTHROPIC_EMPTY_RESPONSE');
  return { text, provider: 'anthropic', model, durationMs: Date.now() - startedAt };
}

/**
 * Deterministic local mock for e2e / offline certification when JC_MOCK_MODEL=1.
 * Emits strict plan JSON or FILE blocks so the mutation path can be proven without Ollama.
 */
function mockGenerate(request: ModelRequest): ModelResponse {
  const startedAt = Date.now();
  const system = request.system || '';
  const prompt = request.prompt || '';
  const isPlan = /STRICT JSON|plan JSON|greenfield|files that must be modified|files to CREATE/i.test(system + prompt)
    || /Return the strict JSON plan/i.test(prompt);
  const isGreenfieldPlan = /greenfield app planner|target folder is empty or nearly empty|files to CREATE now/i.test(system + prompt);
  const isEdit = /===FILE:|===END FILE===|exact code-repair|file blocks/i.test(system + prompt);

  let text: string;
  if (isEdit) {
    // Prefer paths mentioned in scoped FILE sections of the prompt
    const pathMatch = prompt.match(/===FILE:\s*([^\n=]+?)\s*===/);
    const rel = (pathMatch?.[1] || 'src/lib.js').trim().replace(/\\/g, '/');
    let body = "export function add(a, b) { return a + b; }\n";
    if (/lib\.js|add\(/i.test(prompt) && /return a\s*-\s*b|broken|fix/i.test(prompt)) {
      body = "export function add(a, b) { return a + b; }\n";
    }
    // If prompt already shows content, produce a minimal fixed full file
    text = `===FILE: ${rel}===\n${body}===END FILE===\n`;
  } else if (isPlan) {
    const files: string[] = [];
    if (isGreenfieldPlan) {
      files.push('package.json', 'src/index.js', 'README.md');
    } else if (/src\/lib\.js/i.test(prompt)) {
      files.push('src/lib.js');
    } else {
      // Extract first path-like tokens from inventory
      const hits = prompt.match(/[\w./-]+\.(?:js|ts|tsx|mjs|cjs|json|md)/g) || [];
      for (const h of hits) {
        if (h.includes('node_modules') || h.includes('package-lock')) continue;
        if (!files.includes(h)) files.push(h);
        if (files.length >= 3) break;
      }
      if (!files.length) files.push('src/lib.js');
    }
    text = JSON.stringify({
      schemaVersion: 1,
      files,
      approach: 'Mock plan: minimal scoped change for offline certification.',
      risks: ['Mock model — replace with real local model for production use']
    });
  } else {
    text = 'I can only help within an authorized Work Order. Inspection stays read-only until you authorize scoped work.';
  }

  return {
    text,
    provider: 'ollama',
    model: 'jc-mock-model',
    durationMs: Math.max(1, Date.now() - startedAt)
  };
}

/** Generate with an already-resolved provider. Throws with a plain reason on failure. */
export async function generateWithProvider(resolution: ProviderResolution, request: ModelRequest): Promise<ModelResponse> {
  if (process.env.JC_MOCK_MODEL === '1') {
    return mockGenerate(request);
  }
  if (!resolution.available || !resolution.provider || !resolution.model) {
    throw new Error(`MODEL_UNAVAILABLE: ${resolution.reason}`);
  }
  if (resolution.provider === 'ollama') return generateOllama(resolution.model, request);
  return generateAnthropic(resolution.model, request);
}

/** Status summary for /health — never includes secrets. */
export async function providerStatus(): Promise<{ localModel: string | null; localCapabilities: string[]; cloudConfigured: boolean; policy: string; mockModel?: boolean }> {
  if (process.env.JC_MOCK_MODEL === '1') {
    return {
      localModel: 'jc-mock-model',
      localCapabilities: providerCapabilities('ollama'),
      cloudConfigured: anthropicKeyPresent(),
      policy: 'JC_MOCK_MODEL=1 active — not for production repairs',
      mockModel: true
    };
  }
  return {
    localModel: await detectOllama(),
    localCapabilities: providerCapabilities('ollama'),
    cloudConfigured: anthropicKeyPresent(),
    policy: 'preset capabilities + local privacy first; cloud only with explicit non-zero Work Order cloud budget',
    mockModel: false
  };
}

/**
 * Preload the local model into memory (fire-and-forget at server start) so the
 * first plan/edit call doesn't pay the multi-GB cold-load on top of inference.
 */
export async function warmLocalModel(): Promise<void> {
  try {
    const model = await detectOllama();
    if (!model) return;
    await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: '30m' })
    }, 120000);
  } catch {
    // Warm-up is best-effort; real calls will load the model themselves.
  }
}

/** Test seam: reset the detection cache. */
export function resetProviderCache(): void {
  ollamaCache = null;
}

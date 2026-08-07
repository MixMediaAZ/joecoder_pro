/**
 * Model provider layer — local-first, fail-closed.
 *
 * Ollama (loopback) is the preferred provider and is auto-detected at runtime.
 * Anthropic (cloud) is a fallback that activates only when ANTHROPIC_API_KEY is
 * set AND the caller explicitly allows cloud (a Work Order must carry a
 * non-zero maxCloudCostUsd budget). Dependency-free by design: this package
 * installs with --ignore-scripts --prefer-offline, so both clients use the
 * Node's built-in HTTP/fetch clients instead of SDKs.
 */

import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { ModelRouter, type ModelProviderAdapter, type ModelTaskType, type RoutedModelTurnRequest, type RoutedModelTurnResult } from './modelRouter.js';

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
  routingReason?: string;
  taskType?: ModelTaskType;
  eligibleProviders?: ProviderName[];
}

export interface ProviderRoutingOptions {
  allowCloud: boolean;
  privacyMode?: 'local_only' | 'local_first' | 'authorized_cloud';
  requiredCapabilities?: string[];
  taskType?: ModelTaskType;
  contextCharacters?: number;
  maxCloudCostUsd?: number;
  presetId?: string;
  excludeModels?: string[];
}

const OLLAMA_BASE_URL = process.env.JC_OLLAMA_URL || 'http://127.0.0.1:11434';
const ANTHROPIC_BASE_URL = process.env.JC_ANTHROPIC_URL || 'https://api.anthropic.com';
const ANTHROPIC_DEFAULT_MODEL = process.env.JC_ANTHROPIC_MODEL || 'claude-opus-5';
const OLLAMA_DETECT_TIMEOUT_MS = 2000;
const OLLAMA_DETECT_CACHE_MS = 30000;
const DEFAULT_GENERATE_TIMEOUT_MS = 120000;

let ollamaCache: { checkedAt: number; model: string | null } | null = null;
let productionRouter: { signature: string; router: ModelRouter } | null = null;

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
  const taskType = options.taskType || 'conversation';
  const contextTokens = Math.max(1, Math.ceil((options.contextCharacters || 0) / 4)) + 4096;
  const excluded = new Set(options.excludeModels || []);
  const presetNote = options.presetId ? ` preset=${options.presetId};` : '';
  // Offline/e2e seam: deterministic mock satisfies the same local policy metadata.
  if (process.env.JC_MOCK_MODEL === '1' && !excluded.has('jc-mock-model')) {
    const reason = `Local mock selected; task=${taskType}; context=${contextTokens};${presetNote} zero cloud cost.`;
    return {
      available: true,
      provider: 'ollama',
      model: 'jc-mock-model',
      reason,
      routingReason: reason,
      taskType,
      eligibleProviders: ['ollama'],
      capabilities: providerCapabilities('ollama')
    };
  }

  const localModel = await detectOllama();
  const localCapabilities = providerCapabilities('ollama');
  const localMissing = missingProviderCapabilities('ollama', required);
  const localContextWindow = Math.max(4096, Number(process.env.JC_OLLAMA_CONTEXT_WINDOW || 32768));
  const localEligible = Boolean(localModel) && !excluded.has(localModel || '') && localMissing.length === 0 && contextTokens <= localContextWindow;

  const cloudAllowed = options.allowCloud && options.privacyMode !== 'local_only';
  const cloudCapabilities = providerCapabilities('anthropic');
  const cloudMissing = missingProviderCapabilities('anthropic', required);
  const cloudContextWindow = 200_000;
  const maximumCloudCost = options.maxCloudCostUsd ?? (options.allowCloud ? Number.POSITIVE_INFINITY : 0);
  const estimatedCloudCost = (Math.ceil((options.contextCharacters || 0) / 4) * 3 + 4096 * 15) / 1_000_000;
  const cloudEligible = anthropicKeyPresent() && cloudAllowed && !excluded.has(ANTHROPIC_DEFAULT_MODEL) &&
    cloudMissing.length === 0 && contextTokens <= cloudContextWindow && estimatedCloudCost <= maximumCloudCost;
  const eligibleProviders: ProviderName[] = [
    ...(localEligible ? ['ollama' as const] : []),
    ...(cloudEligible ? ['anthropic' as const] : [])
  ];

  if (localEligible) {
    const reason = `Local-first route selected Ollama/${localModel}; task=${taskType}; capabilities=${required.join(',') || 'standard'}; context=${contextTokens}/${localContextWindow};${presetNote} observed healthy; cloud cost=$0.`;
    return {
      available: true, provider: 'ollama', model: localModel, reason, routingReason: reason,
      taskType, eligibleProviders, capabilities: localCapabilities
    };
  }
  if (cloudEligible) {
    const localReason = !localModel ? 'local unavailable'
      : excluded.has(localModel) ? 'local excluded after failure'
        : localMissing.length ? `local missing ${localMissing.join(',')}`
          : `local context ${contextTokens} exceeds ${localContextWindow}`;
    const reason = `Authorized cloud fallback selected Anthropic/${ANTHROPIC_DEFAULT_MODEL}; ${localReason}; task=${taskType}; context=${contextTokens}/${cloudContextWindow};${presetNote} estimated cost=$${estimatedCloudCost.toFixed(6)} within $${maximumCloudCost.toFixed(6)}.`;
    return {
      available: true, provider: 'anthropic', model: ANTHROPIC_DEFAULT_MODEL, reason, routingReason: reason,
      taskType, eligibleProviders, capabilities: cloudCapabilities
    };
  }

  const blockers = [
    !localModel ? `Ollama is not reachable at ${OLLAMA_BASE_URL}` : null,
    localModel && excluded.has(localModel) ? `local model ${localModel} is excluded after an observed failure` : null,
    localMissing.length ? `local model is healthy but lacks ${localMissing.join(', ')}` : null,
    localModel && contextTokens > localContextWindow ? `local context need ${contextTokens} exceeds ${localContextWindow}` : null,
    !anthropicKeyPresent() ? 'cloud profile is not configured' : null,
    !cloudAllowed ? 'cloud is not authorized by privacy and Work Order policy' : null,
    cloudMissing.length ? `cloud model lacks ${cloudMissing.join(', ')}` : null,
    estimatedCloudCost > maximumCloudCost ? `estimated cloud cost $${estimatedCloudCost.toFixed(6)} exceeds $${maximumCloudCost.toFixed(6)}` : null
  ].filter(Boolean);
  return {
    available: false,
    provider: null,
    model: null,
    reason: `No eligible model for task=${taskType}: ${blockers.join('; ')}.`,
    routingReason: `No eligible model for task=${taskType}: ${blockers.join('; ')}.`,
    taskType,
    eligibleProviders,
    ...(localModel ? { capabilities: localCapabilities } : {}),
    unmetCapabilities: Array.from(new Set([...localMissing, ...cloudMissing]))
  };
}
async function generateOllama(model: string, request: ModelRequest): Promise<ModelResponse> {
  const startedAt = Date.now();
  const timeoutMs = request.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS;
  let timedOut = false;
  let activeRequest: ClientRequest | null = null;
  const timer = setTimeout(() => {
    timedOut = true;
    activeRequest?.destroy(new Error('OLLAMA_REQUEST_DEADLINE'));
  }, timeoutMs);
  try {
  // Direct loopback HTTP avoids Undici's hidden five-minute response-header deadline. Ollama
  // may not flush headers until the first token after a large prompt, so our Work Order timer is
  // the sole request deadline.
  const body = JSON.stringify({
      model,
      stream: true,
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
  });
  const endpoint = new URL('/api/chat', OLLAMA_BASE_URL);
  const res = await new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = httpRequest(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, resolve);
    activeRequest = outgoing;
    outgoing.once('error', reject);
    outgoing.end(body);
  });
  if ((res.statusCode || 500) >= 400) {
    let errorBody = '';
    for await (const chunk of res) errorBody += chunk.toString();
    throw new Error(`OLLAMA_HTTP_${res.statusCode || 500}: ${errorBody.slice(0, 300)}`);
  }
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';
  let thinkingLen = 0;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as { message?: { content?: string; thinking?: string }; error?: string };
    if (chunk.error) throw new Error(`OLLAMA_STREAM_ERROR: ${chunk.error}`);
    if (typeof chunk.message?.content === 'string') text += chunk.message.content;
    if (typeof chunk.message?.thinking === 'string') thinkingLen += chunk.message.thinking.length;
  };
  for await (const value of res) {
    pending += decoder.decode(value as Buffer, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) consume(line);
  }
  pending += decoder.decode();
  consume(pending);
  if (!text.trim()) {
    throw new Error(
      thinkingLen > 0
        ? `OLLAMA_EMPTY_RESPONSE: model produced ${thinkingLen} chars of thinking but no answer (token budget likely consumed by reasoning)`
        : 'OLLAMA_EMPTY_RESPONSE'
    );
  }
  return { text, provider: 'ollama', model, durationMs: Date.now() - startedAt };
  } catch (error: unknown) {
    if (timedOut) {
      throw new Error(`MODEL_REQUEST_TIMEOUT after ${Math.round(timeoutMs / 1000)}s (${OLLAMA_BASE_URL}/api/chat)`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

function routedToLegacyRequest(request: RoutedModelTurnRequest): ModelRequest {
  const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
  const prompt = request.messages.filter((message) => message.role !== 'system')
    .map((message) => `${message.role.toUpperCase()}${message.name ? `(${message.name})` : ''}: ${message.content}`)
    .join('\n\n');
  return {
    system,
    prompt,
    maxTokens: request.maxOutputTokens,
    timeoutMs: request.timeoutMs,
    temperature: request.temperature
  };
}

function routedUsage(text: string, request: RoutedModelTurnRequest): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: Math.max(1, Math.ceil(request.messages.reduce((sum, message) => sum + message.content.length, 0) / 4)),
    outputTokens: Math.max(1, Math.ceil(text.length / 4))
  };
}

/** Build environment-backed adapters without ever copying secret values into a profile. */
export async function configuredModelAdapters(): Promise<ModelProviderAdapter[]> {
  if (process.env.JC_MOCK_MODEL === '1') {
    return [{
      profile: {
        id: 'ollama:jc-mock-model', provider: 'ollama', model: 'jc-mock-model', location: 'local', enabled: true,
        capabilities: providerCapabilities('ollama'), contextWindowTokens: 32_768,
        taskTypes: ['conversation', 'investigation', 'visual_analysis', 'implementation', 'review', 'structured_control'],
        qualityTier: 1, inputCostPerMillionTokens: 0, outputCostPerMillionTokens: 0
      },
      generate: async (request) => {
        const result = mockGenerate(routedToLegacyRequest(request as RoutedModelTurnRequest));
        return { text: result.text, usage: { ...routedUsage(result.text, request as RoutedModelTurnRequest), costUsd: 0 } };
      }
    }];
  }
  const adapters: ModelProviderAdapter[] = [];
  const localModel = await detectOllama();
  if (localModel) {
    adapters.push({
      profile: {
        id: `ollama:${localModel}`, provider: 'ollama', model: localModel, location: 'local', enabled: true,
        capabilities: providerCapabilities('ollama'),
        contextWindowTokens: Math.max(4096, Number(process.env.JC_OLLAMA_CONTEXT_WINDOW || 32768)),
        taskTypes: ['conversation', 'investigation', 'implementation', 'review', 'structured_control',
          ...(providerCapabilities('ollama').includes('vision') ? ['visual_analysis' as const] : [])],
        qualityTier: /(?:32b|70b|large)/i.test(localModel) ? 4 : /(?:14b|20b)/i.test(localModel) ? 3 : 2,
        inputCostPerMillionTokens: 0, outputCostPerMillionTokens: 0
      },
      generate: async (request) => {
        const result = await generateOllama(localModel, routedToLegacyRequest(request as RoutedModelTurnRequest));
        return { text: result.text, usage: { ...routedUsage(result.text, request as RoutedModelTurnRequest), costUsd: 0 } };
      }
    });
  }
  if (anthropicKeyPresent()) {
    adapters.push({
      profile: {
        id: `anthropic:${ANTHROPIC_DEFAULT_MODEL}`, provider: 'anthropic', model: ANTHROPIC_DEFAULT_MODEL,
        location: 'cloud', enabled: true, capabilities: providerCapabilities('anthropic'), contextWindowTokens: 200_000,
        taskTypes: ['conversation', 'investigation', 'visual_analysis', 'implementation', 'review', 'structured_control'],
        qualityTier: 5, inputCostPerMillionTokens: 3, outputCostPerMillionTokens: 15
      },
      generate: async (request) => {
        const result = await generateAnthropic(ANTHROPIC_DEFAULT_MODEL, routedToLegacyRequest(request as RoutedModelTurnRequest));
        return { text: result.text, usage: routedUsage(result.text, request as RoutedModelTurnRequest) };
      }
    });
  }
  return adapters;
}

export async function generateRoutedModelTurn(
  request: RoutedModelTurnRequest,
  onAttempt?: Parameters<ModelRouter['execute']>[1]
): Promise<RoutedModelTurnResult> {
  const adapters = await configuredModelAdapters();
  const signature = JSON.stringify(adapters.map((adapter) => adapter.profile));
  if (!productionRouter || productionRouter.signature !== signature) {
    productionRouter = { signature, router: new ModelRouter(adapters) };
  }
  return productionRouter.router.execute(request, onAttempt);
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
  productionRouter = null;
}

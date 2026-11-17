import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { ModelGenerateRequest, ModelGenerateResult, ModelProviderProfile } from './modelRouter.js';

export type AddedCloudProvider = 'deepseek' | 'replicate';
export type CloudProvider = 'anthropic' | AddedCloudProvider;
export const CLOUD_PROVIDERS: CloudProvider[] = ['anthropic', 'deepseek', 'replicate'];

export function cloudPreference(): CloudProvider | null {
  const name = process.env.JC_CLOUD_PROVIDER?.trim().toLowerCase();
  if (!name || name === 'auto') return null;
  if (!CLOUD_PROVIDERS.includes(name as CloudProvider)) throw new Error('INVALID_CLOUD_PROVIDER: use auto, anthropic, deepseek, or replicate');
  return name as CloudProvider;
}

function credential(value: string | undefined): string {
  const key = value?.trim() || '';
  return /your-|replace|paste|placeholder/i.test(key) ? '' : key;
}

export function cloudKey(provider: AddedCloudProvider): string {
  return provider === 'deepseek' ? credential(process.env.DEEPSEEK_API_KEY)
    : credential(process.env.REPLICATE_API_TOKEN) || credential(process.env.REPLICATE_API_KEY);
}

function rate(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`INVALID_PROVIDER_CONFIG: ${name} must be a positive number`);
  return value;
}

export function cloudProfile(provider: AddedCloudProvider): ModelProviderProfile {
  const model = provider === 'deepseek' ? process.env.JC_DEEPSEEK_MODEL?.trim() || 'deepseek-flash'
    : process.env.JC_REPLICATE_MODEL?.trim() || 'deepseek-ai/deepseek-r1';
  // Each integration has a known schema and price card. Never reuse these for an arbitrary model.
  if (provider === 'deepseek' && !['deepseek-flash', 'deepseek-v4-pro'].includes(model)) {
    throw new Error('INVALID_PROVIDER_CONFIG: JC_DEEPSEEK_MODEL must be deepseek-flash or deepseek-v4-pro');
  }
  if (provider === 'replicate' && model !== 'deepseek-ai/deepseek-r1') {
    throw new Error('INVALID_PROVIDER_CONFIG: this Replicate text adapter supports deepseek-ai/deepseek-r1');
  }
  const pro = model === 'deepseek-v4-pro';
  const prefix = `JC_${provider.toUpperCase()}`;
  return {
    id: `${provider}:${model}`, provider, model, location: 'cloud', enabled: Boolean(cloudKey(provider)),
    // 'tools' means JoeCoder's validated text/JSON/file-block tool protocol,
    // shared with existing providers. Native API tool calls/vision are not sent.
    capabilities: ['chat', 'code', 'long_context', 'tools'],
    contextWindowTokens: provider === 'deepseek' ? 1_000_000 : 65_536,
    taskTypes: ['conversation', 'investigation', 'implementation', 'review', 'structured_control'],
    qualityTier: 5,
    // Peak, uncached rates are conservative budget estimates, not an invoice.
    inputCostPerMillionTokens: rate(`${prefix}_INPUT_COST_PER_MILLION`, provider === 'replicate' ? 3.75 : pro ? 1.32 : 0.30),
    outputCostPerMillionTokens: rate(`${prefix}_OUTPUT_COST_PER_MILLION`, provider === 'replicate' ? 10 : pro ? 3.96 : 1.20)
  };
}

export function cloudInputTokens(request: Pick<ModelGenerateRequest, 'messages'>): number {
  // Conservative UTF-8 byte estimate covers code, CJK, and prompt wrappers.
  return request.messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8') + 32, 32);
}

export function cloudCost(profile: ModelProviderProfile, input: number, output: number): number {
  return (input * profile.inputCostPerMillionTokens + output * profile.outputCostPerMillionTokens) / 1_000_000;
}

function endpoint(provider: AddedCloudProvider): string {
  const raw = process.env[`JC_${provider.toUpperCase()}_URL`]?.trim()
    || (provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.replicate.com');
  const url = new URL(raw);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash) {
    throw new Error('INVALID_PROVIDER_CONFIG: provider URL requires HTTPS (HTTP allowed only on loopback), without credentials or query');
  }
  return raw.replace(/\/+$/, '').replace(/\/v1$/, '');
}

async function fetchApi(provider: AddedCloudProvider, url: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init, signal, redirect: 'error',
    headers: { Authorization: `Bearer ${cloudKey(provider)}`, 'Content-Type': 'application/json', ...init.headers }
  });
  if (!response.ok) {
    await response.body?.cancel();
    // Bodies may echo prompts or keys; never include them in errors or logs.
    const hint = response.status === 401 || response.status === 403 ? 'check API credentials and model access'
      : response.status === 429 ? 'rate limited; retry later' : response.status === 402 ? 'provider account has insufficient credit'
        : response.status === 404 ? 'model or endpoint unavailable' : 'provider request failed';
    throw new Error(`${provider.toUpperCase()}_HTTP_${response.status}: ${hint}`);
  }
  return response;
}

const TokenCount = z.number().int().nonnegative().finite();
const DeepSeekChunk = z.object({
  choices: z.array(z.object({
    delta: z.object({ content: z.string().nullable().optional() }).optional(),
    finish_reason: z.string().nullable().optional()
  })),
  usage: z.object({ prompt_tokens: TokenCount, completion_tokens: TokenCount }).nullable().optional()
});

async function deepseek(request: ModelGenerateRequest, profile: ModelProviderProfile, signal: AbortSignal): Promise<ModelGenerateResult> {
  const response = await fetchApi('deepseek', `${endpoint('deepseek')}/chat/completions`, signal, {
    method: 'POST', body: JSON.stringify({
      model: profile.model,
      messages: request.messages.map(message => ({
        role: message.role === 'tool' ? 'user' : message.role,
        content: message.role === 'tool' ? `Tool result (${message.name || 'tool'}):\n${message.content}` : message.content
      })),
      max_tokens: request.maxOutputTokens, temperature: request.temperature,
      thinking: { type: 'disabled' }, stream: true, stream_options: { include_usage: true }
    })
  });
  if (!response.body) throw new Error('DEEPSEEK_INVALID_OUTPUT: missing response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';
  let finishReason: string | undefined;
  let usage: ModelGenerateResult['usage'];
  let done = false;
  const consume = (line: string) => {
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (raw === '[DONE]') { done = true; return; }
    const parsed = DeepSeekChunk.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error('DEEPSEEK_INVALID_OUTPUT: malformed stream event');
    const chunk = parsed.data;
    text += chunk.choices[0]?.delta?.content || '';
    finishReason = chunk.choices[0]?.finish_reason || finishReason;
    if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
  };
  try {
    while (!done) {
      const next = await reader.read();
      pending += decoder.decode(next.value, { stream: !next.done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) consume(line);
      if (next.done) { if (pending.trim()) consume(pending); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!done || !finishReason) throw new Error('DEEPSEEK_INVALID_OUTPUT: incomplete stream');
  if (!text.trim()) throw new Error('DEEPSEEK_INVALID_OUTPUT: no answer returned');
  if (finishReason === 'content_filter' || finishReason === 'tool_calls') throw new Error(`DEEPSEEK_INVALID_OUTPUT: ${finishReason}`);
  return { text, finishReason, usage: usage || { inputTokens: cloudInputTokens(request), outputTokens: request.maxOutputTokens } };
}

const Prediction = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  status: z.enum(['starting', 'processing', 'succeeded', 'failed', 'canceled', 'aborted']),
  output: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  metrics: z.object({ input_token_count: TokenCount.optional(), output_token_count: TokenCount.optional() }).nullable().optional()
});

async function replicate(request: ModelGenerateRequest, profile: ModelProviderProfile, signal: AbortSignal): Promise<ModelGenerateResult> {
  const base = endpoint('replicate');
  let predictionId: string | undefined;
  let terminal = false;
  const parse = async (response: Response) => {
    const raw: unknown = await response.json();
    const id = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/) }).safeParse(raw);
    if (id.success) predictionId = id.data.id;
    const result = Prediction.safeParse(raw);
    if (!result.success) throw new Error('REPLICATE_INVALID_OUTPUT: malformed prediction');
    return result.data;
  };
  try {
    let prediction = await parse(await fetchApi('replicate', `${base}/v1/models/${profile.model}/predictions`, signal, {
      method: 'POST', headers: { Prefer: 'wait=1', 'Cancel-After': `${Math.max(5, Math.ceil(request.timeoutMs / 1000))}s` },
      body: JSON.stringify({ input: {
        prompt: request.messages.map(message => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n'),
        max_tokens: request.maxOutputTokens, temperature: request.temperature
      } })
    }));
    while (prediction.status === 'starting' || prediction.status === 'processing') {
      await delay(500, undefined, { signal });
      prediction = await parse(await fetchApi('replicate', `${base}/v1/predictions/${predictionId}`, signal));
    }
    terminal = true;
    if (prediction.status === 'canceled' || prediction.status === 'aborted') throw new Error('REPLICATE_CANCELLED: prediction stopped');
    if (prediction.status === 'failed') throw new Error('REPLICATE_PROVIDER_ERROR: prediction failed; inspect the prediction in your Replicate dashboard');
    const raw = Array.isArray(prediction.output) ? prediction.output.join('') : prediction.output || '';
    // Remove only a leading R1 reasoning envelope, never tags in final code.
    const trimmed = raw.trimStart();
    let text = raw;
    if (trimmed.startsWith('<think>')) {
      const end = trimmed.indexOf('</think>');
      if (end < 0) throw new Error('REPLICATE_INVALID_OUTPUT: reasoning exhausted the output limit before an answer');
      text = trimmed.slice(end + '</think>'.length).trimStart();
    }
    if (!text.trim()) throw new Error('REPLICATE_INVALID_OUTPUT: no answer returned');
    const inputTokens = prediction.metrics?.input_token_count ?? cloudInputTokens(request);
    // Reserve all requested output if metrics are absent, including reasoning.
    const outputTokens = prediction.metrics?.output_token_count ?? request.maxOutputTokens;
    return { text, usage: { inputTokens, outputTokens },
      finishReason: prediction.metrics?.output_token_count !== undefined && outputTokens >= request.maxOutputTokens ? 'length' : 'stop' };
  } finally {
    if (predictionId && !terminal) {
      try {
        await fetchApi('replicate', `${base}/v1/predictions/${predictionId}/cancel`, AbortSignal.timeout(2000), { method: 'POST' });
      } catch {
        console.warn('[providers] Replicate cancellation was not confirmed; the server-side Cancel-After deadline remains in effect.');
      }
    }
  }
}

export async function generateCloud(provider: AddedCloudProvider, request: ModelGenerateRequest, budgetUsd: number): Promise<ModelGenerateResult> {
  const profile = cloudProfile(provider);
  if (!cloudKey(provider)) throw new Error(`${provider.toUpperCase()}_AUTHENTICATION: API key is not configured`);
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new Error('MODEL_BUDGET_REQUIRED: cloud generation needs a positive authorized budget');
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || !Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
    throw new Error('INVALID_MODEL_REQUEST: positive token and timeout limits required');
  }
  if (request.signal?.aborted) throw new Error('MODEL_CANCELLED');
  const inputTokens = cloudInputTokens(request);
  const maxOutputTokens = Math.min(request.maxOutputTokens, profile.contextWindowTokens - inputTokens, provider === 'deepseek' ? 393216 : 32768);
  if (maxOutputTokens < 1) throw new Error('MODEL_CONTEXT_EXCEEDED: prompt exceeds the configured context window');
  const bounded = { ...request, maxOutputTokens };
  const estimate = cloudCost(profile, inputTokens, maxOutputTokens);
  if (estimate > budgetUsd) throw new Error(`MODEL_BUDGET_EXCEEDED: estimated $${estimate.toFixed(6)} exceeds remaining $${budgetUsd.toFixed(6)}`);
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  request.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, request.timeoutMs);
  try {
    const result = await (provider === 'deepseek' ? deepseek(bounded, profile, controller.signal) : replicate(bounded, profile, controller.signal));
    result.usage = { ...result.usage, costUsd: cloudCost(profile, result.usage?.inputTokens ?? inputTokens, result.usage?.outputTokens ?? maxOutputTokens) };
    return result;
  } catch (error: unknown) {
    if (timedOut) throw new Error(`MODEL_REQUEST_TIMEOUT: ${provider} exceeded ${request.timeoutMs}ms`);
    if (request.signal?.aborted) throw new Error('MODEL_CANCELLED');
    if (error instanceof SyntaxError) throw new Error(`${provider.toUpperCase()}_INVALID_OUTPUT: invalid JSON`);
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', cancel);
  }
}

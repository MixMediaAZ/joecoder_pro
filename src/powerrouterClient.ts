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
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.tried !== undefined) this.tried = opts.tried;
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

export function isLoopbackPowerRouterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (hostname === 'localhost' || hostname === '::1') return true;
    const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!ipv4) return false;
    const octets = ipv4.slice(1).map((value) => Number(value));
    if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) return false;
    return octets[0] === 127;
  } catch {
    return false;
  }
}

export function powerRouterConfigured(): boolean {
  const url = env('JC_POWERROUTER_URL');
  const key = env('JC_POWERROUTER_KEY');
  return Boolean(url && key && isLoopbackPowerRouterUrl(url));
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

  const dispatchInit: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) };
  if (request.signal) dispatchInit.signal = request.signal;

  const { status, data } = await fetchJson(
    `${powerRouterBaseUrl()}/api/dispatch`,
    dispatchInit,
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

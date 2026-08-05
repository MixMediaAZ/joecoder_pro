export type ModelLocation = 'local' | 'cloud';
export type ModelTaskType = 'conversation' | 'investigation' | 'visual_analysis' | 'implementation' | 'review' | 'structured_control';
export type ModelErrorClass = 'cancelled' | 'timeout' | 'unavailable' | 'rate_limited' | 'authentication' | 'invalid_output' | 'budget' | 'provider_error';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ModelProviderProfile {
  id: string;
  provider: string;
  model: string;
  location: ModelLocation;
  enabled: boolean;
  capabilities: string[];
  contextWindowTokens: number;
  taskTypes: ModelTaskType[];
  qualityTier: number;
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
}

export interface ModelGenerateRequest {
  messages: ModelMessage[];
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
  signal?: AbortSignal;
  structuredSchemaName?: string;
}

export interface ModelGenerateResult {
  text: string;
  usage?: Partial<ModelUsage>;
  finishReason?: string;
}

export interface ModelProviderAdapter {
  profile: ModelProviderProfile;
  generate(request: ModelGenerateRequest): Promise<ModelGenerateResult>;
}

export interface RoutedModelTurnRequest extends ModelGenerateRequest {
  taskType: ModelTaskType;
  requiredCapabilities: string[];
  privacyMode: 'local_only' | 'local_first' | 'authorized_cloud';
  authorizedCloudBudgetUsd: number;
  presetId?: string;
  validate?: (text: string) => void;
}

export interface ModelRouteAttempt {
  providerId: string;
  provider: string;
  model: string;
  routingReason: string;
  status: 'selected' | 'failed' | 'succeeded';
  errorClass?: ModelErrorClass;
  error?: string;
  usage?: ModelUsage;
}

export interface RoutedModelTurnResult extends ModelGenerateResult {
  provider: string;
  model: string;
  providerId: string;
  routingReason: string;
  usage: ModelUsage;
  attempts: ModelRouteAttempt[];
}

interface ProviderHealth {
  consecutiveFailures: number;
  blockedUntil: number;
  lastErrorClass: ModelErrorClass | null;
}

export class ModelRoutingError extends Error {
  readonly code = 'NO_ELIGIBLE_MODEL';
  constructor(message: string, readonly attempts: ModelRouteAttempt[]) {
    super(message);
  }
}

function estimateTokens(messages: ModelMessage[]): number {
  return Math.max(1, Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 4));
}

function estimatedCost(profile: ModelProviderProfile, inputTokens: number, outputTokens: number): number {
  if (profile.location === 'local') return 0;
  return (inputTokens / 1_000_000) * profile.inputCostPerMillionTokens +
    (outputTokens / 1_000_000) * profile.outputCostPerMillionTokens;
}

export function classifyModelError(error: unknown): ModelErrorClass {
  if (error instanceof SyntaxError) return 'invalid_output';
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes('abort') || message.includes('cancel')) return 'cancelled';
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('401') || message.includes('403') || message.includes('authentication')) return 'authentication';
  if (message.includes('429') || message.includes('rate limit')) return 'rate_limited';
  if (message.includes('invalid') || message.includes('schema') || message.includes('parse')) return 'invalid_output';
  if (message.includes('budget') || message.includes('cost')) return 'budget';
  if (message.includes('unavailable') || message.includes('not reachable') || message.includes('connection')) return 'unavailable';
  return 'provider_error';
}

async function runWithTurnBounds<T>(promise: Promise<T>, request: ModelGenerateRequest): Promise<T> {
  if (request.signal?.aborted) throw new Error('MODEL_CANCELLED');
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MODEL_REQUEST_TIMEOUT after ${request.timeoutMs}ms`)), request.timeoutMs);
    const abort = () => reject(new Error('MODEL_CANCELLED'));
    request.signal?.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => { clearTimeout(timer); request.signal?.removeEventListener('abort', abort); resolve(value); },
      (error) => { clearTimeout(timer); request.signal?.removeEventListener('abort', abort); reject(error); }
    );
  });
}

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(?:sk-ant-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[REDACTED]')
    .slice(0, 1000);
}

export class ModelRouter {
  private readonly health = new Map<string, ProviderHealth>();

  constructor(private readonly adapters: ModelProviderAdapter[]) {}

  private healthFor(id: string): ProviderHealth {
    return this.health.get(id) || { consecutiveFailures: 0, blockedUntil: 0, lastErrorClass: null };
  }

  private eligible(request: RoutedModelTurnRequest): Array<{ adapter: ModelProviderAdapter; reason: string; score: number }> {
    const inputTokens = estimateTokens(request.messages);
    const required = new Set(request.requiredCapabilities.map((item) => item.toLowerCase()));
    return this.adapters.flatMap((adapter) => {
      const profile = adapter.profile;
      const health = this.healthFor(profile.id);
      if (!profile.enabled || health.blockedUntil > Date.now()) return [];
      if (profile.location === 'cloud' && request.privacyMode !== 'authorized_cloud') return [];
      if (profile.location === 'cloud' && request.authorizedCloudBudgetUsd <= 0) return [];
      if (inputTokens + request.maxOutputTokens > profile.contextWindowTokens) return [];
      const capabilities = new Set(profile.capabilities.map((item) => item.toLowerCase()));
      if (Array.from(required).some((capability) => !capabilities.has(capability))) return [];
      const cost = estimatedCost(profile, inputTokens, request.maxOutputTokens);
      if (cost > request.authorizedCloudBudgetUsd) return [];
      const exactTask = profile.taskTypes.includes(request.taskType);
      const localBonus = profile.location === 'local' && request.privacyMode !== 'authorized_cloud' ? 100 : 0;
      const localFirstBonus = profile.location === 'local' && request.privacyMode === 'local_first' ? 60 : 0;
      const score = profile.qualityTier * 10 + (exactTask ? 25 : 0) + localBonus + localFirstBonus - health.consecutiveFailures * 30;
      const reason = [
        `${profile.location} ${profile.provider}/${profile.model}`,
        `task=${request.taskType}${exactTask ? ' specialized' : ''}`,
        `capabilities=${Array.from(required).join(',') || 'standard'}`,
        `context=${inputTokens + request.maxOutputTokens}/${profile.contextWindowTokens}`,
        `estimatedCost=$${cost.toFixed(6)}`,
        request.presetId ? `preset=${request.presetId}` : null,
        `healthFailures=${health.consecutiveFailures}`
      ].filter(Boolean).join('; ');
      return [{ adapter, reason, score }];
    }).sort((left, right) => right.score - left.score || left.adapter.profile.id.localeCompare(right.adapter.profile.id));
  }

  async execute(request: RoutedModelTurnRequest, onAttempt?: (attempt: ModelRouteAttempt) => void | Promise<void>): Promise<RoutedModelTurnResult> {
    const ranked = this.eligible(request);
    const attempts: ModelRouteAttempt[] = [];
    if (!ranked.length) {
      throw new ModelRoutingError('No configured model satisfies the task, capability, privacy, context, health, and authorized cost limits.', attempts);
    }
    const inputTokens = estimateTokens(request.messages);
    for (const candidate of ranked) {
      const profile = candidate.adapter.profile;
      const selected: ModelRouteAttempt = {
        providerId: profile.id, provider: profile.provider, model: profile.model,
        routingReason: candidate.reason, status: 'selected'
      };
      attempts.push(selected);
      await onAttempt?.({ ...selected });
      try {
        if (request.signal?.aborted) throw new Error('MODEL_CANCELLED');
        const generated = await runWithTurnBounds(candidate.adapter.generate(request), request);
        request.validate?.(generated.text);
        const usage: ModelUsage = {
          inputTokens: Math.max(0, Math.trunc(generated.usage?.inputTokens ?? inputTokens)),
          outputTokens: Math.max(0, Math.trunc(generated.usage?.outputTokens ?? Math.ceil(generated.text.length / 4))),
          costUsd: 0
        };
        usage.costUsd = generated.usage?.costUsd ?? estimatedCost(profile, usage.inputTokens, usage.outputTokens);
        if (profile.location === 'cloud' && usage.costUsd > request.authorizedCloudBudgetUsd) {
          throw new Error(`MODEL_BUDGET_EXCEEDED: $${usage.costUsd.toFixed(6)} > $${request.authorizedCloudBudgetUsd.toFixed(6)}`);
        }
        this.health.set(profile.id, { consecutiveFailures: 0, blockedUntil: 0, lastErrorClass: null });
        const succeeded: ModelRouteAttempt = { ...selected, status: 'succeeded', usage };
        attempts[attempts.length - 1] = succeeded;
        await onAttempt?.({ ...succeeded });
        return {
          ...generated,
          provider: profile.provider,
          model: profile.model,
          providerId: profile.id,
          routingReason: candidate.reason,
          usage,
          attempts
        };
      } catch (error: unknown) {
        const errorClass = classifyModelError(error);
        const prior = this.healthFor(profile.id);
        const failures = prior.consecutiveFailures + 1;
        this.health.set(profile.id, {
          consecutiveFailures: failures,
          blockedUntil: Date.now() + (failures >= 2 ? 60_000 : 0),
          lastErrorClass: errorClass
        });
        const failed: ModelRouteAttempt = {
          ...selected, status: 'failed', errorClass, error: safeError(error)
        };
        attempts[attempts.length - 1] = failed;
        await onAttempt?.({ ...failed });
        if (errorClass === 'cancelled' || errorClass === 'budget') {
          throw new ModelRoutingError(failed.error || 'Model turn stopped safely.', attempts);
        }
      }
    }
    throw new ModelRoutingError('Every eligible model failed; Joe stopped without widening privacy, capability, authority, context, or cost limits.', attempts);
  }
}

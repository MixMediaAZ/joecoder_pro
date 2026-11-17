import { randomUUID } from 'node:crypto';
import { appendAgentJobJournal } from './database/database.js';
import { currentAgentJobId } from './agentWorkflowBudget.js';
import { ModelRoutingError, type RoutedModelTurnResult } from './modelRouter.js';
import { generateWithProvider, generateRoutedModelTurn, type ProviderResolution, type ModelRequest, type ModelResponse } from './providers.js';

/** Reuse the existing router for bounded coding retries inside sealed local authority. */
export async function generateCodingTurn(
  provider: ProviderResolution,
  request: ModelRequest,
  options: { task: 'implementation' | 'review' | 'structured_control'; validate: (text: string) => unknown; allowedProviders?: string[] | undefined },
  route: typeof generateRoutedModelTurn = generateRoutedModelTurn
): Promise<ModelResponse> {
  const allowed = options.allowedProviders || provider.eligibleProviders || [];
  if (options.allowedProviders && provider.provider && !allowed.includes(provider.provider)) throw new Error('CODING_PROVIDER_OUTSIDE_AUTHORITY');
  if (!provider.available || provider.provider !== 'powerrouter' || !allowed.includes('ollama')) {
    return generateWithProvider(provider, request);
  }
  const window = Number(process.env.JC_OLLAMA_CONTEXT_WINDOW || 32768);
  if (!Number.isSafeInteger(window) || window < 4096) throw new Error('MODEL_CONTEXT_CONFIGURATION_INVALID');
  const input = Math.ceil((request.system.length + request.prompt.length) / 4) + 1024;
  if (input + 1024 >= window) throw new Error('MODEL_CONTEXT_LIMIT: coding context must be narrowed before another generation.');
  const started = Date.now();
  const jobId = currentAgentJobId();
  let selected: { provider: string; model: string } | undefined;
  let rejected: { text: string; provider: string; model: string } | undefined;
  const response: RoutedModelTurnResult = await route({
    messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }],
    taskType: options.task, requiredCapabilities: provider.capabilities || ['code'],
    privacyMode: 'local_only', authorizedCloudBudgetUsd: 0, maxAttempts: 2,
    allowedProviders: allowed.filter(name => name === 'powerrouter' || name === 'ollama'),
    maxOutputTokens: Math.min(request.maxTokens ?? 4096, window - input),
    timeoutMs: Math.min(request.timeoutMs ?? 180000, 180000), temperature: request.temperature ?? 0.1,
    ...(request.format ? { structuredSchemaName: 'coding_plan' } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
    validate: text => {
      try { options.validate(text); }
      catch (error) {
        if (selected) rejected = { text, ...selected };
        throw new Error('INVALID_MODEL_OUTPUT: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
  }, attempt => {
    if (attempt.status === 'selected') selected = { provider: attempt.provider, model: attempt.model };
    if (jobId) appendAgentJobJournal({ jobId, kind: 'decision', stage: options.task === 'structured_control' ? 'plan' : 'run',
      actionKey: 'coding-route-' + randomUUID(), payload: { decision: 'coding_model_route', ...attempt } });
  }).catch((error: unknown) => {
    if (error instanceof ModelRoutingError) {
      const last = error.attempts.at(-1);
      // Let generateStructured feed the actual rejected text and validation error into
      // its bounded retry. Transport failures and exhausted budgets remain terminal.
      if (last?.errorClass === 'invalid_output' && rejected && rejected.provider === last.provider && rejected.model === last.model) {
        return { ...rejected, providerId: last.providerId, routingReason: 'Rejected structured output for bounded format recovery',
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, attempts: error.attempts };
      }
      const details = error.attempts.filter(attempt => attempt.error).map(attempt => `${attempt.provider}: ${attempt.error}`).join('; ');
      if (details) error.message += ' ' + details;
    }
    throw error;
  });
  if (!allowed.includes(response.provider) || (response.provider !== 'powerrouter' && response.provider !== 'ollama')) throw new Error('CODING_PROVIDER_OUTSIDE_AUTHORITY');
  return { text: response.text, provider: response.provider, model: response.model, durationMs: Date.now() - started,
    costUsd: response.usage.costUsd, ...(response.finishReason ? { stopReason: response.finishReason } : {}) };
}

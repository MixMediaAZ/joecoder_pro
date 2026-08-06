import { runDurableAgentRuntime } from './agentRuntime.js';
import { createHttpAgentDriver, type AgentJobCredentials } from './agentJobDriver.js';

export type { AgentJobCredentials } from './agentJobDriver.js';

/**
 * Server-owned autonomous job entrypoint. The durable runtime selects one
 * permitted action at a time and checkpoints every committed result. The HTTP
 * driver re-enters the process-authenticated internal lifecycle API, so authorization, idempotency, path jails,
 * snapshots, budgets, verification, rollback, and evidence remain mandatory.
 */
export async function runAgentJob(jobId: string, credentials: AgentJobCredentials): Promise<void> {
  await runDurableAgentRuntime(jobId, createHttpAgentDriver(credentials));
}
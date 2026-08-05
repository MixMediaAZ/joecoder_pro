import type { z } from 'zod';

export type ToolAuthorityMode = 'read_only' | 'mutating';
export type ToolCostClass = 'local_free' | 'local_process' | 'network_loopback';
export type ToolReversibility = 'not_applicable' | 'snapshot' | 'process_stop' | 'idempotent';

export interface GovernedToolAuthority {
  mode: ToolAuthorityMode;
  exactPaths: string[];
  operations: string[];
  maxFiles: number;
  maxChangedLines?: number;
  maxDurationMs: number;
  maxOutputBytes: number;
  allowDelete?: boolean;
}

export interface GovernedEvidenceRecorder {
  (content: unknown): Promise<{ id: string }>;
}

export interface GovernedToolContext {
  projectId: string;
  jobId: string;
  workOrderId: string | null;
  projectRoot: string;
  snapshotsRoot: string;
  artifactsRoot: string;
  authority: GovernedToolAuthority;
  recordEvidence: GovernedEvidenceRecorder;
}

export interface GovernedToolMetadata {
  name: string;
  title: string;
  authority: ToolAuthorityMode;
  operation: string | null;
  readsPaths: boolean;
  writesPaths: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  costClass: ToolCostClass;
  reversibility: ToolReversibility;
  evidenceProducer: string;
  idempotent: boolean;
}

export interface GovernedToolDefinition<I, O> {
  metadata: GovernedToolMetadata;
  schema: z.ZodType<I>;
  execute(input: I, context: GovernedToolContext): Promise<O>;
  summarize(output: O): unknown;
}

export interface GovernedToolRequest {
  name: string;
  input: unknown;
}

export interface GovernedToolSuccess {
  ok: true;
  tool: string;
  durationMs: number;
  evidenceId: string;
  outputHash: string;
  summary: unknown;
}

export interface GovernedToolFailure {
  ok: false;
  tool: string;
  durationMs: number;
  evidenceId: string | null;
  outputHash: string;
  code: string;
  error: string;
}

export type GovernedToolResult = GovernedToolSuccess | GovernedToolFailure;

export class GovernedToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'GovernedToolError';
  }
}


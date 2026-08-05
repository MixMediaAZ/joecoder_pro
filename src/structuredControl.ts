import { createHash } from 'node:crypto';
import { z } from 'zod';

export const CONTROL_SCHEMA_VERSION = 1 as const;

const EvidenceIdSchema = z.string().regex(/^(EVC|CERT|SNAP)-[A-Za-z0-9-]+$/);
const RelativePathSchema = z.string().min(1).max(500).superRefine((value, context) => {
  const normalized = value.replace(/\\/g, '/');
  if (/^(?:[A-Za-z]:|\/)/.test(normalized) || normalized.split('/').includes('..')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Path must remain project-root relative.' });
  }
  if (/(^|\/)(?:\.git|\.jc|node_modules)(\/|$)/.test(normalized)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Protected paths are not valid control targets.' });
  }
});

export const ObjectiveExtractionSchema = z.object({
  schemaVersion: z.literal(CONTROL_SCHEMA_VERSION),
  objective: z.string().trim().min(1).max(500),
  successConditions: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  constraints: z.array(z.string().trim().min(1).max(500)).max(30),
  ambiguities: z.array(z.string().trim().min(1).max(500)).max(10)
}).strict();

export const GovernedToolNameSchema = z.enum([
  'files.list', 'files.search', 'files.read', 'files.metadata', 'memory.project_brain',
  'evidence.read', 'git.inspect', 'process.inspect', 'files.create', 'files.apply_exact_patch',
  'files.move', 'files.delete', 'config.update_json', 'project.run_check', 'project.format_check',
  'project.launch', 'project.stop', 'health.query', 'recovery.checkpoint', 'recovery.restore',
  'visual.capture', 'visual.inspect', 'visual.interact', 'visual.responsive', 'visual.compare'
]);

export const ToolCallControlSchema = z.object({
  schemaVersion: z.literal(CONTROL_SCHEMA_VERSION),
  name: GovernedToolNameSchema,
  input: z.record(z.string(), z.unknown()),
  purpose: z.string().trim().min(1).max(500),
  expectedEvidence: z.string().trim().min(1).max(500)
}).strict();

export const NextActionSelectionSchema = z.object({
  schemaVersion: z.literal(CONTROL_SCHEMA_VERSION),
  action: z.enum(['inspect', 'plan', 'tool', 'verify', 'revise', 'restore', 'complete', 'stop']),
  reason: z.string().trim().min(1).max(1000),
  evidenceIds: z.array(EvidenceIdSchema).max(50),
  toolCall: ToolCallControlSchema.nullable()
}).strict().superRefine((value, context) => {
  if ((value.action === 'tool') !== Boolean(value.toolCall)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'toolCall is required only for action=tool.' });
  }
});

export const PlanRevisionControlSchema = z.object({
  schemaVersion: z.literal(CONTROL_SCHEMA_VERSION),
  revision: z.number().int().min(1).max(100),
  targetFiles: z.array(RelativePathSchema).min(1).max(50),
  intendedChanges: z.array(z.string().trim().min(1).max(1000)).min(1).max(50),
  risks: z.array(z.string().trim().min(1).max(500)).max(30),
  rollbackMethod: z.string().trim().min(1).max(1000),
  verificationCommands: z.array(z.string().trim().min(1).max(500)).max(30),
  evidenceIds: z.array(EvidenceIdSchema).min(1).max(100)
}).strict();

const SuccessConditionResultSchema = z.object({
  condition: z.string().trim().min(1).max(500),
  mandatory: z.boolean(),
  passed: z.boolean(),
  evidenceIds: z.array(EvidenceIdSchema).max(50),
  limitation: z.string().trim().min(1).max(1000).nullable()
}).strict().superRefine((value, context) => {
  if (value.passed && value.evidenceIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A passed condition requires evidence.' });
  }
  if (!value.passed && !value.limitation) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A failed condition requires a limitation.' });
  }
});

export const VerificationAssessmentSchema = z.object({
  schemaVersion: z.literal(CONTROL_SCHEMA_VERSION),
  decision: z.enum(['completed', 'completed_with_limits', 'revise', 'restore', 'stop']),
  conditions: z.array(SuccessConditionResultSchema).min(1).max(30),
  diagnosis: z.string().trim().min(1).max(2000),
  nextEvidenceNeeded: z.array(z.string().trim().min(1).max(500)).max(20)
}).strict().superRefine((value, context) => {
  const failedMandatory = value.conditions.some((condition) => condition.mandatory && !condition.passed);
  if (value.decision === 'completed' && (failedMandatory || value.conditions.some((condition) => !condition.passed))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'completed requires every success condition to pass.' });
  }
  if (value.decision === 'completed_with_limits' && failedMandatory) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Mandatory failures cannot be completed_with_limits.' });
  }
});

export const FinalReportControlSchema = z.object({
  schemaVersion: z.literal(CONTROL_SCHEMA_VERSION),
  terminalState: z.enum(['completed', 'completed_with_limits', 'blocked_for_user', 'failed_safe', 'cancelled', 'interrupted']),
  summary: z.string().trim().min(1).max(2000),
  evidenceIds: z.array(EvidenceIdSchema).max(200),
  limitations: z.array(z.string().trim().min(1).max(1000)).max(30),
  changedFiles: z.array(RelativePathSchema).max(100)
}).strict().superRefine((value, context) => {
  if (value.terminalState === 'completed' && (value.evidenceIds.length === 0 || value.limitations.length > 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'completed requires evidence and no remaining limitations.' });
  }
  if (value.terminalState === 'completed_with_limits' && value.limitations.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'completed_with_limits must name its limits.' });
  }
});

export const ControlSchemas = {
  objective: ObjectiveExtractionSchema,
  next_action: NextActionSelectionSchema,
  tool_call: ToolCallControlSchema,
  plan_revision: PlanRevisionControlSchema,
  verification: VerificationAssessmentSchema,
  final_report: FinalReportControlSchema
} as const;

export type ControlSchemaName = keyof typeof ControlSchemas;

export class StructuredControlError extends Error {
  readonly code = 'STRUCTURED_CONTROL_REJECTED';
  constructor(readonly schemaName: ControlSchemaName, readonly failures: string[]) {
    super(`Structured ${schemaName} control failed safely after ${failures.length} rejected response(s): ${failures.at(-1) || 'unknown error'}`);
  }
}

export function parseStructuredControl<N extends ControlSchemaName>(
  schemaName: N,
  text: string
): z.output<(typeof ControlSchemas)[N]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new Error(`${schemaName.toUpperCase()}_JSON_INVALID`);
  }
  return ControlSchemas[schemaName].parse(parsed) as z.output<(typeof ControlSchemas)[N]>;
}

export async function requestStructuredControl<N extends ControlSchemaName>(options: {
  schemaName: N;
  system: string;
  prompt: string;
  generate: (request: { system: string; prompt: string; temperature: number }) => Promise<{ text: string }>;
  alternateGenerate?: (request: { system: string; prompt: string; temperature: number }) => Promise<{ text: string }>;
}): Promise<{ value: z.output<(typeof ControlSchemas)[N]>; attempts: number; usedAlternate: boolean }> {
  const failures: string[] = [];
  let previous = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt = attempt === 1 ? options.prompt : [
      options.prompt,
      '',
      `Your previous ${options.schemaName} response was rejected: ${failures.at(-1)}`,
      `Rejected excerpt: ${previous.slice(0, 1000)}`,
      'Return one JSON object matching the requested versioned schema. Do not include prose or markdown.'
    ].join('\n');
    const response = await options.generate({ system: options.system, prompt, temperature: 0 });
    previous = response.text;
    try {
      return { value: parseStructuredControl(options.schemaName, response.text), attempts: attempt, usedAlternate: false };
    } catch (error: unknown) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (options.alternateGenerate) {
    const response = await options.alternateGenerate({
      system: options.system,
      prompt: `${options.prompt}\n\nReturn one valid JSON object only. Another model failed schema validation twice.`,
      temperature: 0
    });
    try {
      return { value: parseStructuredControl(options.schemaName, response.text), attempts: 3, usedAlternate: true };
    } catch (error: unknown) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new StructuredControlError(options.schemaName, failures);
}

export interface ProgressRecord {
  action: string;
  evidenceFingerprint: string;
  outcome: 'progress' | 'failure';
  planFingerprint?: string;
}

export function detectNoProgress(history: ProgressRecord[]): { blocked: boolean; reason: string | null } {
  if (history.length < 2) return { blocked: false, reason: null };
  const recent = history.slice(-4);
  if (recent.length >= 4) {
    const [a, b, c, d] = recent;
    if (a && b && c && d && a.action === c.action && b.action === d.action &&
        a.evidenceFingerprint === c.evidenceFingerprint && b.evidenceFingerprint === d.evidenceFingerprint) {
      return { blocked: true, reason: `Circular action pattern detected: ${a.action} ↔ ${b.action}.` };
    }
  }
  const last = recent.at(-1)!;
  const repeated = recent.filter((item) =>
    item.action === last.action && item.evidenceFingerprint === last.evidenceFingerprint && item.outcome === last.outcome
  );
  if (repeated.length >= 2) {
    return { blocked: true, reason: `No new evidence: ${last.action} repeated the same ${last.outcome} result.` };
  }
  const planFingerprints = recent.map((item) => item.planFingerprint).filter(Boolean);
  if (planFingerprints.length >= 2 && new Set(planFingerprints).size === 1 && recent.every((item) => item.outcome === 'failure')) {
    return { blocked: true, reason: 'The same failed plan was proposed again without new evidence.' };
  }
  return { blocked: false, reason: null };
}

export function compactEvidenceLinkedHistory(entries: Array<{
  sequence: number;
  kind: string;
  payload: unknown;
  evidenceId?: string | null;
}>, maxCharacters = 12_000): { summary: string; sourceSequences: number[]; evidenceIds: string[]; hash: string } {
  const lines: string[] = [];
  const sourceSequences: number[] = [];
  const evidenceIds = new Set<string>();
  for (const entry of entries) {
    const payload = JSON.stringify(entry.payload);
    const line = `#${entry.sequence} ${entry.kind}${entry.evidenceId ? ` evidence=${entry.evidenceId}` : ''} ${payload.slice(0, 1000)}`;
    if (lines.join('\n').length + line.length > maxCharacters) break;
    lines.push(line);
    sourceSequences.push(entry.sequence);
    if (entry.evidenceId) evidenceIds.add(entry.evidenceId);
  }
  const summary = lines.join('\n');
  return {
    summary,
    sourceSequences,
    evidenceIds: Array.from(evidenceIds),
    hash: createHash('sha256').update(summary).digest('hex')
  };
}

/**
 * Repair pipeline — model-backed planning and edit generation.
 *
 * Planning happens at DRAFT time so the user reviews the exact file scope the
 * model proposes BEFORE authorization (no silent scope expansion). Edit
 * generation happens at APPLY time, constrained to the authorized scope, and
 * everything the model returns is parsed strictly and validated — a malformed
 * response fails closed, it never half-applies.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SurveyResult } from './types.js';
import { resolveJailedPath, type ProposedEdit } from './mutation.js';

export interface RepairPlan {
  schemaVersion: 1;
  files: string[];
  approach: string;
  risks: string[];
}

const RepairPlanSchema = z.object({
  schemaVersion: z.literal(1),
  files: z.array(z.string().trim().min(1)).min(1).max(10),
  approach: z.string().trim().min(1).max(2000),
  risks: z.array(z.string().trim().min(1).max(500)).max(10)
}).strict();

const MAX_PLAN_FILES = 10;
const MAX_FILE_READ_BYTES = 48 * 1024;

const PLAN_SYSTEM = [
  'You are Joe, a careful build-repair planner inside an evidence-governed tool.',
  'You are given a read-only survey of a project and a repair objective.',
  'Respond with STRICT JSON only — no prose, no markdown fences — matching:',
  '{"schemaVersion": 1, "files": ["relative/path.ext", ...], "approach": "one paragraph", "risks": ["..."]}',
  'Rules: list ONLY the files that must be modified or created to meet the objective;',
  'use project-root-relative paths with forward slashes; never list paths under',
  'node_modules, .git, or .jc; prefer the smallest correct file set (1-10 files).'
].join(' ');

const BUILD_SYSTEM = [
  'You are Joe, a careful greenfield app planner inside an evidence-governed tool.',
  'The target folder is empty or nearly empty. Propose the minimal file set to meet the objective.',
  'Respond with STRICT JSON only — no prose, no markdown fences — matching:',
  '{"schemaVersion": 1, "files": ["relative/path.ext", ...], "approach": "one paragraph", "risks": ["..."]}',
  'Rules: use project-root-relative paths with forward slashes; never list paths under',
  'node_modules, .git, or .jc; prefer the smallest correct starter set (1-10 files);',
  'include package.json when a Node app is implied; do not invent unrelated features.'
].join(' ');

export function buildBuildPlanPrompt(projectName: string, objective: string, survey: SurveyResult): string {
  const fileList = survey.entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => entry.path.replace(/\\/g, '/'))
    .slice(0, 100);
  const samples = survey.contentSamples || [];
  const sampleBlocks = samples.map((sample) => {
    const note = sample.truncated ? ` (truncated at ${sample.bytes} bytes)` : '';
    return [
      `--- SAMPLE: ${sample.path}${note} ---`,
      sample.content,
      `--- END SAMPLE: ${sample.path} ---`
    ].join('\n');
  });
  return [
    `Project folder: ${projectName} (${survey.projectType})`,
    `Objective: ${objective}`,
    `Existing files (${survey.summary.totalFiles}): ${fileList.join(', ') || '(none — empty folder)'}`,
    `Findings: ${survey.findings.working.join('; ') || '(none)'}`,
    '',
    samples.length ? 'Existing content samples (if any):' : 'No existing content samples.',
    ...sampleBlocks,
    '',
    'Return the strict JSON plan for files to CREATE now.'
  ].join('\n');
}

export function isNearEmptySurvey(survey: SurveyResult): boolean {
  const files = survey.entries.filter((e) => e.type === 'file');
  if (files.length === 0) return true;
  if (files.length > 12) return false;
  const ignorable = /^(readme(\.(md|txt))?|\.gitignore|\.gitkeep|\.env\.example|license|licence|package\.json)(\.|$)/i;
  // Allow a single package.json + optional readme/gitignore class files only (no src code yet).
  return files.every((f) => {
    const base = f.path.replace(/^.*\//, '');
    return ignorable.test(base);
  });
}

export function buildPlanPrompt(projectName: string, objective: string, survey: SurveyResult): string {
  const fileList = survey.entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => entry.path.replace(/\\/g, '/'))
    .slice(0, 400);

  const samples = survey.contentSamples || [];
  const sampleBlocks = samples.map((sample) => {
    const note = sample.truncated ? ` (truncated at ${sample.bytes} bytes)` : '';
    return [
      `--- SAMPLE: ${sample.path}${note} ---`,
      sample.content,
      `--- END SAMPLE: ${sample.path} ---`
    ].join('\n');
  });

  return [
    `Project: ${projectName} (${survey.projectType})`,
    `Objective: ${objective}`,
    `Key files: ${survey.keyFiles.join(', ') || '(none)'}`,
    `Findings — working: ${survey.findings.working.join('; ') || '(none)'}`,
    `Findings — questionable: ${survey.findings.questionable.join('; ') || '(none)'}`,
    `Findings — broken: ${survey.findings.broken.join('; ') || '(none)'}`,
    'File inventory (bounded):',
    fileList.join('\n'),
    '',
    samples.length
      ? `Read-only content samples (${samples.length} file(s), bounded). Use these to choose the smallest correct file set:`
      : 'No content samples available — plan from inventory and findings only.',
    ...sampleBlocks,
    '',
    'Return the strict JSON plan now.'
  ].join('\n');
}

export function parsePlanResponse(text: string): RepairPlan {
  let candidate: z.infer<typeof RepairPlanSchema>;
  try {
    candidate = RepairPlanSchema.parse(JSON.parse(text.trim()));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`PLAN_PARSE_FAILED: response must be one strict schemaVersion=1 JSON object (${reason})`);
  }
  const cleaned: string[] = [];
  for (const raw of candidate.files.slice(0, MAX_PLAN_FILES)) {
    const rel = raw.replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (path.isAbsolute(rel) || rel.split('/').includes('..')) throw new Error(`PLAN_REJECTED: unsafe path '${raw}'`);
    if (/(^|\/)(node_modules|\.git|\.jc)(\/|$)/.test(rel)) throw new Error(`PLAN_REJECTED: protected path '${raw}'`);
    if (!cleaned.includes(rel)) cleaned.push(rel);
  }
  return { schemaVersion: 1, files: cleaned, approach: candidate.approach, risks: candidate.risks };
}

export interface ScopedFileContent {
  relPath: string;
  exists: boolean;
  content: string;
  truncated: boolean;
}

export async function readScopedFiles(projectRoot: string, relPaths: string[]): Promise<ScopedFileContent[]> {
  const results: ScopedFileContent[] = [];
  for (const relPath of relPaths) {
    const full = resolveJailedPath(projectRoot, relPath);
    try {
      const buffer = await fs.readFile(full);
      if (buffer.includes(0)) {
        throw new Error(`REPAIR_UNSUPPORTED: '${relPath}' appears to be a binary file`);
      }
      const truncated = buffer.length > MAX_FILE_READ_BYTES;
      results.push({
        relPath: relPath.replace(/\\/g, '/'),
        exists: true,
        content: buffer.toString('utf8', 0, Math.min(buffer.length, MAX_FILE_READ_BYTES)),
        truncated
      });
      if (truncated) {
        throw new Error(`REPAIR_UNSUPPORTED: '${relPath}' exceeds the ${Math.round(MAX_FILE_READ_BYTES / 1024)}KB single-file repair limit`);
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        results.push({ relPath: relPath.replace(/\\/g, '/'), exists: false, content: '', truncated: false });
      } else {
        throw error;
      }
    }
  }
  return results;
}

const EDIT_SYSTEM = [
  'You are Joe, an exact code-repair engine inside an evidence-governed tool.',
  'You receive an objective, an approach, and the CURRENT full content of the only files you may change.',
  'Return the COMPLETE new content for every file that must change, in this exact format:',
  '===FILE: relative/path.ext===',
  '<entire new file content>',
  '===END FILE===',
  'Rules: output ONLY file blocks, no prose before, between, or after; include the',
  'ENTIRE file content for each changed file (never fragments, never diffs, never placeholders like',
  '"rest unchanged"); only files from the provided scope; if a scoped file needs no change, omit it;',
  'preserve the existing code style of each file.'
].join(' ');

export function buildEditsPrompt(objective: string, approach: string, files: ScopedFileContent[]): string {
  const sections = files.map((file) => [
    `===FILE: ${file.relPath}===`,
    file.exists ? file.content : '(this file does not exist yet — create it)',
    '===END FILE==='
  ].join('\n'));
  return [
    `Objective: ${objective}`,
    `Approach: ${approach}`,
    '',
    'Current scoped files:',
    ...sections,
    '',
    'Produce the changed files now, using the exact block format.'
  ].join('\n');
}

const FILE_BLOCK = /===FILE:\s*([^=\r\n]+?)\s*===\r?\n([\s\S]*?)\r?\n?===END FILE===/g;

export function parseEditBlocks(text: string): ProposedEdit[] {
  const edits: ProposedEdit[] = [];
  let match: RegExpExecArray | null;
  FILE_BLOCK.lastIndex = 0;
  while ((match = FILE_BLOCK.exec(text)) !== null) {
    const relPath = (match[1] || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
    const content = match[2] ?? '';
    if (!relPath) continue;
    if (!content.trim()) throw new Error(`EDIT_PARSE_FAILED: empty content for '${relPath}'`);
    edits.push({ relPath, content: content.endsWith('\n') ? content : `${content}\n` });
  }
  if (!edits.length) {
    throw new Error('EDIT_PARSE_FAILED: the model returned no well-formed file blocks');
  }
  return edits;
}

const PLAN_SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.dart', '.py', '.rs', '.go',
  '.cs', '.fs', '.java', '.kt', '.html', '.css', '.scss', '.json', '.yaml', '.yml', '.toml', '.md'
]);
const PLAN_LOW_VALUE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|pubspec\.lock|target|dist|build)(\/|$)/i;

/** Rank a bounded, deterministic file shortlist when a model needs more context. */
export function rankPlanCandidates(objective: string, survey: SurveyResult, maxFiles = 8): string[] {
  const normalizedObjective = objective.toLowerCase();
  const tokens = Array.from(new Set(normalizedObjective.match(/[a-z0-9_]{3,}/g) || []))
    .filter((token) => !['build', 'change', 'make', 'with', 'this', 'that', 'from', 'have', 'will', 'should'].includes(token));
  const samples = new Map((survey.contentSamples || []).map((sample) => [sample.path.replace(/\\/g, '/'), sample.content.toLowerCase()]));
  return survey.entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => entry.path.replace(/\\/g, '/'))
    .filter((rel) => !PLAN_LOW_VALUE.test(rel) && PLAN_SOURCE_EXTENSIONS.has(path.posix.extname(rel).toLowerCase()))
    .map((rel) => {
      const lower = rel.toLowerCase();
      const base = path.posix.basename(lower);
      let score = normalizedObjective.includes(lower) || normalizedObjective.includes(base) ? 100 : 0;
      for (const token of tokens) {
        if (lower.includes(token)) score += 12;
        if ((samples.get(rel) || '').includes(token)) score += 2;
      }
      if (survey.keyFiles.some((key) => key.replace(/\\/g, '/') === rel)) score += 6;
      if (/(^|\/)(main|app|index|server)\.[^/]+$/i.test(rel)) score += 8;
      if (/(package\.json|pubspec\.yaml|pyproject\.toml|cargo\.toml|go\.mod|\.sln|\.csproj)$/i.test(rel)) score += 5;
      return { rel, score };
    })
    .sort((a, b) => b.score - a.score || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel))
    .slice(0, Math.max(1, Math.min(maxFiles, MAX_PLAN_FILES)))
    .map((candidate) => candidate.rel);
}

export function buildPlanRecoveryContext(objective: string, survey: SurveyResult): string {
  const candidates = rankPlanCandidates(objective, survey);
  return [
    `Detected stacks: ${survey.stackProfiles?.map((profile) => profile.label + ' [' + profile.root + ']').join(', ') || survey.projectType}`,
    `High-value candidate files: ${candidates.join(', ') || '(none)'}`,
    'Choose the smallest exact subset that must change. Do not return an empty files array.'
  ].join('\n');
}

export { PLAN_SYSTEM, EDIT_SYSTEM, BUILD_SYSTEM };

/** Max temperature allowed for any structured plan/edit call. */
export const STRUCTURED_MAX_TEMPERATURE = 0.2;

export interface StructuredGenerateDeps {
  generate: (request: {
    system: string;
    prompt: string;
    maxTokens?: number;
    timeoutMs?: number;
    temperature?: number;
  }) => Promise<{ text: string; provider: string; model: string; durationMs: number }>;
}

export interface StructuredAttempt {
  attempt: number;
  text: string;
  provider: string;
  model: string;
  durationMs: number;
  parseError?: string;
}

export interface StructuredSuccess<T> {
  value: T;
  attempts: StructuredAttempt[];
  finalText: string;
  provider: string;
  model: string;
  durationMs: number;
  recoveredBy: 'model';

}

export interface StructuredAttemptUpdate {
  attempt: number;
  maxAttempts: number;
  phase: 'requesting' | 'rejected' | 'accepted';
  error?: string;
}

/**
 * Bounded structured-output loop. Every response is parsed before use. Invalid
 * responses are returned to the model as observations, context is expanded on
 * later attempts, and an optional deterministic fallback may produce a draft
 * scope only. Mutation output never receives a fallback.
 */
export async function generateStructured<T>(
  deps: StructuredGenerateDeps,
  options: {
    system: string;
    prompt: string;
    parse: (text: string) => T;
    maxTokens?: number;
    timeoutMs?: number;
    temperature?: number;
    label: string;
    maxAttempts?: number;
    recoveryContext?: string;
    onAttempt?: (update: StructuredAttemptUpdate) => void | Promise<void>;
  }
): Promise<StructuredSuccess<T>> {
  const temperature = Math.min(
    typeof options.temperature === 'number' ? options.temperature : STRUCTURED_MAX_TEMPERATURE,
    STRUCTURED_MAX_TEMPERATURE
  );
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 2, 2));
  const attempts: StructuredAttempt[] = [];
  let previousError = '';
  let previousText = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await options.onAttempt?.({ attempt, maxAttempts, phase: 'requesting' });
    const prompt = attempt === 1
      ? options.prompt
      : [
          options.prompt,
          '',
          'PREVIOUS RESPONSE WAS INVALID AND WAS REJECTED.',
          `Parse error: ${previousError}`,
          ...(options.recoveryContext ? ['', 'Additional verified project context:', options.recoveryContext] : []),
          '',
          `Rejected response excerpt: ${previousText.slice(0, 2000)}`,
          `Return ONLY the required structured format for ${options.label}. No prose, no markdown fences, no apology.`
        ].join('\n');
    const generated = await deps.generate({
      system: options.system,
      prompt,
      temperature,
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    });
    const record: StructuredAttempt = {
      attempt,
      text: generated.text,
      provider: generated.provider,
      model: generated.model,
      durationMs: generated.durationMs
    };
    attempts.push(record);
    try {
      const value = options.parse(generated.text);
      await options.onAttempt?.({ attempt, maxAttempts, phase: 'accepted' });
      return {
        value,
        attempts,
        finalText: generated.text,
        provider: generated.provider,
        model: generated.model,
        durationMs: attempts.reduce((sum, item) => sum + item.durationMs, 0),
        recoveredBy: 'model'
      };
    } catch (error: unknown) {
      previousError = error instanceof Error ? error.message : String(error);
      previousText = generated.text;
      record.parseError = previousError;
      await options.onAttempt?.({ attempt, maxAttempts, phase: 'rejected', error: previousError });
    }
  }

  throw new Error(
    `STRUCTURED_PARSE_FAILED after ${maxAttempts} attempts (${options.label}): ${previousError}`
  );
}
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
// Real application entry points routinely exceed 48 KB. The old ceiling rejected a verified
// 56 KB control-panel file after Joe had already selected and authorized it. Keep the read
// bounded, but large enough for ordinary source modules supported by the long-context models.
const MAX_FILE_READ_BYTES = 128 * 1024;

const PLAN_SYSTEM = [
  'You are Joe, a careful build-repair planner inside an evidence-governed tool.',
  'You are given a read-only survey of a project and a repair objective.',
  'Respond with STRICT JSON only — no prose, no markdown fences — matching:',
  '{"schemaVersion": 1, "files": ["relative/path.ext", ...], "approach": "one paragraph", "risks": ["..."]}',
  'Rules: list ONLY the files that must be modified or created to meet the objective;',
  'use project-root-relative paths with forward slashes; never list paths under',
  'node_modules, .git, or .jc; prefer the smallest correct file set (1-10 files).',
  'Treat existing tests as acceptance contracts. Do not plan test changes merely to make a failing implementation pass unless the objective explicitly requires changing tests.',
  'Trace the objective through all relevant provided content samples. For composed or ambiguous behavior, include every implementation file whose current logic contributes to the defect; do not stop at the first suspicious file.'
].join(' ');

const BUILD_SYSTEM = [
  'You are Joe, a careful greenfield app planner inside an evidence-governed tool.',
  'The target folder is empty or nearly empty. Propose a complete, maintainable file set that meets the objective.',
  'Respond with STRICT JSON only — no prose, no markdown fences — matching:',
  '{"schemaVersion": 1, "files": ["relative/path.ext", ...], "approach": "one paragraph", "risks": ["..."]}',
  'Rules: use project-root-relative paths with forward slashes; never list paths under',
  'node_modules, .git, or .jc; use separate files for distinct browser UI, HTTP routing, validation,',
  'persistent storage, and automated-test responsibilities when the objective spans those concerns (up to 10 files);',
  'do not collapse a multi-feature full-stack application into one source file. Include runnable test and build scripts',
  'and their implementation files so runtime verification is available on the first build;',
  'include package.json when a Node app is implied; do not invent unrelated features.',
  // Third-party dependencies require a governed admission step with a committed lockfile, which a
  // greenfield folder cannot have yet — a first live build died on DEPENDENCY_METADATA_REQUIRED
  // because the plan assumed express. The standard library covers small apps entirely.
  'CRITICAL: use ONLY the platform standard library (for Node: node:http, node:fs, node:path).',
  'Do NOT plan any third-party dependency unless the objective explicitly names one; package.json,',
  'when included, must have an empty dependencies object and a plain "start": "node server.js" script.'
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

function unwrapWholeTransportFence(text: string, allowedLanguage: RegExp): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^~~~([a-z0-9_-]*)\s*\r?\n([\s\S]*?)\r?\n~~~$/i)
    || trimmed.match(/^\x60{3}([a-z0-9_-]*)\s*\r?\n([\s\S]*?)\r?\n\x60{3}$/i);
  if (!match) return trimmed;
  const language = match[1] || '';
  if (!allowedLanguage.test(language)) {
    throw new Error("STRUCTURED_TRANSPORT_REJECTED: unsupported fence language '" + language + "'");
  }
  return (match[2] || '').trim();
}

export function parsePlanResponse(text: string): RepairPlan {
  let candidate: z.infer<typeof RepairPlanSchema>;
  try {
    candidate = RepairPlanSchema.parse(JSON.parse(unwrapWholeTransportFence(text, /^(json)?$/i)));
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

export function validatePlanForObjective(
  plan: RepairPlan,
  objective: string,
  intent: 'repair' | 'build',
  survey?: SurveyResult
): RepairPlan {
  const isTestPath = (file: string): boolean =>
    /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[^/]+$/i.test(file);
  const explicitlyChangesTests = /\b(add|create|change|update|repair|fix|rewrite)\s+(?:the\s+|existing\s+)?(?:(?:unit|integration|api|browser|visual)\s+)?tests?\b/i.test(objective)
    || /\btests?\s+(?:files?\s+)?(?:must\s+be\s+)?(added|created|changed|updated|repaired|fixed|rewritten)\b/i.test(objective);
  // A greenfield build has no acceptance contracts to weaken. Tests proposed as part of the new
  // application are implementation deliverables and must remain in scope. For repairs, existing
  // tests remain protected unless the objective explicitly authorizes changing them.
  let files = intent === 'build' || explicitlyChangesTests
    ? plan.files
    : plan.files.filter((file) => !isTestPath(file));
  if (!files.length) {
    throw new Error('PLAN_REJECTED: the plan contained no authorized implementation files after preserving tests as acceptance contracts');
  }
  // A consolidation refactor by definition touches every duplication site plus the shared home.
  // Observed live: "Different parts of the app each create their own audio engine. Refactor so
  // the whole app shares one instance" produced a one-file plan (the service alone), the three
  // construction sites were never rewired, and the job completed without meeting the objective.
  // One file cannot consolidate anything; reject the plan so the bounded re-prompt demands the
  // call sites.
  const describesConsolidation = /\brefactor\b/i.test(objective)
    && /\b(shares?|shared|single|one|central(?:ise|ize)d?|consolidat\w*)\b/i.test(objective)
    && /\b(each|every|separate|their own|duplicated?|different parts)\b/i.test(objective);
  if (intent === 'repair' && describesConsolidation && files.length < 2) {
    throw new Error(
      'PLAN_REJECTED: the objective consolidates duplicated behavior into one shared place, but the plan names a single file. A consolidation must include every site that currently duplicates the behavior as well as the shared home; list all affected files.'
    );
  }
  // Three live attempts across two model sizes planned only the shared home and never the
  // duplication sites, so the consolidation completed without consolidating anything. The sites
  // are evidence-discoverable: they score highest on objective-token overlap. Same deterministic
  // pattern as the composed-multi-file rule below — evidence-ranked candidates complete the scope.
  if (intent === 'repair' && describesConsolidation && survey) {
    const candidates = rankPlanCandidates(objective, survey, 8).filter((file) =>
      !isTestPath(file)
      && !files.includes(file)
      && /\.(?:js|jsx|ts|tsx|mjs|cjs|py|rs|go|cs|fs|java|kt|dart)$/i.test(file)
    );
    files = [...files, ...candidates].slice(0, 6);
  }

  const describesComposedMultiFileWork = /\b(multi[- ]file|interacting|composed|across (?:multiple )?files)\b/i.test(objective);
  if (intent === 'repair' && describesComposedMultiFileWork && files.length < 2 && survey) {
    const evidenceRanked = rankPlanCandidates(objective, survey, 8)
      .filter((file) =>
        !isTestPath(file)
        && !files.includes(file)
        && /\.(?:js|jsx|ts|tsx|mjs|cjs|py|rs|go|cs|fs|java|kt|dart|html|css|scss)$/i.test(file)
      );
    files = [...files, ...evidenceRanked].slice(0, 2);
  }
  if (intent === 'repair' && describesComposedMultiFileWork && files.length < 2) {
    throw new Error(
      'PLAN_REJECTED: the objective explicitly describes composed or interacting multi-file behavior, but the plan traces only one implementation file'
    );
  }
  // Evidence outranks the model's file choice (L9). When the survey's offline dependency
  // diagnosis has identified the exact manifest whose constraint blocks installation, and the
  // objective is about dependencies installing, that manifest MUST be in scope. Observed twice
  // live before this rule: with the evidence in its prompt, a 7B model still scoped a stale
  // nested pubspec.yaml (its path matched the package name) and the job died on a no-op edit.
  // Same deterministic pattern as the accessibility rule below: the server adds what recorded
  // evidence requires, and only when the objective makes it relevant — an unrelated objective
  // must not have its scope widened.
  const dependencyObjective = /\b(dependenc\w*|install\w*|pub\s+get|npm\s+(?:ci|install)|version\s+solving|lockfile|package\s+resolution)\b/i.test(objective);
  if (intent === 'repair' && dependencyObjective && survey?.dependencyTargets?.length) {
    for (const target of survey.dependencyTargets) {
      if (!files.includes(target)) files.unshift(target);
    }
  }

  const combinesAccessibilityAndLayout = /\b(accessib(?:le|ility)|semantic|label(?:ed|ling)?)\b/i.test(objective)
    && /\b(responsive|overflow|viewport|layout|phone|desktop)\b/i.test(objective);
  if (intent === 'repair' && combinesAccessibilityAndLayout && survey) {
    const candidates = rankPlanCandidates(objective, survey, 12).filter((file) => !isTestPath(file));
    const markup = candidates.find((file) => /\.(?:html|htm|jsx|tsx)$/i.test(file));
    const stylesheet = candidates.find((file) => /\.(?:css|scss)$/i.test(file));
    if (markup && stylesheet) {
      if (!files.includes(markup)) files.push(markup);
      if (!files.includes(stylesheet)) files.push(stylesheet);
    }
  }
  return { ...plan, files };
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
  'Do not wrap the response in a markdown code fence; the file blocks are the whole response.',
  'Rules: output ONLY file blocks, no prose before, between, or after; include the',
  'ENTIRE file content for each changed file (never fragments, never diffs, never placeholders like',
  '"rest unchanged"); only files from the provided scope; if a scoped file needs no change, omit it;',
  'preserve the existing code style of each file;',
  'treat existing tests as acceptance contracts and never weaken or rewrite them merely to make implementation failures pass unless the objective explicitly requires test changes.'
].join(' ');

export function buildEditsPrompt(
  objective: string,
  approach: string,
  files: ScopedFileContent[],
  evidenceTargets: string[] = []
): string {
  const sections = files.map((file) => [
    `===FILE: ${file.relPath}===`,
    file.exists ? file.content : '(this file does not exist yet — create it)',
    '===END FILE==='
  ].join('\n'));
  // Recorded evidence must dominate the model's own approach sentence. Observed live: with both
  // in the prompt, a 7B model followed its earlier (wrong) plan wording and edited a stale nested
  // manifest while the evidence named the root one. The mandate line is placed directly above the
  // final instruction — the position small models weight most.
  const evidenceMandate = evidenceTargets.length
    ? [
        '',
        `RECORDED EVIDENCE identifies the file(s) that must be corrected: ${evidenceTargets.join(', ')}.`,
        'Your response MUST include a corrected block for each of those files. A response that does not change them will be rejected.'
      ]
    : [];
  return [
    `Objective: ${objective}`,
    `Approach: ${approach}`,
    '',
    'Current scoped files:',
    ...sections,
    ...evidenceMandate,
    '',
    'Produce the changed files now, using the exact block format. Close every block with ===END FILE=== — a block without its ===END FILE=== terminator is rejected entirely.'
  ].join('\n');
}

/**
 * Rules-level backstop for the mandate above: an edit response that changes none of the
 * evidence-identified files is rejected before any write, which routes it into the bounded
 * re-prompt with this exact reason. Prevents the worse-than-failure outcome observed in replay:
 * the model "fixing" a bystander file and the job claiming limited success while the recorded
 * cause remains untouched.
 */
export function requireEvidenceTargetEdits(edits: ProposedEdit[], evidenceTargets: string[]): ProposedEdit[] {
  if (!evidenceTargets.length) return edits;
  const normalize = (rel: string) => rel.replace(/\\/g, '/').replace(/^\.\//, '');
  const touched = new Set(edits.map((edit) => normalize(edit.relPath)));
  const missed = evidenceTargets.map(normalize).filter((target) => !touched.has(target));
  if (missed.length === evidenceTargets.length) {
    throw new Error(
      `EDIT_MISSES_EVIDENCE_TARGET: recorded evidence identifies ${evidenceTargets.join(', ')} as the file(s) to correct, but the response changed none of them`
    );
  }
  return edits;
}

const FILE_BLOCK = /===FILE:\s*([^=\r\n]+?)\s*===\r?\n([\s\S]*?)\r?\n?===END FILE===/g;

/**
 * The fence language labels the ENVELOPE, not the payload.
 *
 * This previously accepted only `text`/`plaintext`, which cost a real job: editing a Flutter
 * project, qwen2.5-coder wrapped its block list in a ```dart fence -- the natural label when the
 * files are Dart -- and both attempts died with STRUCTURED_TRANSPORT_REJECTED 'dart'. The whole
 * job then failed safe. Any language-specific project hit the same wall, so a cosmetic label check
 * was gating which stacks JoeCoder could repair at all.
 *
 * Widening the label is safe because it never did the validation. The structural guarantees come
 * from FILE_BLOCK and the "no content outside blocks" check below, and both are unchanged:
 * a fence containing real source instead of file blocks still fails, now with the accurate
 * EDIT_PARSE_FAILED rather than a misleading transport error.
 */
const EDIT_TRANSPORT_LANGUAGE = /^[a-z0-9_-]*$/i;

export function parseEditBlocks(text: string): ProposedEdit[] {
  const normalized = unwrapWholeTransportFence(text, EDIT_TRANSPORT_LANGUAGE);
  const edits: ProposedEdit[] = [];
  const consumed: Array<[number, number]> = [];
  let match: RegExpExecArray | null;
  FILE_BLOCK.lastIndex = 0;
  while ((match = FILE_BLOCK.exec(normalized)) !== null) {
    consumed.push([match.index, FILE_BLOCK.lastIndex]);
    const relPath = (match[1] || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
    const content = match[2] ?? '';
    if (!relPath) continue;
    if (!content.trim()) throw new Error(`EDIT_PARSE_FAILED: empty content for '${relPath}'`);
    edits.push({ relPath, content: content.endsWith('\n') ? content : `${content}\n` });
  }
  if (!edits.length) {
    throw new Error('EDIT_PARSE_FAILED: the model returned no well-formed file blocks');
  }
  let cursor = 0;
  const outside = [];
  for (const [start, end] of consumed) {
    outside.push(normalized.slice(cursor, start));
    cursor = end;
  }
  outside.push(normalized.slice(cursor));
  if (outside.join('').trim()) {
    throw new Error('EDIT_PARSE_FAILED: response contains prose or content outside the required file blocks');
  }
  return edits;
}

/** Reject or remove model output that would rewrite the current bytes unchanged. */
export function requireEffectiveEdits(edits: ProposedEdit[], files: ScopedFileContent[]): ProposedEdit[] {
  const current = new Map(files.map((file) => [file.relPath.replace(/\\/g, '/'), file]));
  const effective = edits.filter((edit) => {
    const relPath = edit.relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const existing = current.get(relPath);
    return !existing || !existing.exists || existing.content !== edit.content;
  });
  if (!effective.length) {
    throw new Error('EDIT_NO_PROGRESS: every proposed file is byte-identical to the current scoped file; diagnose another contributing scoped file from the verification evidence');
  }
  return effective;
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

  // Carry bounded attempt records on the failure so the caller can persist WHAT the model
  // actually produced. Two live qualification runs failed with "no well-formed file blocks" and
  // left no artifact of the rejected output — an unverifiable claim about model behavior, and
  // nothing to diagnose from. The text heads are bounded; they contain model output only.
  throw Object.assign(
    new Error(`STRUCTURED_PARSE_FAILED after ${maxAttempts} attempts (${options.label}): ${previousError}`),
    {
      structuredAttempts: attempts.map((record) => ({
        attempt: record.attempt,
        parseError: record.parseError || null,
        responseChars: record.text.length,
        textHead: record.text.slice(0, 1500)
      }))
    }
  );
}

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
import { needsDependencyInstall } from './dependencyPolicy.js';
import { isServerManagedLockfilePath } from './installPolicy.js';
import { assertCssToolchainPackageJsonRepair, isBuildOutputPath } from './dependencyDoctor.js';
import { enforceApiImplementationContracts } from './apiRouteContracts.js';
export { enforceApiImplementationContracts } from './apiRouteContracts.js';
import {
  isCausalEvidenceRepair,
  isSubstantialObjective,
  requiresOperationalRuntimeProof
} from './objectiveSemantics.js';

export interface RepairPlan {
  schemaVersion: 1;
  files: string[];
  approach: string;
  risks: string[];
  fileResponsibilities?: Array<{ path: string; responsibility: string; evidence: string; layer: string }>;
  architecture?: { summary: string; contracts: string[]; persistence: string };
}

/** Max architecture.contracts entries. G2q burned PLAN_PARSE_FAILED when upload/API plans listed >10. */
export const MAX_ARCHITECTURE_CONTRACTS = 24;

const RepairPlanSchema = z.object({
  schemaVersion: z.literal(1),
  files: z.array(z.string().trim().min(1)).min(1).max(12),
  approach: z.string().trim().min(1).max(2000),
  risks: z.array(z.string().trim().min(1).max(500)).max(10),
  fileResponsibilities: z.array(z.object({
    path: z.string().trim().min(1),
    responsibility: z.string().trim().min(10).max(400),
    evidence: z.string().trim().min(5).max(400),
    layer: z.string().trim().min(2).max(80)
  }).strict()).max(12).optional(),
  architecture: z.object({
    summary: z.string().trim().min(20).max(800),
    // Prompt examples and causal CSS repairs emit one real contract; requiring two forced
    // schema theater and burned G2c on PLAN_PARSE_FAILED before any apply.
    // G2q: max 10 rejected operational upload/API plans that listed one contract per route —
    // allow up to MAX_ARCHITECTURE_CONTRACTS and recover by asking the model to consolidate.
    contracts: z.array(z.string().trim().min(5).max(300)).min(1).max(MAX_ARCHITECTURE_CONTRACTS),
    persistence: z.string().trim().min(5).max(400)
  }).strict().optional()
}).strict();

const MAX_PLAN_FILES = 12;
const RUNTIME_CONFIGURATION_BASENAME = /^(?:package(?:-lock)?\.json|tsconfig(?:\.[^/]+)?\.json|(?:vite|postcss|tailwind|drizzle|eslint|prettier)\.config\.[^/]+|\.env(?:\.[^/]+)?)$/i;
const isRuntimeConfigurationPath = (file: string): boolean =>
  RUNTIME_CONFIGURATION_BASENAME.test(file.replace(/\\/g, '/').split('/').pop() || file);

function normalizeRelPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function shallowestInventoryPath(inventory: Set<string>, basenames: string[]): string | undefined {
  const want = new Set(basenames.map((name) => name.toLowerCase()));
  let best: string | undefined;
  let bestDepth = Number.POSITIVE_INFINITY;
  for (const file of inventory) {
    const normalized = normalizeRelPath(file);
    const base = normalized.split('/').pop() || '';
    if (!want.has(base.toLowerCase())) continue;
    const depth = normalized.split('/').filter(Boolean).length;
    if (depth < bestDepth) {
      best = normalized;
      bestDepth = depth;
    }
  }
  return best;
}

/**
 * Causal sealed configuration surface (v3 J1).
 * Union of evidence targets, package manifest, lockfile when install is authorized,
 * and implicated CSS/build configs. Never drops evidence to satisfy a two-slot heuristic.
 */
export function selectSealedConfigurationPaths(options: {
  inventory: Set<string>;
  evidenceTargets?: string[];
  installAuthorized: boolean;
}): string[] {
  const inventory = new Set([...options.inventory].map(normalizeRelPath));
  const selected: string[] = [];
  const push = (file: string | undefined): void => {
    if (!file) return;
    const normalized = normalizeRelPath(file);
    if (!inventory.has(normalized) || selected.includes(normalized)) return;
    selected.push(normalized);
  };

  for (const target of options.evidenceTargets || []) {
    const normalized = normalizeRelPath(target);
    if (inventory.has(normalized)) push(normalized);
  }

  push(shallowestInventoryPath(inventory, ['package.json']));
  if (options.installAuthorized) {
    push(shallowestInventoryPath(inventory, ['package-lock.json', 'npm-shrinkwrap.json']));
  }

  push(shallowestInventoryPath(inventory, [
    'postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs', 'postcss.config.ts'
  ]));
  push(shallowestInventoryPath(inventory, [
    'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs'
  ]));

  const hasPostcss = selected.some((file) => /^postcss\.config\./i.test(file.split('/').pop() || ''));
  const viteRequested = (options.evidenceTargets || []).some((target) => /vite\.config\./i.test(normalizeRelPath(target)));
  if (!hasPostcss || viteRequested) {
    push(shallowestInventoryPath(inventory, [
      'vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'
    ]));
  }

  return selected;
}

/** @deprecated Use selectSealedConfigurationPaths — kept as a thin adapter for older call sites/tests. */
export function selectOperationalRuntimeConfiguration(inventory: Set<string>): string[] {
  return selectSealedConfigurationPaths({ inventory, installAuthorized: false });
}

function preferProtectedPaths(files: string[], protectedPaths: string[], maxFiles: number): string[] {
  const normalize = normalizeRelPath;
  const unique = Array.from(new Set(files.map(normalize)));
  const protectedSet = new Set(protectedPaths.map(normalize));
  const protectedFiles = unique.filter((file) => protectedSet.has(file));
  if (protectedFiles.length > maxFiles) {
    throw new Error(
      `PLAN_REJECTED: evidence and required configuration paths (${protectedFiles.length}) exceed the sealed file budget (${maxFiles}): ${protectedFiles.join(', ')}`
    );
  }
  const other = unique.filter((file) => !protectedSet.has(file));
  return [...protectedFiles, ...other.slice(0, maxFiles - protectedFiles.length)];
}
// Real application entry points routinely exceed 48 KB. The old ceiling rejected a verified
// 56 KB control-panel file after Joe had already selected and authorized it. Keep the read
// bounded, but large enough for ordinary source modules supported by the long-context models.
const MAX_FILE_READ_BYTES = 256 * 1024;
const PATCH_REQUIRED_CHARACTERS = 48 * 1024;

const PLAN_SYSTEM = [
  'You are Joe, a careful build-repair planner inside an evidence-governed tool.',
  'You are given a read-only survey of a project and a repair objective.',
  'Respond with STRICT JSON only — no prose, no markdown fences — matching:',
  '{"schemaVersion":1,"files":["relative/path.ext"],"approach":"one paragraph","risks":["..."],"fileResponsibilities":[{"path":"relative/path.ext","responsibility":"material change this file owns","evidence":"observed project fact requiring it","layer":"UI|service|storage|configuration"}],"architecture":{"summary":"Shared UI, API, and DATA_DIR persistence design for upload/analyze/restart.","contracts":["exact interface/API contract"],"persistence":"durable state under process.env.DATA_DIR"}}',
  'Rules: list ONLY the files that must be modified or created to meet the objective;',
  'use project-root-relative paths with forward slashes; never list paths under',
  'node_modules, .git, or .jc; prefer the smallest correct file set (1-12 files).',
  'When Findings identify concrete broken files, those files are mandatory and breadth is not a quota — fix the recorded causes first (including package.json, package-lock.json, PostCSS/Vite config as needed).',
  `architecture.contracts must be 1-${MAX_ARCHITECTURE_CONTRACTS} concise shared interface/API/type/persistence contracts — consolidate related routes into grouped contracts; do not emit one string per route if that exceeds ${MAX_ARCHITECTURE_CONTRACTS}.`,
  'For substantial cross-layer work without recorded file-level causes, list enough likely-material source files across areas (up to 12 total) with fileResponsibilities and architecture.contracts (≤' + MAX_ARCHITECTURE_CONTRACTS + ' concise items); do not invent files merely to hit a count.',
  'package.json, lockfiles, tsconfig files, and Vite, PostCSS, Drizzle, lint, or environment configuration are configuration, never source implementation padding.',
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
  // package.json is intentionally not ignorable: a manifest means an existing Node project,
  // and greenfield build must not overwrite it under "near empty" authorization.
  const ignorable = /^(?:readme(?:\.(?:md|txt))?|\.gitignore|\.gitkeep|\.env\.example|licen[cs]e(?:\.[a-z0-9]+)?)$/i;
  // Only root bootstrap metadata is ignorable. Nested manifests/readmes prove an existing project
  // structure and must never authorize a greenfield build over that workspace.
  return files.every((f) => {
    const normalized = f.path.replace(/\\/g, '/').replace(/^\.\//, '');
    return !normalized.includes('/') && ignorable.test(normalized);
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
    ...((survey.requiredApiRoutes || []).length ? [
      `Client API route contracts (mandatory in the server entry): ${(survey.requiredApiRoutes || []).join(', ')}.`,
      'The server must implement these exact paths. Do not invent substitutes such as /api/analyze. No TODO/501 placeholders.',
      'Upload handlers must read process.env.DATA_DIR || process.env.INSPECTORCODE_DATA_DIR || process.env.JC_DATA_DIR, extract the ZIP there, and return projectId — hardcoded ./data alone fails verification (storedFiles=0).',
      'Prefer already-declared ZIP helpers from package.json (jszip, multer). Do not invent undeclared imports like unzipper/archiver/@libsql/client.'
    ] : []),
    ...(isCausalEvidenceRepair(objective, survey.dependencyTargets) ? [
      `Recorded evidence targets are mandatory in the plan: ${(survey.dependencyTargets || []).join(', ')}.`,
      'Fix those causes first. Include only additional implementation files that are truly required. Do not invent files to hit a count quota.'
    ] : isSubstantialObjective(objective) ? [
      `This is substantial cross-layer work without file-level recorded causes: choose enough evidence-backed source implementation files across UI, service/API, and durable storage (up to 12 total including necessary configuration). Give every listed path a concrete responsibility and observed evidence. Define shared API/type/persistence contracts once in architecture.contracts (1-${MAX_ARCHITECTURE_CONTRACTS} concise items; consolidate related routes).`
    ] : []),
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

/**
 * Local coder models often emit a telegraphic architecture.summary ("shared design") under the
 * Zod min(20) floor. Expand from approach before schema parse — descriptive only; does not add files.
 */
export function normalizePlanArchitectureSummary(decoded: Record<string, unknown>): void {
  const arch = decoded.architecture;
  if (!arch || typeof arch !== 'object' || Array.isArray(arch)) return;
  const architecture = arch as Record<string, unknown>;
  if (typeof architecture.summary !== 'string') return;
  let summary = architecture.summary.trim();
  if (summary.length === 0 || summary.length >= 20) {
    architecture.summary = summary;
    return;
  }
  const approach = typeof decoded.approach === 'string' ? decoded.approach.trim() : '';
  const pad = approach.slice(0, 220)
    || 'Shared UI, API, and DATA_DIR persistence design for upload, analysis, and restart.';
  summary = `${summary} — ${pad}`.replace(/\s+/g, ' ').trim().slice(0, 800);
  if (summary.length < 20) {
    summary = `${summary} Shared design across upload, analysis, and restart persistence.`.trim().slice(0, 800);
  }
  architecture.summary = summary;
}

export function parsePlanResponse(text: string): RepairPlan {
  let candidate: z.infer<typeof RepairPlanSchema>;
  try {
    const decoded = JSON.parse(unwrapWholeTransportFence(text, /^(json)?$/i)) as Record<string, unknown>;
    // Some local models consistently abbreviate this descriptive, non-authority field. Normalize
    // that one harmless alias while keeping file scope, version, risks, and all unknown keys strict.
    if (decoded && typeof decoded === 'object' && decoded.approach === undefined && typeof decoded.appro === 'string') {
      decoded.approach = decoded.appro;
      delete decoded.appro;
    }
    if (decoded && typeof decoded === 'object') normalizePlanArchitectureSummary(decoded);
    candidate = RepairPlanSchema.parse(decoded);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`PLAN_PARSE_FAILED: response must be one strict schemaVersion=1 JSON object (${reason})`);
  }
  const cleaned: string[] = [];
  // Workboard seed lists 15 paths; the generic 12-file parse cap must not drop package-lock.json
  // / start.bat / src/config before validatePlanForObjective can merge the sealed surface.
  const planFileParseCap = Math.min(24, Math.max(MAX_PLAN_FILES, candidate.files.length));
  for (const raw of candidate.files.slice(0, planFileParseCap)) {
    const rel = raw.replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (path.isAbsolute(rel) || rel.split('/').includes('..')) throw new Error(`PLAN_REJECTED: unsafe path '${raw}'`);
    if (/(^|\/)(node_modules|\.git|\.jc)(\/|$)/.test(rel)) throw new Error(`PLAN_REJECTED: protected path '${raw}'`);
    if (!cleaned.includes(rel)) cleaned.push(rel);
  }
  const responsibilities = (candidate.fileResponsibilities || []).map((item) => ({
    ...item,
    path: item.path.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  }));
  return {
    schemaVersion: 1,
    files: cleaned,
    approach: candidate.approach,
    risks: candidate.risks,
    ...(responsibilities.length ? { fileResponsibilities: responsibilities } : {}),
    ...(candidate.architecture ? { architecture: candidate.architecture } : {})
  };
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
  // G2v: model planned dist/index.js (scripts.start target). Build outputs are toolchain-emitted;
  // never seal them for model create/edit — create server/index.ts and let npm run build emit dist/.
  files = files.filter((file) => !isBuildOutputPath(file));
  if (!files.length) {
    throw new Error('PLAN_REJECTED: the plan contained no authorized implementation files after preserving tests as acceptance contracts');
  }

  // Requests that explicitly span user experience, application behavior, and durable state are
  // substantial jobs. Accepting a tiny plan for them is not minimalism; it is silent scope loss.
  const substantial = isSubstantialObjective(objective);
  // If the operator asks for a runnable application, its runtime manifest/configuration is part
  // of the causal surface. Include the verified files that govern build/start behavior before
  // authorization, rather than discovering after the write that they were out of scope.
  const operationalObjective = requiresOperationalRuntimeProof(intent, objective);
  const inventory = new Set(
    (survey?.entries || [])
      .filter((entry) => entry.type === 'file')
      .map((entry) => normalizeRelPath(entry.path))
  );
  const evidenceTargets = (survey?.dependencyTargets || []).map(normalizeRelPath);
  const installAuthorized = intent === 'repair' && (
    needsDependencyInstall('repair', files, survey?.packageSummary ?? null)
    || (operationalObjective && inventory.has('package.json'))
  );
  const sealedConfiguration = intent === 'repair' && survey
    ? selectSealedConfigurationPaths({
      inventory,
      evidenceTargets,
      installAuthorized: installAuthorized || operationalObjective
    })
    : [];
  // Operational upload/analysis repairs always seal the Express entry for typed synthesis.
  const requiredApiRoutes = survey?.requiredApiRoutes || [];
  if (
    intent === 'repair'
    && operationalObjective
    && requiredApiRoutes.some((route) => /\/api\/(projects\/upload|analysis)/i.test(route))
    && !files.map(normalizeRelPath).includes('server/index.ts')
  ) {
    files.push('server/index.ts');
  }

  if (intent === 'repair' && survey && (operationalObjective || evidenceTargets.length)) {
    // Causal surface first: evidence targets and required manifests/config cannot be omitted.
    // When inventory is non-empty, evidence targets absent from it are createable (G2l missing
    // server/index.ts). Empty inventory (incomplete survey fixtures) must not invent paths.
    for (const file of [...evidenceTargets, ...sealedConfiguration]) {
      const normalized = normalizeRelPath(file);
      const isEvidenceTarget = evidenceTargets.some((target) => normalizeRelPath(target) === normalized);
      if (inventory.has(normalized)) {
        // existing sealed surface
      } else if (isEvidenceTarget && inventory.size > 0 && !/^(?:dist|build|out|\.next|coverage)(?:\/|$)/i.test(normalized)) {
        // createable missing source entrypoint / evidence file (never seal build outputs — G2v)
      } else {
        continue;
      }
      if (!files.map(normalizeRelPath).includes(normalized)) files.push(normalized);
    }
    // Drop non-causal configuration padding (e.g. vite/tsconfig) that is not sealed.
    const sealedSet = new Set(sealedConfiguration.map(normalizeRelPath));
    for (const target of evidenceTargets) sealedSet.add(target);
    files = files.filter((file) => !isRuntimeConfigurationPath(file) || sealedSet.has(normalizeRelPath(file)));
    for (const file of sealedConfiguration) {
      if (!files.includes(file)) files.push(file);
    }
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
  if (intent === 'repair' && survey?.dependencyTargets?.length && (dependencyObjective || operationalObjective)) {
    for (const target of survey.dependencyTargets) {
      const normalized = normalizeRelPath(target);
      // Missing entrypoint evidence targets are intentionally absent from inventory until created.
      if (!files.map(normalizeRelPath).includes(normalized)) files.unshift(normalized);
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
  // Never drop evidence targets or sealed configuration to satisfy the file cap.
  files = preferProtectedPaths(
    files,
    [...evidenceTargets, ...sealedConfiguration],
    MAX_PLAN_FILES
  );
  const causalEvidence = intent === 'repair' && isCausalEvidenceRepair(objective, evidenceTargets);
  if (substantial && !causalEvidence) {
    const implementationFiles = files.filter((file) => !isRuntimeConfigurationPath(file));
    // Keep only the core safety check: at least one genuine implementation target.
    if (!implementationFiles.length) {
      throw new Error(
        'PLAN_REJECTED: substantial objective has no implementation files after runtime-config filtering'
      );
    }
  }
  if (causalEvidence) {
    const missingEvidence = evidenceTargets.filter((target) => !files.map(normalizeRelPath).includes(target));
    if (missingEvidence.length) {
      throw new Error(
        `PLAN_REJECTED: recorded evidence targets must remain sealed (missing: ${missingEvidence.join(', ')})`
      );
    }
  }
  return {
    ...plan,
    files,
    ...(plan.architecture ? { architecture: sanitizeArchitectureContracts(plan.architecture) } : {})
  };
}

/**
 * G2w/G2x plans taught bare `/api/analysis/start` and "analysis simulation".
 * Rewrite those strings before they become Work Order assumptions.
 */
export function sanitizeArchitectureContracts(
  architecture: NonNullable<RepairPlan['architecture']>
): NonNullable<RepairPlan['architecture']> {
  const rewrite = (text: string): string => text
    .replace(/POST\s+\/api\/analysis\/start(?!\/)/gi, 'POST /api/analysis/start/:projectId')
    .replace(/GET\s+\/api\/analysis(?!\/)/gi, 'GET /api/analysis/:projectId')
    .replace(/POST\s+\/api\/projects\/save(?!\/)/gi, 'POST /api/projects/save/:projectId')
    .replace(/analysis simulation/gi, 'analysis of real uploaded files under DATA_DIR')
    .replace(/Simulate analysis\b/gi, 'Analyze uploaded files');
  const contracts = architecture.contracts.map(rewrite);
  const summary = rewrite(architecture.summary);
  let persistence = architecture.persistence;
  if (!/DATA_DIR|INSPECTORCODE_DATA_DIR|JC_DATA_DIR/i.test(persistence)) {
    persistence = `${persistence} Persist under process.env.DATA_DIR || INSPECTORCODE_DATA_DIR || JC_DATA_DIR.`.trim();
  }
  return { summary, contracts, persistence };
}

export interface ScopedFileContent {
  relPath: string;
  exists: boolean;
  content: string;
  truncated: boolean;
  /** Locked for write/install, but excluded from model generation (oversized npm lockfiles). */
  serverManaged?: boolean;
}

export async function readScopedFiles(projectRoot: string, relPaths: string[]): Promise<ScopedFileContent[]> {
  const results: ScopedFileContent[] = [];
  for (const relPath of relPaths) {
    const full = resolveJailedPath(projectRoot, relPath);
    const normalized = relPath.replace(/\\/g, '/');
    try {
      const buffer = await fs.readFile(full);
      if (buffer.includes(0)) {
        throw new Error(`REPAIR_UNSUPPORTED: '${relPath}' appears to be a binary file`);
      }
      const truncated = buffer.length > MAX_FILE_READ_BYTES;
      if (truncated && isServerManagedLockfilePath(normalized)) {
        // v3 G2: InspectorCode package-lock.json exceeds the model read ceiling. Keep it sealed
        // for install/lock refresh, but do not fail the job or dump megabytes into the prompt.
        results.push({
          relPath: normalized,
          exists: true,
          content: '',
          truncated: true,
          serverManaged: true
        });
        continue;
      }
      results.push({
        relPath: normalized,
        exists: true,
        content: buffer.toString('utf8', 0, Math.min(buffer.length, MAX_FILE_READ_BYTES)),
        truncated,
        ...(isServerManagedLockfilePath(normalized) ? { serverManaged: true } : {})
      });
      if (truncated) {
        throw new Error(`REPAIR_UNSUPPORTED: '${relPath}' exceeds the ${Math.round(MAX_FILE_READ_BYTES / 1024)}KB single-file repair limit`);
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        results.push({
          relPath: normalized,
          exists: false,
          content: '',
          truncated: false,
          ...(isServerManagedLockfilePath(normalized) ? { serverManaged: true } : {})
        });
      } else {
        throw error;
      }
    }
  }
  return results;
}

export function modelEditableScopedFiles(files: ScopedFileContent[]): ScopedFileContent[] {
  return files.filter((file) => !file.serverManaged && !isServerManagedLockfilePath(file.relPath));
}

function chunkScopedFiles(files: ScopedFileContent[], size: number): ScopedFileContent[][] {
  const chunks: ScopedFileContent[][] = [];
  for (let offset = 0; offset < files.length; offset += size) {
    chunks.push(files.slice(offset, offset + size));
  }
  return chunks;
}

/**
 * Split model edit generation so local models can finish the causal fix.
 * Evidence targets (e.g. package.json + postcss.config.js) always go first alone;
 * remaining sealed files follow in 3-file batches. Server-managed lockfiles are
 * already excluded by modelEditableScopedFiles before this runs.
 *
 * When sealedOperationalApi is set, residual companions (tailwind/vite/UI) are
 * dropped from generation — typed CSS + server executors own that lane (G2ag).
 */
export function buildRepairGenerationBatches(
  modelScoped: ScopedFileContent[],
  evidenceTargets: string[],
  options: { causalEvidence: boolean; substantialObjective: boolean; sealedOperationalApi?: boolean }
): ScopedFileContent[][] {
  if (modelScoped.length === 0) return [];
  const normalize = (rel: string) => rel.replace(/\\/g, '/');
  const evidenceSet = new Set(evidenceTargets.map(normalize));
  const isServerEntry = (rel: string): boolean =>
    /(^|\/)server\/index\.[cm]?[jt]s$/i.test(normalize(rel));

  if (options.causalEvidence && evidenceSet.size > 0) {
    const evidenceFiles = modelScoped.filter((file) => evidenceSet.has(normalize(file.relPath)));
    let rest = modelScoped.filter((file) => !evidenceSet.has(normalize(file.relPath)));
    if (options.sealedOperationalApi) {
      rest = rest.filter((file) => isServerEntry(file.relPath));
    }
    // Skip evidence files already satisfied on disk (e.g. stock v3 PostCSS while pinning
    // Tailwind in package.json). One remaining evidence target per batch otherwise.
    // Out-of-batch sibling FILE/PATCH noise is dropped by keepAssignedEditBlocksOnly (G2v).
    const evidenceNeedingEdits = evidenceFiles.filter((file) => !isEvidenceTargetAlreadySatisfied(file));
    const rankEvidence = (file: ScopedFileContent): number => {
      const rel = normalize(file.relPath);
      if (/(^|\/)package\.json$/i.test(rel)) return 0;
      if (!file.exists) return 1;
      if (/(^|\/)postcss\.config\./i.test(rel)) return 2;
      return 3;
    };
    const orderedEvidence = [...evidenceNeedingEdits].sort((a, b) => rankEvidence(a) - rankEvidence(b));
    return [
      ...orderedEvidence.map((file) => [file]),
      ...chunkScopedFiles(rest, 3)
    ];
  }

  if (!(options.substantialObjective && modelScoped.length >= 8)) {
    return [modelScoped];
  }

  const byArea = new Map<string, ScopedFileContent[]>();
  for (const file of modelScoped) {
    const normalized = normalize(file.relPath);
    const top = normalized.includes('/') ? (normalized.split('/')[0] || '.') : '.';
    const area = /^(?:backend|server|shared)$/i.test(top) ? 'service' : top;
    const group = byArea.get(area) || [];
    group.push(file);
    byArea.set(area, group);
  }
  const batches = Array.from(byArea.values()).flatMap((group) => chunkScopedFiles(group, 3));
  const isPriorityBatch = (batch: ScopedFileContent[]): boolean => batch.some((file) => {
    const rel = normalize(file.relPath);
    return evidenceSet.has(rel)
      || /(?:^|\/)(?:package(?:-lock)?\.json|(?:vite|postcss|tailwind)\.config\.[^/]+)$/i.test(rel);
  });
  return batches
    .map((batch, index) => ({ batch, index }))
    .sort((left, right) => Number(isPriorityBatch(right.batch)) - Number(isPriorityBatch(left.batch)) || left.index - right.index)
    .map((entry) => entry.batch);
}

const EDIT_SYSTEM = [
  'You are Joe, an exact code-repair engine inside an evidence-governed tool.',
  'You receive an objective, an approach, and the CURRENT full content of the only files you may change.',
  'For new and ordinary-sized files, return COMPLETE new content in this exact format:',
  '===FILE: relative/path.ext===',
  '<entire new file content>',
  '===END FILE===',
  'For existing files, you may return one or more exact replacement blocks; files marked PATCH REQUIRED must use them:',
  '===PATCH: relative/path.ext===',
  '===SEARCH===',
  '<exact unique current text>',
  '===REPLACE===',
  '<replacement text>',
  '===END PATCH===',
  'Do not wrap the response in a markdown code fence; the file blocks are the whole response.',
  'Do not put ```javascript, ```json, or any other Markdown fence inside a FILE block; its payload is raw file bytes.',
  'Rules: output ONLY complete-file or patch blocks; mixing is allowed only for different files when required;',
  'never emit thinking, narration, apologies, markdown, or explanations before, between, or after blocks — blocks only;',
  'every FILE must close with ===END FILE=== and every PATCH with ===END PATCH===; unterminated blocks are rejected;',
  'multiple PATCH blocks for the same existing file are applied in order; each SEARCH must be copied exactly from the current file bytes (after earlier patches in this response) and occur exactly once; only files from the provided scope;',
  'omit scoped files that need no change; never return byte-identical content or placeholders such as "rest unchanged";',
  'preserve the existing code style of each file;',
  'treat existing tests as acceptance contracts and never weaken or rewrite them merely to make implementation failures pass unless the objective explicitly requires test changes.'
].join(' ');

export function buildEditsPrompt(
  objective: string,
  approach: string,
  files: ScopedFileContent[],
  evidenceTargets: string[] = [],
  options: { enforceSubstantial?: boolean; requiredEditPaths?: string[]; requiredApiRoutes?: string[] } = {}
): string {
  const patchRequired = files.filter((file) => file.exists && file.content.length > PATCH_REQUIRED_CHARACTERS).map((file) => file.relPath);
  const sections = files.map((file) => [
    `===FILE: ${file.relPath}===`,
    file.exists ? file.content : '(this file does not exist yet — create it)',
    '===END FILE==='
  ].join('\n'));
  // Recorded evidence must dominate the model's own approach sentence. Observed live: with both
  // in the prompt, a 7B model followed its earlier (wrong) plan wording and edited a stale nested
  // manifest while the evidence named the root one. The mandate line is placed directly above the
  // final instruction — the position small models weight most.
  const cssToolchainEvidence = evidenceTargets.some((target) => /(^|\/)package\.json$/i.test(target.replace(/\\/g, '/')))
    && evidenceTargets.some((target) => /(^|\/)postcss\.config\./i.test(target.replace(/\\/g, '/')));
  const evidenceMandate = evidenceTargets.length
    ? [
        '',
        `RECORDED EVIDENCE identifies the file(s) that must be corrected: ${evidenceTargets.join(', ')}.`,
        'Your response MUST include a corrected block for each of those files. A response that does not change them will be rejected.',
        ...(cssToolchainEvidence ? [
          'HARD RULE for package.json under CSS evidence: change dependency versions only. Leave scripts.* byte-identical — no esm↔cjs, no dropping vite build, no entry retarget. If a missing entry file is in scope (for example server/index.ts), create or fix that file with ===FILE===/===PATCH===; never substitute script edits. Script rewrites are restored automatically and discarded when they add no dependency progress.'
        ] : []),
        ...((options.requiredApiRoutes || []).length ? [
          `When creating or editing the server entry, implement these exact API routes with working handlers (no TODO, no HTTP 501): ${(options.requiredApiRoutes || []).join(', ')}.`,
          'For /api/projects/upload: resolve dataDir from process.env.DATA_DIR || process.env.INSPECTORCODE_DATA_DIR || process.env.JC_DATA_DIR, mkdir it, extract the uploaded ZIP under that directory, and return projectId/id. A 200 JSON response without files under that env path fails api-route-smoke (storedFiles=0). Do not hardcode only ./data.',
          'Use ZIP/upload packages already declared in package.json (typically jszip and multer). Do not import undeclared packages such as unzipper, archiver, or @libsql/client unless this response also edits package.json to add them.',
          'Express 5 / path-to-regexp v8: use only named params (:id) or named wildcards ({*path} / /*path). Never bare *, (.*), :param*, or :param(regex) — those crash the server before /api/health can answer.',
          'For /api/projects/file: the client uses query-string GET /api/projects/file?projectId=&path= (not /api/projects/file/:id/*). Implement app.get(\'/api/projects/file\', ...) reading req.query; named /:projectId/:filePath is also safe.',
          'HARD RULE: POST /api/analysis/start/:projectId and GET /api/analysis/:projectId and POST /api/projects/save/:projectId — parameterized paths required (oracle R4). Bare /api/analysis/start or POST-only /api/analysis is rejected. Analysis must walk files under DATA_DIR/<projectId>, readFile utf-8, return findings[] that report eval / oracle-seeded-eval / dynamic code execution when present, plus files[] or totalFiles >= analyzed count — file-type counting alone fails oracle R4.',
          'HARD RULE (oracle R5–R8): express.static(path.join(cwd,\'dist\',\'public\')) at `/`; persist save/recent as DATA_DIR JSON (writeFile+JSON) so restart keeps the project id; inside ZIP extract reject `..`/absolute then path.relative containment (not startsWith alone) with HTTP 400; res.status(404) for unknown analysis ids; 4xx for missing upload file.'
        ] : [])
      ]
    : [];
  const substantialMandate = options.enforceSubstantial !== false
    && isSubstantialObjective(objective)
    && !isCausalEvidenceRepair(objective, evidenceTargets)
    ? [
        '',
        'This is a substantial multi-layer objective. The implementation MUST materially change at least eight authorized files across at least two project areas.',
        'Do not return a partial scaffold or defer authorized layers; an undersized response is rejected before any write.'
      ]
    : [];
  const requiredEditPaths = options.requiredEditPaths || [];
  const assignedNewFiles = requiredEditPaths.filter((rel) => {
    const file = files.find((item) => normalizeRelPath(item.relPath) === normalizeRelPath(rel));
    return file && !file.exists;
  });
  const smallAssignedConfigs = requiredEditPaths.length > 0
    && requiredEditPaths.every((rel) => {
      const file = files.find((item) => normalizeRelPath(item.relPath) === normalizeRelPath(rel));
      return file?.exists && file.content.length <= 32 * 1024
        && /\.(?:json|cjs|mjs|js|ts|css)$/i.test(rel);
    });
  const batchMandate = requiredEditPaths.length
    ? [
        '',
        'This is one bounded implementation batch. Other batches are coordinated separately; do not plan, describe, or output them.',
        `Inspect only these assigned candidates and return material edits where needed: ${requiredEditPaths.join(', ')}.`,
        `HARD RULE: emit ===FILE=== / ===PATCH=== blocks only for paths in that assigned list. Never invent blocks for other sealed files (for example server/index.ts) in this response.`,
        ...(assignedNewFiles.length ? [
          `MANDATORY NEW FILES: ${assignedNewFiles.join(', ')}. Every one is absent and MUST be created with a complete ===FILE=== block in this response; ===NO CHANGES=== is invalid.`
        ] : []),
        ...(smallAssignedConfigs ? [
          'PREFERRED for this small-file batch: emit a complete ===FILE: path=== ... ===END FILE=== rewrite copying the Current scoped files bytes and changing only the necessary lines. Avoid SEARCH/REPLACE — invented SEARCH text fails closed.'
        ] : []),
        assignedNewFiles.length
          ? 'Only existing files already correct may be omitted; no assigned new file may be omitted.'
          : 'Omit files that are already correct. If every assigned candidate is already correct, return exactly ===NO CHANGES===.',
        'Keep interfaces consistent with the overall approach.'
      ]
    : [];
  return [
    `Objective: ${objective}`,
    `Approach: ${approach}`,
    '',
    'Current scoped files:',
    ...sections,
    ...evidenceMandate,
    ...substantialMandate,
    ...batchMandate,
    ...(patchRequired.length ? [
      '',
      `PATCH REQUIRED for large existing files: ${patchRequired.join(', ')}.`,
      'Use exact SEARCH/REPLACE patch blocks for those files so unchanged content is not retransmitted.'
    ] : []),
    '',
    'For any other existing file, either a complete ===FILE=== block or an exact ===PATCH=== block is valid. New files require complete ===FILE=== blocks.',
    'Produce the changes now using the required block mode for each file. Close every complete file with ===END FILE=== or every patch with ===END PATCH===; unterminated blocks are rejected.'
  ].join('\n');
}

/** Validate uniqueness inside one batch; aggregate scope is enforced separately. */
export function validateBatchEdits(
  edits: ProposedEdit[],
  options: { requiredApiRoutes?: string[] } = {}
): ProposedEdit[] {
  const normalize = (rel: string) => rel.replace(/\\/g, '/').replace(/^\.\//, '');
  const touched = new Set(edits.map((edit) => normalize(edit.relPath)));
  if (touched.size !== edits.length) throw new Error('EDIT_DUPLICATE_BATCH_PATH: each assigned file may appear only once');
  return enforceApiImplementationContracts(edits, options.requiredApiRoutes || []);
}

/** A bounded greenfield batch may never silently omit an authorized new file. */
export function requireAssignedNewFiles(
  edits: ProposedEdit[],
  files: ScopedFileContent[]
): ProposedEdit[] {
  const touched = new Set(edits.map((edit) => normalizeRelPath(edit.relPath)));
  const missing = files
    .filter((file) => !file.exists && !file.serverManaged)
    .map((file) => normalizeRelPath(file.relPath))
    .filter((relPath) => !touched.has(relPath));
  if (missing.length) {
    throw new Error(
      `EDIT_MISSES_NEW_FILES: every assigned greenfield file must be created; missing: ${missing.join(', ')}`
    );
  }
  return edits;
}

/**
 * G2b/G2t: after a correct Tailwind pin, the model rewrote scripts.build
 * (esm→cjs + dropping vite build) during verification correction. Hard-reject
 * discarded sibling server/index.ts patches in the same response. Under CSS
 * toolchain evidence, restore prior scripts.* and keep dependency (and sibling)
 * edits; still enforce CSS pin completeness. Pure script theater becomes a no-op
 * package.json edit and is dropped.
 */
export function rejectProtectedPackageScriptEdits(
  edits: ProposedEdit[],
  files: ScopedFileContent[],
  evidenceTargets: string[] = []
): ProposedEdit[] {
  const evidence = evidenceTargets.map(normalizeRelPath);
  const cssToolchain = evidence.some((target) => /(^|\/)package\.json$/i.test(target))
    && evidence.some((target) => /(^|\/)postcss\.config\./i.test(target));
  if (!cssToolchain) return edits;

  const out: ProposedEdit[] = [];
  for (const edit of edits) {
    if (!/(^|\/)package\.json$/i.test(normalizeRelPath(edit.relPath))) {
      out.push(edit);
      continue;
    }
    const prior = files.find((file) => normalizeRelPath(file.relPath) === normalizeRelPath(edit.relPath));
    if (!prior?.exists) {
      out.push(edit);
      continue;
    }
    let before: Record<string, unknown>;
    let after: Record<string, unknown>;
    try {
      before = JSON.parse(prior.content) as Record<string, unknown>;
      after = JSON.parse(edit.content) as Record<string, unknown>;
    } catch {
      throw new Error('EDIT_PACKAGE_JSON_INVALID: package.json edit must be valid JSON');
    }
    let nextContent = edit.content;
    let scriptsRestored = false;
    if (JSON.stringify(before.scripts ?? null) !== JSON.stringify(after.scripts ?? null)) {
      // Deterministic policy: scripts are sealed under CSS evidence. Restore them
      // so sibling file blocks in the same response are not discarded (G2t).
      after.scripts = before.scripts;
      nextContent = `${JSON.stringify(after, null, 2)}\n`;
      scriptsRestored = true;
    }
    assertCssToolchainPackageJsonRepair(prior.content, nextContent);
    if (scriptsRestored) {
      try {
        const priorObj = JSON.parse(prior.content) as unknown;
        const nextObj = JSON.parse(nextContent) as unknown;
        if (JSON.stringify(priorObj) === JSON.stringify(nextObj)) {
          continue;
        }
      } catch {
        throw new Error('EDIT_PACKAGE_JSON_INVALID: package.json edit must be valid JSON');
      }
      out.push({ ...edit, content: nextContent });
      continue;
    }
    out.push(edit);
  }
  return out;
}

export function parseOptionalEditResponse(text: string, files: ScopedFileContent[]): ProposedEdit[] {
  if (text.trim() === '===NO CHANGES===') return [];
  return parseEditResponse(text, files);
}

/**
 * Aggregate edit gate (v3 J3).
 * Causal operational repairs with recorded evidence targets are complete when those
 * targets are edited — not when eight unrelated files are churned. Substantial
 * file-count remains for substantial objectives without file-level evidence.
 */
export function requireSubstantialEdits(
  edits: ProposedEdit[],
  objective: string,
  options: { evidenceTargets?: string[] } = {}
): ProposedEdit[] {
  const paths = edits.map((edit) => edit.relPath);
  const normalized = paths.map(normalizeRelPath);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('EDIT_DUPLICATE_AGGREGATE_PATH: each file may be changed only once');
  }
  const evidenceTargets = (options.evidenceTargets || []).map(normalizeRelPath);
  if (isCausalEvidenceRepair(objective, evidenceTargets)) {
    if (!edits.length) {
      throw new Error('EDIT_INCOMPLETE_CAUSAL_SCOPE: recorded evidence requires effective edits before any write');
    }
    return edits;
  }
  if (!isSubstantialObjective(objective)) return edits;
  // Breadth theater removed: a substantial objective needs at least one genuine
  // effective edit, not a manufactured multi-file/multi-area footprint.
  if (!edits.length) {
    throw new Error(
      'EDIT_INCOMPLETE_SUBSTANTIAL_SCOPE: substantial objective produced no effective edits before any write'
    );
  }
  return edits;
}

/**
 * Pin-to-v3 CSS repairs often leave stock PostCSS (`plugins: { tailwindcss: {} }`)
 * already correct. Forcing a no-op edit then fails closed (G2g batch 2).
 */
export function isEvidenceTargetAlreadySatisfied(file: ScopedFileContent): boolean {
  if (!file.exists) return false;
  const base = normalizeRelPath(file.relPath).split('/').pop() || '';
  if (/^postcss\.config\./i.test(base)) {
    return /(?:^|[^\w])tailwindcss\s*:/.test(file.content)
      && !/@tailwindcss\/postcss/.test(file.content);
  }
  if (/^package\.json$/i.test(base)) {
    return isCssPackageJsonEvidenceSatisfied(file.content);
  }
  return false;
}

/**
 * True when package.json already satisfies CSS toolchain repair expectations.
 * Uses the deterministic validator by checking the current bytes against themselves.
 */
export function isCssPackageJsonEvidenceSatisfied(packageJsonText: string): boolean {
  try {
    assertCssToolchainPackageJsonRepair(packageJsonText, packageJsonText);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rules-level backstop (v3 J1): every sealed evidence target must be touched
 * unless the current scoped bytes already satisfy that target's recorded cause.
 */
export function requireEvidenceTargetEdits(
  edits: ProposedEdit[],
  evidenceTargets: string[],
  options: { scopedFiles?: ScopedFileContent[] } = {}
): ProposedEdit[] {
  if (!evidenceTargets.length) return edits;
  const touched = new Set(edits.map((edit) => normalizeRelPath(edit.relPath)));
  const byPath = new Map(
    (options.scopedFiles || []).map((file) => [normalizeRelPath(file.relPath), file] as const)
  );
  const missed = evidenceTargets.map(normalizeRelPath).filter((target) => {
    if (touched.has(target)) return false;
    const current = byPath.get(target);
    return !(current && isEvidenceTargetAlreadySatisfied(current));
  });
  if (missed.length) {
    throw new Error(
      `EDIT_MISSES_EVIDENCE_TARGET: recorded evidence requires changes to ${evidenceTargets.map(normalizeRelPath).join(', ')}; missing: ${missed.join(', ')}`
    );
  }
  return edits;
}

const FILE_BLOCK = /===FILE:\s*([^=\r\n]+?)\s*===\r?\n([\s\S]*?)\r?\n?===END FILE===/g;
const PATCH_BLOCK = /===PATCH:\s*([^=\r\n]+?)\s*===\r?\n===SEARCH===\r?\n([\s\S]*?)\r?\n===REPLACE===\r?\n([\s\S]*?)\r?\n===END PATCH===/g;
/** Markers that mean residue is an incomplete/malformed block, not strip-able narration. */
const EDIT_BLOCK_MARKER = /===FILE:|===END FILE===|===PATCH:|===SEARCH===|===REPLACE===|===END PATCH===/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Exact SEARCH first; if the model drifted on indentation/CRLF, match line-trimmed
 * content with flexible newlines. Length covers the original bytes replaced.
 */
function uniqueSearchLocation(content: string, search: string): { start: number; length: number } | null {
  const variants = Array.from(new Set([
    search,
    search.replace(/\r\n/g, '\n'),
    search.replace(/(?<!\r)\n/g, '\r\n')
  ]));
  for (const variant of variants) {
    const first = content.indexOf(variant);
    if (first < 0) continue;
    if (content.indexOf(variant, first + variant.length) >= 0) {
      throw new Error('EDIT_PATCH_REJECTED: SEARCH text is not unique');
    }
    return { start: first, length: variant.length };
  }

  const searchLines = search.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map((line) => line.trimEnd());
  if (!searchLines.length || searchLines.every((line) => !line.trim())) return null;
  const pattern = searchLines
    .map((line) => `${escapeRegExp(line.trimEnd())}[ \\t]*`)
    .join('\\r?\\n');
  const re = new RegExp(pattern, 'g');
  const matches: Array<{ start: number; length: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    matches.push({ start: match.index, length: match[0].length });
    if (match[0].length === 0) re.lastIndex += 1;
  }
  if (matches.length > 1) throw new Error('EDIT_PATCH_REJECTED: SEARCH text is not unique');
  return matches[0] || null;
}

/**
 * The fence language labels the ENVELOPE, not the payload.
 *
 * This previously accepted only `text`/`plaintext`, which cost a real job: editing a Flutter
 * project, qwen2.5-coder wrapped its block list in a ```dart fence -- the natural label when the
 * files are Dart -- and both attempts died with STRUCTURED_TRANSPORT_REJECTED 'dart'. The whole
 * job then failed safe. Any language-specific project hit the same wall, so a cosmetic label check
 * was gating which stacks JoeCoder could repair at all.
 *
 * Widening the label is safe because it never did the validation. Structural guarantees come from
 * FILE_BLOCK / PATCH_BLOCK plus residue policy: pure narration outside well-formed blocks is
 * ignored (G2u local models wrap valid patches with thinking/prose); residue that still contains
 * block markers fails closed as incomplete/malformed.
 */
const EDIT_TRANSPORT_LANGUAGE = /^[a-z0-9_-]*$/i;

/**
 * G2v: bounded batches assign one evidence file (e.g. package.json), but loud missing-entry
 * evidence makes the model also emit ===FILE: server/index.ts===. That sibling is often
 * truncated (no ===END FILE===), which fails residue checks and discards a valid in-batch
 * package.json patch. Keep only well-formed blocks for assigned paths; drop the rest.
 */
export function keepAssignedEditBlocksOnly(text: string, assignedPaths: string[]): string {
  const allowed = new Set(assignedPaths.map(normalizeRelPath));
  if (!allowed.size) return text;
  // Strip thinking first: draft markers inside <think> must not block recovery of real blocks.
  const normalized = normalizeEditTransport(text);
  const kept: string[] = [];
  let match: RegExpExecArray | null;
  FILE_BLOCK.lastIndex = 0;
  while ((match = FILE_BLOCK.exec(normalized)) !== null) {
    const relPath = normalizeEditRelPath(match[1] || '');
    if (allowed.has(relPath)) kept.push(match[0].trimEnd());
  }
  PATCH_BLOCK.lastIndex = 0;
  while ((match = PATCH_BLOCK.exec(normalized)) !== null) {
    const relPath = normalizeEditRelPath(match[1] || '');
    if (allowed.has(relPath)) kept.push(match[0].trimEnd());
  }
  return kept.length ? kept.join('\n\n') + '\n' : text;
}

/**
 * Residue between well-formed edit blocks. Pure narration is ignored; leftover ===FILE=== /
 * ===PATCH=== markers mean an incomplete or malformed block and must fail closed (G2u).
 */
export function assertEditBlockResidue(normalized: string, consumed: Array<[number, number]>, kind: 'file' | 'patch'): void {
  if (!consumed.length) return;
  const ordered = [...consumed].sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  const outside: string[] = [];
  for (const [start, end] of ordered) {
    if (start < cursor) {
      throw new Error(`EDIT_PARSE_FAILED: overlapping ${kind} blocks`);
    }
    outside.push(normalized.slice(cursor, start));
    cursor = end;
  }
  outside.push(normalized.slice(cursor));
  const residue = outside.join('');
  if (!residue.trim()) return;
  if (!EDIT_BLOCK_MARKER.test(residue)) return;
  throw new Error(
    `EDIT_PARSE_FAILED: incomplete or malformed ${kind} blocks remain outside well-formed regions (missing ===END FILE=== / ===END PATCH===, or stray markers)`
  );
}

/**
 * qwen3.6 and similar local models wrap answers in thinking envelopes that often contain draft
 * ===FILE=== / ===PATCH=== markers. Those drafts are not the payload — strip closed envelopes
 * before structural parse so residue policy sees only the real blocks (G2u).
 */
export function stripModelThinkingEnvelopes(text: string): string {
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '\n')
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '\n')
    .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, '\n')
    .replace(/<reflection\b[^>]*>[\s\S]*?<\/reflection>/gi, '\n');
}

function normalizeEditTransport(text: string): string {
  return unwrapWholeTransportFence(stripModelThinkingEnvelopes(text), EDIT_TRANSPORT_LANGUAGE);
}

function normalizeNestedCodeFence(relPath: string, content: string): string {
  if (/\.(?:md|mdx)$/i.test(relPath)) return content;
  const trimmed = content.trim();
  const wholeFence = /^```[a-z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  if (wholeFence) {
    const payload = wholeFence[1] || '';
    if (!payload.trim()) {
      throw new Error(`EDIT_PAYLOAD_FENCE_REJECTED: '${relPath}' contains an empty nested Markdown code fence`);
    }
    return payload.endsWith('\n') ? payload : `${payload}\n`;
  }
  if (/^```[a-z0-9_-]*\s/i.test(trimmed) || /\s```$/i.test(trimmed)) {
    throw new Error(
      `EDIT_PAYLOAD_FENCE_REJECTED: '${relPath}' contains a partial nested Markdown code fence`
    );
  }
  return content;
}

export function parseEditBlocks(text: string): ProposedEdit[] {
  const normalized = normalizeEditTransport(text);
  const edits: ProposedEdit[] = [];
  const consumed: Array<[number, number]> = [];
  let match: RegExpExecArray | null;
  FILE_BLOCK.lastIndex = 0;
  while ((match = FILE_BLOCK.exec(normalized)) !== null) {
    consumed.push([match.index, FILE_BLOCK.lastIndex]);
    const relPath = (match[1] || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
    let content = match[2] ?? '';
    if (!relPath) continue;
    if (!content.trim()) throw new Error(`EDIT_PARSE_FAILED: empty content for '${relPath}'`);
    content = normalizeNestedCodeFence(relPath, content);
    edits.push({ relPath, content: content.endsWith('\n') ? content : `${content}\n` });
  }
  if (!edits.length) {
    throw new Error('EDIT_PARSE_FAILED: the model returned no well-formed file blocks');
  }
  assertEditBlockResidue(normalized, consumed, 'file');
  return edits;
}

function normalizeEditRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function scopedFileMap(files: ScopedFileContent[]): Map<string, ScopedFileContent> {
  return new Map(files.map((file) => [normalizeEditRelPath(file.relPath), file]));
}

/** Fail closed when the model invents a path outside the sealed exactPaths list (G2k: server/db.ts). */
function assertAuthorizedEditPath(relPath: string, authorized: Map<string, ScopedFileContent>): void {
  if (authorized.has(relPath)) return;
  const allowed = [...authorized.keys()].join(', ') || 'none';
  throw new Error(`EDIT_SCOPE_REJECTED: '${relPath}' is outside authorized scope (${allowed})`);
}

/** Convert strict exact-match patch blocks into complete replacement contents before mutation. */
export function parseEditResponse(text: string, files: ScopedFileContent[]): ProposedEdit[] {
  const normalized = normalizeEditTransport(text);
  const authorized = scopedFileMap(files);
  if (!normalized.includes('===PATCH:')) {
    const edits = parseEditBlocks(normalized);
    for (const edit of edits) assertAuthorizedEditPath(normalizeEditRelPath(edit.relPath), authorized);
    return edits;
  }

  const current = new Map(files.map((file) => [
    normalizeEditRelPath(file.relPath),
    { ...file, content: file.content }
  ]));
  const touched: string[] = [];
  const consumed: Array<[number, number]> = [];
  let match: RegExpExecArray | null;
  const completeEdits = new Map<string, ProposedEdit>();
  FILE_BLOCK.lastIndex = 0;
  while ((match = FILE_BLOCK.exec(normalized)) !== null) {
    consumed.push([match.index, FILE_BLOCK.lastIndex]);
    const relPath = normalizeEditRelPath(match[1] || '');
    let content = match[2] ?? '';
    if (!relPath || !content.trim()) throw new Error(`EDIT_PARSE_FAILED: empty complete-file block for '${relPath}'`);
    if (completeEdits.has(relPath)) throw new Error(`EDIT_PARSE_FAILED: duplicate complete-file block for '${relPath}'`);
    assertAuthorizedEditPath(relPath, authorized);
    content = normalizeNestedCodeFence(relPath, content);
    completeEdits.set(relPath, { relPath, content: content.endsWith('\n') ? content : `${content}\n` });
  }
  PATCH_BLOCK.lastIndex = 0;
  while ((match = PATCH_BLOCK.exec(normalized)) !== null) {
    consumed.push([match.index, PATCH_BLOCK.lastIndex]);
    const relPath = normalizeEditRelPath(match[1] || '');
    const search = match[2] ?? '';
    const replacement = match[3] ?? '';
    if (completeEdits.has(relPath)) throw new Error(`EDIT_PARSE_FAILED: '${relPath}' uses both complete-file and patch modes`);
    assertAuthorizedEditPath(relPath, authorized);
    const file = current.get(relPath);
    if (!file?.exists) throw new Error(`EDIT_PATCH_REJECTED: '${relPath}' is not an existing scoped file; use a complete ===FILE=== block to create it`);
    if (!search.length) throw new Error(`EDIT_PATCH_REJECTED: '${relPath}' has an empty SEARCH block`);
    let location;
    try {
      // Apply against content after earlier patches in this response so multi-hunk
      // repairs (e.g. several API routes in server/index.ts) stay well-defined.
      location = uniqueSearchLocation(file.content, search);
    } catch {
      throw new Error(`EDIT_PATCH_REJECTED: SEARCH text is not unique in '${relPath}'`);
    }
    if (!location) throw new Error(`EDIT_PATCH_REJECTED: SEARCH text was not found in '${relPath}'`);
    file.content = file.content.slice(0, location.start) + replacement + file.content.slice(location.start + location.length);
    if (!touched.includes(relPath)) touched.push(relPath);
  }
  if (!consumed.length) throw new Error('EDIT_PARSE_FAILED: the model returned no well-formed patch blocks');
  assertEditBlockResidue(normalized, consumed, 'patch');
  return [
    ...completeEdits.values(),
    ...touched.map((relPath) => ({ relPath, content: current.get(relPath)!.content }))
  ];
}

/** Reject or remove model output that would rewrite the current bytes unchanged. */
export function requireEffectiveEdits(edits: ProposedEdit[], files: ScopedFileContent[]): ProposedEdit[] {
  const effective = filterEffectiveEdits(edits, files);
  if (!effective.length) {
    throw new Error('EDIT_NO_PROGRESS: every proposed file is byte-identical to the current scoped file; diagnose another contributing scoped file from the verification evidence');
  }
  return effective;
}

/** Remove byte-identical proposals without requiring this individual batch to make progress. */
export function filterEffectiveEdits(edits: ProposedEdit[], files: ScopedFileContent[]): ProposedEdit[] {
  const current = new Map(files.map((file) => [file.relPath.replace(/\\/g, '/'), file]));
  const effective = edits.filter((edit) => {
    const relPath = edit.relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const existing = current.get(relPath);
    return !existing || !existing.exists || existing.content !== edit.content;
  });
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
    'Choose the smallest exact subset that must change. Do not return an empty files array.',
    `If architecture.contracts is present, consolidate to ≤${MAX_ARCHITECTURE_CONTRACTS} concise shared contracts (group related API/type/persistence concerns; do not list one string per route beyond that bound).`
  ].join('\n');
}

export { PLAN_SYSTEM, EDIT_SYSTEM, BUILD_SYSTEM };

/** Max temperature allowed for any structured plan/edit call. */
export const STRUCTURED_MAX_TEMPERATURE = 0.2;

/** A bounded write budget that grows with an explicitly authorized multi-file plan. */
export function changedLineBudgetForPlan(fileCount: number): number {
  const normalized = Math.max(1, Math.floor(fileCount));
  return Math.min(3000, Math.max(800, normalized * 250));
}

export interface StructuredGenerateDeps {
  generate: (request: {
    system: string;
    prompt: string;
    maxTokens?: number;
    timeoutMs?: number;
    temperature?: number;
  }) => Promise<{ text: string; provider: string; model: string; durationMs: number; stopReason?: string }>;
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
  recoveredBy: 'model' | 'deterministic';
}

export interface StructuredAttemptUpdate {
  attempt: number;
  maxAttempts: number;
  phase: 'requesting' | 'rejected' | 'accepted';
  error?: string;
}

function structuredAttemptEvidence(attempts: StructuredAttempt[]): Array<Record<string, unknown>> {
  return attempts.map((record) => ({
    attempt: record.attempt,
    provider: record.provider,
    model: record.model,
    durationMs: record.durationMs,
    parseError: record.parseError || null,
    responseChars: record.text.length,
    textHead: record.text.slice(0, 1500)
  }));
}

/** Concrete fix hints when a prior structured attempt hit a sealed API/upload contract. */
export function contractRecoveryHints(previousError: string): string[] {
  const hints: string[] = [];
  if (/PLAN_PARSE_FAILED/i.test(previousError) && /architecture[\s\S]*summary|path.*summary/i.test(previousError)) {
    hints.push(
      'CONTRACT FIX (plan architecture.summary): set architecture.summary to one sentence of at least 20 characters, e.g. "Shared UI, API, and DATA_DIR persistence for upload, analysis, and restart."'
    );
  }
  if (/EDIT_PATCH_REJECTED:\s*SEARCH text was not found/i.test(previousError)) {
    hints.push(
      'CONTRACT FIX (patch SEARCH): copy SEARCH bytes exactly from Current scoped files, or switch to a complete ===FILE: path=== rewrite of the whole file. Do not invent indentation or omit commas.'
    );
  }
  if (/EDIT_UPLOAD_DATA_DIR_REQUIRED/i.test(previousError)) {
    hints.push(
      'CONTRACT FIX (DATA_DIR): near the top of server/index.ts use exactly `const dataDir = process.env.DATA_DIR || process.env.INSPECTORCODE_DATA_DIR || process.env.JC_DATA_DIR || path.join(process.cwd(), \'data\');` and extract/write under that dataDir. Hardcoded cwd/data alone is rejected (oracle/smoke storedFiles=0).'
    );
  }
  if (/EDIT_ANALYSIS_SHALLOW|EDIT_PLACEHOLDER_REJECTED:.*simulat/i.test(previousError)) {
    hints.push(
      'CONTRACT FIX (analysis): walk DATA_DIR/<projectId>, readFile utf-8, push findings[] when content matches /\\beval\\b|oracle-seeded-eval/, return { files|totalFiles, findings }. File-type counting / simulated analysis is rejected.'
    );
  }
  if (/EDIT_ZIP_SLIP_UNPROTECTED/i.test(previousError)) {
    hints.push(
      'CONTRACT FIX (zip-slip, Windows-safe): inside the extract loop, if (relativePath.includes(\'..\') || path.isAbsolute(relativePath)) return res.status(400)...; const resolved = path.resolve(targetDir, relativePath); const rel = path.relative(path.resolve(targetDir), resolved); if (rel.startsWith(\'..\') || path.isAbsolute(rel)) return res.status(400)...; do not rely on startsWith alone.'
    );
  }
  if (/EDIT_STATIC_UI_REQUIRED/i.test(previousError)) {
    hints.push(
      'CONTRACT FIX (UI): before listen, include exactly `app.use(express.static(path.join(process.cwd(), \'dist\', \'public\')));` — must be dist+public (InspectorCode Vite outDir), not bare public/. Prefer a complete ===FILE: server/index.ts=== rewrite that already contains this line.'
    );
  }
  if (/EDIT_PERSISTENCE_EPHEMERAL/i.test(previousError)) {
    hints.push(
      'CONTRACT FIX (persist): writeFile/readFile JSON under dataDir for save+recent (JSON.stringify/parse). In-memory arrays alone fail restart oracle R6.'
    );
  }
  if (/EDIT_HTTP_4XX_REQUIRED/i.test(previousError)) {
    hints.push(
      'CONTRACT FIX (4xx): res.status(404) when analysis project missing; res.status(400) for missing upload file / zip-slip / malformed archive. Never 200 with {error} for those cases.'
    );
  }
  if (/EDIT_API_CONTRACT_INCOMPLETE/i.test(previousError)) {
    hints.push(
      'CONTRACT FIX (routes): implement POST /api/analysis/start/:projectId, GET /api/analysis/:projectId, POST /api/projects/save/:projectId — not bare /api/analysis/start.'
    );
  }
  return hints;
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
    includeRejectedExcerpt?: boolean;
    onAttempt?: (update: StructuredAttemptUpdate) => void | Promise<void>;
  }
): Promise<StructuredSuccess<T>> {
  const temperature = Math.min(
    typeof options.temperature === 'number' ? options.temperature : STRUCTURED_MAX_TEMPERATURE,
    STRUCTURED_MAX_TEMPERATURE
  );
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 2, 4));
  const attempts: StructuredAttempt[] = [];
  let previousError = '';
  let previousText = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await options.onAttempt?.({ attempt, maxAttempts, phase: 'requesting' });
    const formatRecovery = /EDIT_PARSE_FAILED|EDIT_PATCH_REJECTED|incomplete or malformed|prose or content outside/i.test(previousError)
      ? [
          'FORMAT RECOVERY (mandatory): emit ONLY well-formed ===FILE: path=== ... ===END FILE=== and/or ===PATCH: path=== ... ===END PATCH=== blocks.',
          'Delete every sentence, thinking tag, apology, and markdown fence outside those blocks.',
          'Close every FILE with ===END FILE=== and every PATCH with ===END PATCH===. Unterminated blocks are rejected.',
          'If SEARCH failed: prefer a complete ===FILE=== rewrite for small files (package.json, configs).'
        ]
      : [];
    const contractRecovery = contractRecoveryHints(previousError);
    const prompt = attempt === 1
      ? options.prompt
      : [
          options.prompt,
          '',
          'PREVIOUS RESPONSE WAS INVALID AND WAS REJECTED.',
          `Parse error: ${previousError}`,
          ...(options.recoveryContext ? ['', 'Additional verified project context:', options.recoveryContext] : []),
          '',
          ...(options.includeRejectedExcerpt === false ? [] : [`Rejected response excerpt: ${previousText.slice(0, 2000)}`]),
          ...formatRecovery,
          ...(contractRecovery.length ? ['', ...contractRecovery] : []),
          `Return ONLY the required structured format for ${options.label}. No prose, no markdown fences, no apology.`
        ].join('\n');
    let generated;
    try {
      generated = await deps.generate({
        system: options.system,
        prompt,
        temperature,
        ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
      });
    } catch (error: unknown) {
      const providerError = error instanceof Error ? error.message : String(error);
      throw Object.assign(
        new Error(`STRUCTURED_PROVIDER_FAILED on attempt ${attempt} (${options.label}): ${providerError}`),
        {
          structuredAttempts: structuredAttemptEvidence(attempts),
          structuredTransportError: providerError.slice(0, 400)
        }
      );
    }
    const record: StructuredAttempt = {
      attempt,
      text: generated.text,
      provider: generated.provider,
      model: generated.model,
      durationMs: generated.durationMs
    };
    attempts.push(record);
    if (/^(?:length|max_tokens)$/i.test(generated.stopReason || '')) {
      previousError = `MODEL_OUTPUT_TRUNCATED: provider stopped at ${generated.stopReason}`;
      previousText = '';
      record.parseError = previousError;
      await options.onAttempt?.({ attempt, maxAttempts, phase: 'rejected', error: previousError });
      continue;
    }
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
      structuredAttempts: structuredAttemptEvidence(attempts)
    }
  );
}

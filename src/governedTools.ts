import { projectProcessEnvironment, redactProcessOutput } from './processPolicy.js';
import { runBoundedProcess as runProcess, terminateOwnedProcess, resolveCommand } from './boundedProcess.js';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { inspectEvidenceById } from './evidence.js';
import { getProjectBrain } from './database/database.js';
import { auditBrowserAccessibility, comparePngWithBrowser, observeBrowserPage } from './browserAutomation.js';
import {
  applyEdits,
  resolveJailedPath,
  rollbackToSnapshot,
  snapshotScopedFiles,
  validateSnapshotManifest,
  type SnapshotManifest
} from './mutation.js';
import { previewProjectFile } from './projectExplorer.js';
import { listAgentFiles, readAgentFile, searchAgentFiles } from './repositoryReader.js';
import { sourceVersions, changedSources } from './sourceGuard.js';
import {
  GovernedToolError,
  type GovernedToolContext,
  type GovernedToolDefinition,
  type GovernedToolMetadata,
  type GovernedToolRequest,
  type GovernedToolResult
} from './governedToolTypes.js';

type AnyDefinition = GovernedToolDefinition<any, any>;

const processes = new Map<string, {
  child: ChildProcess;
  projectRoot: string;
  jobId: string;
  startedAt: number;
  command: string;
  output: string[];
}>();

/** Read-only view of processes already launched through governed job authority. */
export function inspectProjectProcesses(projectRoot: string) {
  const root = path.resolve(projectRoot);
  return [...processes.entries()].filter(([, record]) => record.projectRoot === root).map(([handle, record]) => {
    const output = redactProcessOutput(record.output.join('').slice(-16_000));
    const urls = [...new Set(output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/[^\s<>"']*)?/g) || [])];
    return { handle, jobId: record.jobId, command: record.command, startedAt: record.startedAt, output, urls };
  });
}

const relativePathSchema = z.string().trim().min(1).max(1000).refine((value) => {
  const forward = value.replace(/\\/g, '/');
  const unsafeWindowsName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  const segments = forward.split('/');
  return !path.isAbsolute(value) && !path.posix.isAbsolute(forward) &&
    !/^[a-zA-Z]:(\/|$)/.test(forward) && !value.includes('\0') &&
    segments.every((segment) =>
      Boolean(segment) &&
      segment !== '.' &&
      segment !== '..' &&
      !segment.includes(':') &&
      !/[. ]$/.test(segment) &&
      !unsafeWindowsName.test(segment)
    );
}, 'A project-relative path is required.');

const loopbackUrlSchema = z.string().url().max(2000).refine((value) => {
  const parsed = new URL(value);
  return ['http:', 'https:'].includes(parsed.protocol) && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
}, 'Only loopback HTTP(S) URLs are allowed.');

function slash(value: string): string {
  return value.replace(/\\/g, '/');
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function codeFor(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  const message = error instanceof Error ? error.message : String(error);
  const prefix = message.match(/^([A-Z][A-Z0-9_]{3,})/);
  return prefix?.[1] || 'GOVERNED_TOOL_FAILED';
}

function normalizedAuthorityPaths(context: GovernedToolContext): Set<string> {
  const root = path.resolve(context.projectRoot);
  const result = new Set<string>();
  for (const candidate of context.authority.exactPaths) {
    const full = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
    const relative = slash(path.relative(root, full));
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) continue;
    resolveJailedPath(root, relative);
    result.add(process.platform === 'win32' ? relative.toLowerCase() : relative);
  }
  return result;
}

function requireOperation(context: GovernedToolContext, operation: string | null): void {
  if (!operation) return;
  if (!context.authority.operations.includes(operation)) {
    throw new GovernedToolError('TOOL_OPERATION_NOT_AUTHORIZED', `The sealed Work Order does not authorize ${operation}.`);
  }
}

function requireMutatingPath(context: GovernedToolContext, relativePath: string): string {
  const full = resolveJailedPath(context.projectRoot, slash(relativePath));
  const canonical = slash(path.relative(path.resolve(context.projectRoot), full));
  const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  if (!normalizedAuthorityPaths(context).has(identity)) {
    throw new GovernedToolError('TOOL_PATH_NOT_AUTHORIZED', `${canonical} is outside the sealed exact-path scope.`);
  }
  return full;
}

function boundedSummary(summary: unknown, maxBytes: number): unknown {
  const serialized = json(summary);
  if (Buffer.byteLength(serialized) <= maxBytes) return summary;
  return {
    truncated: true,
    preview: serialized.slice(0, Math.max(0, maxBytes - 100)),
    originalBytes: Buffer.byteLength(serialized)
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new GovernedToolError('TOOL_TIMEOUT', `${toolName} exceeded ${timeoutMs}ms.`)),
      timeoutMs
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

async function withSettledTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  // Mutating tools must not be orphaned by a timer. Wait for the real outcome.
  // A late success is still success; converting it into TOOL_TIMEOUT caused
  // callers to retry work that had already been committed.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const raced = await Promise.race([
      promise.then(
        (value) => ({ kind: 'ok' as const, value }),
        (error) => ({ kind: 'err' as const, error })
      ),
      timeout.then(() => ({ kind: 'timeout' as const }))
    ]);
    if (raced.kind === 'ok') return raced.value;
    if (raced.kind === 'err') throw raced.error;
    try {
      return await promise;
    } catch (error) {
      throw new GovernedToolError(
        'TOOL_TIMEOUT',
        `${toolName} exceeded ${timeoutMs}ms` + (error instanceof Error ? `: ${error.message}` : '.')
      );
    }
  } finally {
    clearTimeout(timer);
  }
}
function metadata(input: Omit<GovernedToolMetadata, 'evidenceProducer'>): GovernedToolMetadata {
  return { ...input, evidenceProducer: `joecoder-governed-tool/${input.name}@1` };
}

async function npmInvocation(args: string[]): Promise<{ command: string; args: string[] }> {
  const resolved = resolveCommand('npm');
  return { command: resolved.executable, args: [...resolved.prefixArgs, ...args] };
}
const terminateProcessTree = terminateOwnedProcess;

async function readJsonFile(relativePath: string, context: GovernedToolContext): Promise<{ value: any; content: string; full: string }> {
  const preview = await previewProjectFile(context.projectRoot, relativePath);
  if (preview.truncated) throw new GovernedToolError('CONFIG_FILE_TOO_LARGE', 'Structured configuration exceeds the safe edit limit.');
  try {
    return { value: JSON.parse(preview.content), content: preview.content, full: resolveJailedPath(context.projectRoot, relativePath) };
  } catch {
    throw new GovernedToolError('CONFIG_JSON_INVALID', `${relativePath} is not valid JSON.`);
  }
}

async function runBoundedProcess(input: {
  command: string; args: string[]; cwd: string; timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal;
  profile?: { script: string; scriptHash: string; packageRoot: string };
}) {
  const result = await runProcess(input.command, input.args, {
    cwd: input.cwd, timeoutMs: input.timeoutMs, maxOutputCharacters: input.maxOutputBytes,
    env: projectProcessEnvironment(), ...(input.signal ? { signal: input.signal } : {}),
    ...(input.profile ? { profile: input.profile } : {})
  });
  return { command: input.command, args: input.args, ...result };
}

async function packageScripts(projectRoot: string): Promise<Record<string, string>> {
  const preview = await previewProjectFile(projectRoot, 'package.json');
  if (preview.truncated) throw new GovernedToolError('PACKAGE_JSON_TOO_LARGE', 'Package scripts exceed the safe read limit.');
  const content = preview.content;
  if (!content) throw new GovernedToolError('PACKAGE_JSON_REQUIRED', 'This governed command requires a package.json.');
  const parsed = z.object({ scripts: z.record(z.string()).optional() }).passthrough().parse(JSON.parse(content));
  return parsed.scripts || {};
}

async function runProjectCheck(context: GovernedToolContext, packagePath: string | undefined, candidates: string[]) {
  const runRoot = packagePath ? resolveJailedPath(context.projectRoot, packagePath) : path.resolve(context.projectRoot);
  const scripts = await packageScripts(runRoot);
  const script = candidates.find(name => typeof scripts[name] === 'string');
  if (!script) throw new GovernedToolError('PROJECT_CHECK_UNAVAILABLE', 'No ' + candidates.join('/') + ' script is declared in ' + (packagePath || '.') + '.');
  const before = await sourceVersions(context.projectRoot);
  const npm = await npmInvocation(['run', script, '--']);
  if (JSON.stringify(await packageScripts(runRoot)) !== JSON.stringify(scripts)) {
    throw new GovernedToolError('COMMAND_PROFILE_CHANGED', 'Package scripts changed before launch. Inspect them again.');
  }
  const result = await runBoundedProcess({ ...npm, cwd: runRoot,
    timeoutMs: Math.min(context.authority.maxDurationMs, 120_000), maxOutputBytes: context.authority.maxOutputBytes,
    ...(context.signal ? { signal: context.signal } : {}),
    profile: { script, scriptHash: sha256(JSON.stringify(scripts)), packageRoot: runRoot } });
  const changed = changedSources(before, await sourceVersions(context.projectRoot));
  return { ...result, passed: result.exitCode === 0 && !result.cancelled && !result.timedOut && !result.launchError && changed.length === 0,
    changedSources: changed, ...(changed.length ? { code: 'SOURCE_CHECK_SIDE_EFFECT' } : {}) };
}

function safeArtifactPath(context: GovernedToolContext, relative: string): string {
  const root = path.resolve(context.artifactsRoot);
  const full = path.resolve(root, relative);
  const rel = path.relative(root, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new GovernedToolError('ARTIFACT_PATH_ESCAPE', 'The artifact path leaves JoeCoder evidence storage.');
  }
  return full;
}

function snapshotPath(context: GovernedToolContext, snapshotId: string): string {
  if (!/^SNAP-[a-zA-Z0-9-]+$/.test(snapshotId)) {
    throw new GovernedToolError('SNAPSHOT_ID_INVALID', 'A valid recorded snapshot ID is required.');
  }
  return path.join(context.snapshotsRoot, snapshotId, 'manifest.json');
}

async function loadSnapshot(context: GovernedToolContext, snapshotId: string): Promise<SnapshotManifest> {
  const stored = JSON.parse(await fs.readFile(snapshotPath(context, snapshotId), 'utf8')) as unknown;
  try {
    return validateSnapshotManifest(stored, {
      expectedSnapshotId: snapshotId,
      expectedProjectRoot: context.projectRoot
    });
  } catch (error: unknown) {
    const code = error instanceof Error && error.message === 'SNAPSHOT_PROJECT_MISMATCH'
      ? 'SNAPSHOT_PROJECT_MISMATCH'
      : 'SNAPSHOT_MANIFEST_INVALID';
    throw new GovernedToolError(code, 'The snapshot manifest is invalid or belongs to a different project.');
  }
}

function setJsonPointer(root: any, pointer: string, value: unknown): void {
  if (!pointer.startsWith('/') || pointer.length > 500) {
    throw new GovernedToolError('JSON_POINTER_INVALID', 'Configuration updates require an RFC 6901-style pointer.');
  }
  const parts = pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) {
    throw new GovernedToolError('JSON_POINTER_UNSAFE', 'Unsafe object keys are blocked.');
  }
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]!;
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
      throw new GovernedToolError('JSON_POINTER_NOT_FOUND', `Configuration path ${pointer} does not exist.`);
    }
    cursor = cursor[part];
  }
  const leaf = parts.at(-1)!;
  if (!cursor || typeof cursor !== 'object') throw new GovernedToolError('JSON_POINTER_NOT_FOUND', `Configuration path ${pointer} does not exist.`);
  cursor[leaf] = value;
}

const definitions: AnyDefinition[] = [
  {
    metadata: metadata({ name: 'files.list', title: 'List project files', authority: 'read_only', operation: null, readsPaths: true, writesPaths: false, timeoutMs: 10_000, maxOutputBytes: 128_000, costClass: 'local_free', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ path: z.string().max(1000).optional().default(''), cursor: z.string().max(4000).optional(), limit: z.number().int().min(1).max(500).optional() }).strict(),
    execute: (input, context) => listAgentFiles(context.projectRoot, input),
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'files.search', title: 'Search project text', authority: 'read_only', operation: null, readsPaths: true, writesPaths: false, timeoutMs: 20_000, maxOutputBytes: 128_000, costClass: 'local_free', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ query: z.string().trim().min(1).max(120), path: z.string().max(1000).optional().default(''), maxResults: z.number().int().min(1).max(200).optional().default(100), cursor: z.string().max(4000).optional(), caseSensitive: z.boolean().optional(), pathFilter: z.string().max(250).optional() }).strict(),
    execute: (input, context) => searchAgentFiles(context.projectRoot, input, context.signal),
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'files.read', title: 'Read a project file range', authority: 'read_only', operation: null, readsPaths: true, writesPaths: false, timeoutMs: 10_000, maxOutputBytes: 256_000, costClass: 'local_free', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ path: relativePathSchema, startLine: z.number().int().min(1).optional().default(1), endLine: z.number().int().min(1).max(10_000_000).optional(), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
    execute: (input, context) => readAgentFile(context.projectRoot, input, context.signal),
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'files.metadata', title: 'Inspect file metadata', authority: 'read_only', operation: null, readsPaths: true, writesPaths: false, timeoutMs: 10_000, maxOutputBytes: 32_000, costClass: 'local_free', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ path: relativePathSchema }).strict(),
    execute: async (input, context) => {
      const full = resolveJailedPath(context.projectRoot, input.path);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) throw new GovernedToolError('SYMLINK_NOT_ALLOWED', 'Linked paths are not inspected by governed tools.');
      return { path: slash(input.path), type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', size: stat.size, modifiedAt: stat.mtime.toISOString(), mode: stat.mode };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'memory.project_brain', title: 'Read Project Brain', authority: 'read_only', operation: null, readsPaths: false, writesPaths: false, timeoutMs: 5_000, maxOutputBytes: 128_000, costClass: 'local_free', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({}).strict(),
    execute: (_input, context) => Promise.resolve(getProjectBrain(context.projectId)),
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'evidence.read', title: 'Read verified evidence', authority: 'read_only', operation: null, readsPaths: false, writesPaths: false, timeoutMs: 5_000, maxOutputBytes: 256_000, costClass: 'local_free', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ evidenceId: z.string().regex(/^EVC-[a-zA-Z0-9-]+$/) }).strict(),
    execute: async (input) => {
      const evidence = await inspectEvidenceById(input.evidenceId);
      if (!evidence.verified || !evidence.content) throw new GovernedToolError('EVIDENCE_NOT_VERIFIED', `Evidence ${input.evidenceId} is unavailable or invalid.`);
      return evidence;
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'git.inspect', title: 'Inspect git state', authority: 'read_only', operation: null, readsPaths: true, writesPaths: false, timeoutMs: 15_000, maxOutputBytes: 128_000, costClass: 'local_process', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ view: z.enum(['status', 'diff_stat', 'recent_commits']).optional().default('status') }).strict(),
    execute: async (input, context) => {
      const args = input.view === 'status' ? ['status', '--short'] : input.view === 'diff_stat' ? ['diff', '--stat'] : ['log', '-n', '10', '--oneline'];
      return runBoundedProcess({ command: 'git', args, cwd: context.projectRoot, timeoutMs: 15_000, maxOutputBytes: 128_000, ...(context.signal ? { signal: context.signal } : {}) });
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'process.inspect', title: 'Inspect running processes', authority: 'read_only', operation: null, readsPaths: false, writesPaths: false, timeoutMs: 15_000, maxOutputBytes: 128_000, costClass: 'local_process', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ filter: z.string().max(80).optional().default('') }).strict(),
    execute: async (input, context) => {
      const result = process.platform === 'win32'
        ? await runBoundedProcess({ command: 'tasklist.exe', args: ['/FO', 'CSV', '/NH'], cwd: context.projectRoot, timeoutMs: 15_000, maxOutputBytes: 128_000 })
        : await runBoundedProcess({ command: 'ps', args: ['-eo', 'pid,comm,args'], cwd: context.projectRoot, timeoutMs: 15_000, maxOutputBytes: 128_000 });
      const filter = input.filter.toLowerCase();
      if (filter) result.stdout = result.stdout.split(/\r?\n/).filter((line) => line.toLowerCase().includes(filter)).join('\n');
      return result;
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'files.create', title: 'Create an authorized file', authority: 'mutating', operation: 'edit_files', readsPaths: true, writesPaths: true, timeoutMs: 30_000, maxOutputBytes: 64_000, costClass: 'local_free', reversibility: 'snapshot', idempotent: false }),
    schema: z.object({ path: relativePathSchema, content: z.string().max(2_000_000) }).strict(),
    execute: async (input, context) => {
      const full = requireMutatingPath(context, input.path);
      if (await fs.stat(full).then(() => true).catch(() => false)) throw new GovernedToolError('CREATE_TARGET_EXISTS', `${input.path} already exists.`);
      const snapshot = await snapshotScopedFiles(context.projectRoot, [input.path], context.snapshotsRoot);
      const applied = await applyEdits(context.projectRoot, [{ relPath: input.path, content: input.content }], {
        scopeRelPaths: [input.path], maxFiles: context.authority.maxFiles,
        ...(context.authority.maxChangedLines === undefined ? {} : { maxChangedLines: context.authority.maxChangedLines })
      });
      return { snapshotId: snapshot.snapshotId, ...applied };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'files.apply_exact_patch', title: 'Apply an exact authorized patch', authority: 'mutating', operation: 'edit_files', readsPaths: true, writesPaths: true, timeoutMs: 30_000, maxOutputBytes: 128_000, costClass: 'local_free', reversibility: 'snapshot', idempotent: false }),
    schema: z.object({
      path: relativePathSchema,
      expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
      replacements: z.array(z.object({ oldText: z.string().min(1).max(200_000), newText: z.string().max(200_000), occurrence: z.number().int().min(1).max(100).optional().default(1) }).strict()).min(1).max(50)
    }).strict(),
    execute: async (input, context) => {
      const full = requireMutatingPath(context, input.path);
      const before = await fs.readFile(full, 'utf8');
      if (sha256(before) !== input.expectedSha256) throw new GovernedToolError('PATCH_PRECONDITION_FAILED', `${input.path} changed after planning.`);
      let content = before;
      for (const replacement of input.replacements) {
        let from = 0;
        let index = -1;
        for (let count = 0; count < replacement.occurrence; count += 1) {
          index = content.indexOf(replacement.oldText, from);
          if (index < 0) throw new GovernedToolError('PATCH_TEXT_NOT_FOUND', `Exact patch text was not found in ${input.path}.`);
          from = index + replacement.oldText.length;
        }
        content = content.slice(0, index) + replacement.newText + content.slice(index + replacement.oldText.length);
      }
      const snapshot = await snapshotScopedFiles(context.projectRoot, [input.path], context.snapshotsRoot);
      const applied = await applyEdits(context.projectRoot, [{ relPath: input.path, content }], {
        scopeRelPaths: [input.path], maxFiles: context.authority.maxFiles,
        ...(context.authority.maxChangedLines === undefined ? {} : { maxChangedLines: context.authority.maxChangedLines })
      });
      return { snapshotId: snapshot.snapshotId, ...applied };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'files.move', title: 'Move an authorized file', authority: 'mutating', operation: 'rename_files', readsPaths: true, writesPaths: true, timeoutMs: 30_000, maxOutputBytes: 64_000, costClass: 'local_free', reversibility: 'snapshot', idempotent: false }),
    schema: z.object({ from: relativePathSchema, to: relativePathSchema }).strict(),
    execute: async (input, context) => {
      const source = requireMutatingPath(context, input.from);
      const destination = requireMutatingPath(context, input.to);
      if (await fs.stat(destination).then(() => true).catch(() => false)) throw new GovernedToolError('MOVE_TARGET_EXISTS', `${input.to} already exists.`);
      const parent = await fs.stat(path.dirname(destination)).catch(() => null);
      if (!parent?.isDirectory()) throw new GovernedToolError('MOVE_PARENT_REQUIRED', 'The destination folder must already exist and be authorized.');
      const snapshot = await snapshotScopedFiles(context.projectRoot, [input.from, input.to], context.snapshotsRoot);
      try { await fs.rename(source, destination); }
      catch (error) {
        const rollback = await rollbackToSnapshot(context.snapshotsRoot, snapshot);
        if (rollback.failures.length) throw new GovernedToolError('MOVE_ROLLBACK_INCOMPLETE', json(rollback));
        throw error;
      }
      return { snapshotId: snapshot.snapshotId, moved: { from: input.from, to: input.to } };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'files.delete', title: 'Delete an explicitly authorized file', authority: 'mutating', operation: 'delete_files', readsPaths: true, writesPaths: true, timeoutMs: 30_000, maxOutputBytes: 64_000, costClass: 'local_free', reversibility: 'snapshot', idempotent: false }),
    schema: z.object({ path: relativePathSchema, confirmExactPath: relativePathSchema }).strict(),
    execute: async (input, context) => {
      if (!context.authority.allowDelete || input.path !== input.confirmExactPath) throw new GovernedToolError('DELETE_CONFIRMATION_REQUIRED', 'Delete requires an exact repeated path and explicit allowance.');
      const full = requireMutatingPath(context, input.path);
      const stat = await fs.lstat(full);
      if (!stat.isFile()) throw new GovernedToolError('DELETE_FILE_REQUIRED', 'Recursive or directory deletion is not supported.');
      const snapshot = await snapshotScopedFiles(context.projectRoot, [input.path], context.snapshotsRoot);
      await fs.unlink(full);
      return { snapshotId: snapshot.snapshotId, deleted: input.path };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'config.update_json', title: 'Update authorized JSON configuration', authority: 'mutating', operation: 'edit_files', readsPaths: true, writesPaths: true, timeoutMs: 30_000, maxOutputBytes: 128_000, costClass: 'local_free', reversibility: 'snapshot', idempotent: false }),
    schema: z.object({ path: relativePathSchema, expectedSha256: z.string().regex(/^[a-f0-9]{64}$/), updates: z.array(z.object({ pointer: z.string().min(1).max(500), value: z.unknown() }).strict()).min(1).max(50) }).strict(),
    execute: async (input, context) => {
      requireMutatingPath(context, input.path);
      const current = await readJsonFile(input.path, context);
      if (sha256(current.content) !== input.expectedSha256) throw new GovernedToolError('CONFIG_PRECONDITION_FAILED', `${input.path} changed after planning.`);
      const next = structuredClone(current.value);
      for (const update of input.updates) setJsonPointer(next, update.pointer, update.value);
      const content = `${JSON.stringify(next, null, 2)}\n`;
      const snapshot = await snapshotScopedFiles(context.projectRoot, [input.path], context.snapshotsRoot);
      const applied = await applyEdits(context.projectRoot, [{ relPath: input.path, content }], {
        scopeRelPaths: [input.path], maxFiles: context.authority.maxFiles,
        ...(context.authority.maxChangedLines === undefined ? {} : { maxChangedLines: context.authority.maxChangedLines })
      });
      return { snapshotId: snapshot.snapshotId, ...applied };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'project.run_check', title: 'Run an allowlisted project check', authority: 'mutating', operation: 'run_tests', readsPaths: true, writesPaths: false, timeoutMs: 120_000, maxOutputBytes: 256_000, costClass: 'local_process', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ check: z.enum(['build', 'test', 'lint', 'typecheck']), packagePath: relativePathSchema.optional() }).strict(),
    execute: async (input, context) => {
      const candidates: Record<string, string[]> = { build: ['build'], test: ['test'], lint: ['lint'], typecheck: ['typecheck', 'type-check'] };
      return runProjectCheck(context, input.packagePath, candidates[input.check]!);
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'project.format_check', title: 'Check project formatting', authority: 'mutating', operation: 'run_tests', readsPaths: true, writesPaths: false, timeoutMs: 120_000, maxOutputBytes: 256_000, costClass: 'local_process', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ packagePath: relativePathSchema.optional() }).strict(),
    execute: async (input, context) => runProjectCheck(context, input.packagePath, ['format:check', 'format-check']),
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'project.launch', title: 'Launch an authorized project process', authority: 'mutating', operation: 'run_app', readsPaths: true, writesPaths: false, timeoutMs: 15_000, maxOutputBytes: 64_000, costClass: 'local_process', reversibility: 'process_stop', idempotent: false }),
    schema: z.object({ script: z.enum(['start', 'dev']) }).strict(),
    execute: async (input, context) => {
      const scripts = await packageScripts(context.projectRoot);
      if (!scripts[input.script]) throw new GovernedToolError('LAUNCH_SCRIPT_UNAVAILABLE', `No ${input.script} script is declared.`);
      const handle = `proc-${randomBytes(8).toString('hex')}`;
      const npm = await npmInvocation(['run', input.script, '--']);
      const child = spawn(npm.command, npm.args, { cwd: context.projectRoot, shell: false, windowsHide: true, env: projectProcessEnvironment({ NODE_ENV: input.script === 'dev' ? 'development' : 'production' }), detached: process.platform !== 'win32' });
      const record = { child, projectRoot: path.resolve(context.projectRoot), jobId: context.jobId, startedAt: Date.now(), command: `npm run ${input.script}`, output: [] as string[] };
      const add = (prefix: string, chunk: unknown) => {
        record.output.push(`${prefix}${String(chunk)}`.slice(0, 16_000));
        if (record.output.length > 100) record.output.shift();
      };
      child.stdout?.on('data', (chunk) => add('', chunk));
      child.stderr?.on('data', (chunk) => add('ERR: ', chunk));
      child.once('close', () => processes.delete(handle));
      processes.set(handle, record);
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (child.exitCode !== null) throw new GovernedToolError('PROJECT_LAUNCH_FAILED', record.output.join('').slice(-8000));
      return { handle, pid: child.pid, command: record.command, startedAt: record.startedAt, output: redactProcessOutput(record.output.join('').slice(-8000)) };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'project.stop', title: 'Stop a governed project process', authority: 'mutating', operation: 'run_app', readsPaths: false, writesPaths: false, timeoutMs: 15_000, maxOutputBytes: 64_000, costClass: 'local_process', reversibility: 'idempotent', idempotent: true }),
    schema: z.object({ handle: z.string().regex(/^proc-[a-f0-9]{16}$/) }).strict(),
    execute: async (input, context) => {
      const record = processes.get(input.handle);
      if (!record || record.jobId !== context.jobId || record.projectRoot !== path.resolve(context.projectRoot)) {
        throw new GovernedToolError('PROCESS_HANDLE_NOT_OWNED', 'The process was not launched by this exact job.');
      }
      await terminateProcessTree(record.child);
      processes.delete(input.handle);
      return { handle: input.handle, stopped: true, output: redactProcessOutput(record.output.join('').slice(-8000)) };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'health.query', title: 'Query a loopback health endpoint', authority: 'read_only', operation: null, readsPaths: false, writesPaths: false, timeoutMs: 15_000, maxOutputBytes: 128_000, costClass: 'network_loopback', reversibility: 'idempotent', idempotent: true }),
    schema: z.object({ url: loopbackUrlSchema }).strict(),
    execute: async (input) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(input.url, { signal: controller.signal, redirect: 'error' });
        const body = (await response.text()).slice(0, 128_000);
        return { url: input.url, status: response.status, ok: response.ok, contentType: response.headers.get('content-type'), body };
      } finally { clearTimeout(timer); }
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'recovery.checkpoint', title: 'Create a reversible checkpoint', authority: 'mutating', operation: 'edit_files', readsPaths: true, writesPaths: false, timeoutMs: 30_000, maxOutputBytes: 128_000, costClass: 'local_free', reversibility: 'idempotent', idempotent: true }),
    schema: z.object({ paths: z.array(relativePathSchema).min(1).max(200) }).strict(),
    execute: async (input, context) => {
      for (const item of input.paths) requireMutatingPath(context, item);
      return snapshotScopedFiles(context.projectRoot, input.paths, context.snapshotsRoot);
    },
    summarize: (output) => ({ snapshotId: output.snapshotId, files: output.files })
  },
  {
    metadata: metadata({ name: 'recovery.restore', title: 'Restore an authorized checkpoint', authority: 'mutating', operation: 'edit_files', readsPaths: true, writesPaths: true, timeoutMs: 60_000, maxOutputBytes: 128_000, costClass: 'local_free', reversibility: 'snapshot', idempotent: true }),
    schema: z.object({ snapshotId: z.string().regex(/^SNAP-[a-zA-Z0-9-]+$/), paths: z.array(relativePathSchema).max(200).optional() }).strict(),
    execute: async (input, context) => {
      const manifest = await loadSnapshot(context, input.snapshotId);
      const selected = input.paths?.length ? new Set(input.paths.map(slash)) : null;
      const files = manifest.files.filter((record) => !selected || selected.has(slash(record.relPath)));
      if (!files.length) throw new GovernedToolError('RESTORE_SCOPE_EMPTY', 'No recorded snapshot files matched the restore request.');
      for (const file of files) requireMutatingPath(context, file.relPath);
      return rollbackToSnapshot(context.snapshotsRoot, { ...manifest, files });
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'visual.capture', title: 'Capture the running UI', authority: 'read_only', operation: null, readsPaths: false, writesPaths: false, timeoutMs: 45_000, maxOutputBytes: 128_000, costClass: 'network_loopback', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ url: loopbackUrlSchema, width: z.number().int().min(320).max(3840).optional().default(1440), height: z.number().int().min(240).max(2160).optional().default(900) }).strict(),
    execute: async (input, context) => {
      const observed = await observeBrowserPage(input);
      const name = `${context.jobId}-capture-${Date.now()}.png`;
      const full = safeArtifactPath(context, name);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, observed.screenshot);
      return { ...observed, screenshot: undefined, artifactPath: full, sha256: sha256(observed.screenshot), bytes: observed.screenshot.length };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'visual.inspect', title: 'Inspect browser console and network', authority: 'read_only', operation: null, readsPaths: false, writesPaths: false, timeoutMs: 45_000, maxOutputBytes: 128_000, costClass: 'network_loopback', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ url: loopbackUrlSchema, width: z.number().int().min(320).max(3840).optional().default(1440), height: z.number().int().min(240).max(2160).optional().default(900) }).strict(),
    execute: async (input) => {
      const observed = await observeBrowserPage(input);
      return { title: observed.title, url: observed.url, console: observed.console, networkFailures: observed.networkFailures, layout: observed.layout, viewport: observed.viewport };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'visual.interact', title: 'Test governed browser interactions', authority: 'read_only', operation: null, readsPaths: false, writesPaths: false, timeoutMs: 60_000, maxOutputBytes: 128_000, costClass: 'network_loopback', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({
      url: loopbackUrlSchema,
      width: z.number().int().min(320).max(3840).optional().default(1440),
      height: z.number().int().min(240).max(2160).optional().default(900),
      interactions: z.array(z.discriminatedUnion('action', [
        z.object({ action: z.literal('click'), selector: z.string().min(1).max(500) }).strict(),
        z.object({ action: z.literal('type'), selector: z.string().min(1).max(500), text: z.string().max(5000) }).strict(),
        z.object({ action: z.literal('wait'), milliseconds: z.number().int().min(10).max(5000) }).strict()
      ])).min(1).max(30)
    }).strict(),
    execute: async (input, context) => {
      const observed = await observeBrowserPage({ ...input, interactions: input.interactions });
      const name = `${context.jobId}-interaction-${Date.now()}.png`;
      const full = safeArtifactPath(context, name);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, observed.screenshot);
      return { ...observed, screenshot: undefined, artifactPath: full, sha256: sha256(observed.screenshot), bytes: observed.screenshot.length };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'visual.responsive', title: 'Check responsive layouts', authority: 'read_only', operation: null, readsPaths: false, writesPaths: false, timeoutMs: 120_000, maxOutputBytes: 256_000, costClass: 'network_loopback', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ url: loopbackUrlSchema, viewports: z.array(z.object({ width: z.number().int().min(320).max(3840), height: z.number().int().min(240).max(2160) }).strict()).min(1).max(5) }).strict(),
    execute: async (input, context) => {
      const results = [];
      for (const viewport of input.viewports) {
        const observed = await observeBrowserPage({ url: input.url, ...viewport });
        const name = `${context.jobId}-responsive-${viewport.width}x${viewport.height}-${Date.now()}.png`;
        const full = safeArtifactPath(context, name);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, observed.screenshot);
        results.push({ viewport, artifactPath: full, sha256: sha256(observed.screenshot), horizontalOverflow: observed.layout.scrollWidth > observed.layout.clientWidth, console: observed.console, networkFailures: observed.networkFailures });
      }
      return { url: input.url, results };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'visual.accessibility', title: 'Check basic browser accessibility', authority: 'read_only', operation: null, readsPaths: false, writesPaths: false, timeoutMs: 45_000, maxOutputBytes: 128_000, costClass: 'network_loopback', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ url: loopbackUrlSchema, width: z.number().int().min(320).max(3840).optional().default(1440), height: z.number().int().min(240).max(2160).optional().default(900) }).strict(),
    execute: (input) => auditBrowserAccessibility(input),
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'visual.compare', title: 'Compare two recorded screenshots', authority: 'read_only', operation: null, readsPaths: false, writesPaths: false, timeoutMs: 60_000, maxOutputBytes: 64_000, costClass: 'local_process', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ baselineArtifact: relativePathSchema, actualArtifact: relativePathSchema, threshold: z.number().min(0).max(1).optional().default(0.05), maxMismatchRatio: z.number().min(0).max(1).optional().default(0.001) }).strict(),
    execute: async (input, context) => {
      const baseline = await fs.readFile(safeArtifactPath(context, input.baselineArtifact));
      const actual = await fs.readFile(safeArtifactPath(context, input.actualArtifact));
      if (baseline.length > 20_000_000 || actual.length > 20_000_000) throw new GovernedToolError('SCREENSHOT_TOO_LARGE', 'Screenshots exceed the safe comparison limit.');
      const comparison = await comparePngWithBrowser(baseline, actual, input.threshold);
      return { ...comparison, maxMismatchRatio: input.maxMismatchRatio, passed: comparison.mismatchRatio <= input.maxMismatchRatio };
    },
    summarize: (output) => output
  }
];

const REGISTRY = new Map(definitions.map((definition) => [definition.metadata.name, definition]));

export function listGovernedTools(): GovernedToolMetadata[] {
  return definitions.map((definition) => ({ ...definition.metadata }));
}

export async function executeGovernedTool(
  request: GovernedToolRequest,
  context: GovernedToolContext
): Promise<GovernedToolResult> {
  const startedAt = Date.now();
  const definition = REGISTRY.get(request.name);
  if (!definition) {
    const error = `Unknown governed tool: ${request.name}`;
    return { ok: false, tool: request.name, durationMs: 0, evidenceId: null, outputHash: sha256(error), code: 'TOOL_NOT_FOUND', error };
  }
  let evidenceId: string | null = null;
  try {
    if (definition.metadata.authority === 'mutating' && context.authority.mode !== 'mutating') {
      throw new GovernedToolError('TOOL_MUTATION_NOT_AUTHORIZED', `${request.name} requires a sealed mutating job.`);
    }
    requireOperation(context, definition.metadata.operation);
    const input = definition.schema.parse(request.input);
    const effectiveTimeout = Math.min(definition.metadata.timeoutMs, context.authority.maxDurationMs);
    context.signal?.throwIfAborted();
    const timeoutSignal = AbortSignal.timeout(Math.max(1, effectiveTimeout));
    const signal = context.signal ? AbortSignal.any([context.signal, timeoutSignal]) : timeoutSignal;
    const operation = definition.execute(input, { ...context, signal });
    const output = await (definition.metadata.authority === 'mutating'
      ? withSettledTimeout(operation, effectiveTimeout, request.name)
      : withTimeout(operation, effectiveTimeout, request.name));
    const outputJson = json(output);
    const outputHash = sha256(outputJson);
    const evidence = await context.recordEvidence({
      type: 'governed_tool.result',
      producer: definition.metadata.evidenceProducer,
      projectId: context.projectId,
      jobId: context.jobId,
      workOrderId: context.workOrderId,
      metadata: definition.metadata,
      request: { name: request.name, input },
      output,
      outputHash,
      durationMs: Date.now() - startedAt
    });
    evidenceId = evidence.id;
    return {
      ok: true,
      tool: request.name,
      durationMs: Date.now() - startedAt,
      evidenceId,
      outputHash,
      summary: boundedSummary(definition.summarize(output), Math.min(definition.metadata.maxOutputBytes, context.authority.maxOutputBytes))
    };
  } catch (error: unknown) {
    const message = error instanceof z.ZodError
      ? `Tool input was rejected: ${error.issues.map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`).join('; ')}`
      : error instanceof Error ? error.message : String(error);
    const code = error instanceof z.ZodError ? 'TOOL_INPUT_INVALID' : codeFor(error);
    const outputHash = sha256(json({ code, message }));
    try {
      const evidence = await context.recordEvidence({
        type: 'governed_tool.failure',
        producer: definition.metadata.evidenceProducer,
        projectId: context.projectId,
        jobId: context.jobId,
        workOrderId: context.workOrderId,
        metadata: definition.metadata,
        request,
        failure: { code, message },
        outputHash,
        durationMs: Date.now() - startedAt
      });
      evidenceId = evidence.id;
    } catch {}
    return { ok: false, tool: request.name, durationMs: Date.now() - startedAt, evidenceId, outputHash, code, error: message };
  }
}

export async function retryGovernedTool(
  request: GovernedToolRequest,
  context: GovernedToolContext,
  previous: GovernedToolResult
): Promise<GovernedToolResult> {
  const definition = REGISTRY.get(request.name);
  if (!definition?.metadata.idempotent) {
    return {
      ok: false,
      tool: request.name,
      durationMs: 0,
      evidenceId: null,
      outputHash: sha256('TOOL_RETRY_NOT_IDEMPOTENT'),
      code: 'TOOL_RETRY_NOT_IDEMPOTENT',
      error: 'Only tools declared idempotent may be retried automatically.'
    };
  }
  if (previous.ok) return previous;
  return executeGovernedTool(request, context);
}

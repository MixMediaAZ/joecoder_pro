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
  type SnapshotManifest
} from './mutation.js';
import { listProjectFiles, previewProjectFile } from './projectExplorer.js';
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

const relativePathSchema = z.string().trim().min(1).max(1000).refine((value) => {
  const forward = value.replace(/\\/g, '/');
  return !path.isAbsolute(value) && !path.posix.isAbsolute(forward) &&
    !/^[a-zA-Z]:(\/|$)/.test(forward) && !forward.split('/').includes('..') && !value.includes('\0');
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
  if (error instanceof GovernedToolError) return error.code;
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
    result.add(relative);
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
  const normalized = slash(relativePath);
  const full = resolveJailedPath(context.projectRoot, normalized);
  if (!normalizedAuthorityPaths(context).has(normalized)) {
    throw new GovernedToolError('TOOL_PATH_NOT_AUTHORIZED', `${normalized} is outside the sealed exact-path scope.`);
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
function metadata(input: Omit<GovernedToolMetadata, 'evidenceProducer'>): GovernedToolMetadata {
  return { ...input, evidenceProducer: `joecoder-governed-tool/${input.name}@1` };
}

async function npmInvocation(args: string[]): Promise<{ command: string; args: string[] }> {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return { command: process.execPath, args: [candidate, ...args] };
    } catch {}
  }
  return { command: 'npm', args };
}

async function terminateProcessTree(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stderr = '';
      killer.stderr?.on('data', (chunk) => { stderr += String(chunk); });
      const timer = setTimeout(() => {
        killer.kill();
        reject(new GovernedToolError('PROCESS_STOP_TIMEOUT', `Timed out stopping governed process ${child.pid}.`));
      }, timeoutMs);
      killer.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      killer.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
        else reject(new GovernedToolError('PROCESS_STOP_FAILED', stderr.trim() || `Could not stop governed process ${child.pid}.`));
      });
    });
    await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
    // Windows can report process termination before the final cwd/file handles are released.
    await new Promise((resolve) => setTimeout(resolve, 750));
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    closed,
    new Promise<never>((_, reject) => setTimeout(() => {
      child.kill('SIGKILL');
      reject(new GovernedToolError('PROCESS_STOP_TIMEOUT', `Timed out stopping governed process ${child.pid}.`));
    }, timeoutMs))
  ]);
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
}

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
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}): Promise<{ command: string; args: string[]; exitCode: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, CI: '1', NO_COLOR: '1' }
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const append = (current: string, chunk: unknown) => {
      const next = current + String(chunk);
      return Buffer.byteLength(next) <= input.maxOutputBytes
        ? next
        : next.slice(-(Math.floor(input.maxOutputBytes / 2)));
    };
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.once('error', reject);
    const timer = setTimeout(() => { timedOut = true; void terminateProcessTree(child).catch(() => child.kill()); }, input.timeoutMs);
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ command: input.command, args: input.args, exitCode, signal, stdout, stderr, timedOut });
    });
  });
}

async function packageScripts(projectRoot: string): Promise<Record<string, string>> {
  const content = await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8').catch(() => null);
  if (!content) throw new GovernedToolError('PACKAGE_JSON_REQUIRED', 'This governed command requires a package.json.');
  const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
  return parsed.scripts || {};
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
  const manifest = JSON.parse(await fs.readFile(snapshotPath(context, snapshotId), 'utf8')) as SnapshotManifest;
  if (path.resolve(manifest.projectRoot) !== path.resolve(context.projectRoot)) {
    throw new GovernedToolError('SNAPSHOT_PROJECT_MISMATCH', 'The snapshot belongs to a different project.');
  }
  return manifest;
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
    schema: z.object({ path: z.string().max(1000).optional().default('') }).strict(),
    execute: (input, context) => listProjectFiles(context.projectRoot, input.path),
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'files.search', title: 'Search project text', authority: 'read_only', operation: null, readsPaths: true, writesPaths: false, timeoutMs: 20_000, maxOutputBytes: 128_000, costClass: 'local_free', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ query: z.string().trim().min(1).max(120), path: z.string().max(1000).optional().default(''), maxResults: z.number().int().min(1).max(200).optional().default(100) }).strict(),
    execute: async (input, context) => {
      const results: Array<{ path: string; line: number; text: string }> = [];
      const queue = [input.path];
      let visited = 0;
      while (queue.length && results.length < input.maxResults && visited < 10_000) {
        const current = queue.shift()!;
        const listing = await listProjectFiles(context.projectRoot, current);
        for (const entry of listing.entries) {
          visited += 1;
          if (entry.type === 'directory') { queue.push(entry.path); continue; }
          if (entry.protected || (entry.size || 0) > 512 * 1024) continue;
          let preview;
          try { preview = await previewProjectFile(context.projectRoot, entry.path); } catch { continue; }
          const lines = preview.content.split(/\r?\n/);
          for (let index = 0; index < lines.length && results.length < input.maxResults; index += 1) {
            if ((lines[index] || '').toLowerCase().includes(input.query.toLowerCase())) {
              results.push({ path: entry.path, line: index + 1, text: (lines[index] || '').slice(0, 500) });
            }
          }
        }
      }
      return { query: input.query, results, truncated: results.length >= input.maxResults || visited >= 10_000, visited };
    },
    summarize: (output) => output
  },
  {
    metadata: metadata({ name: 'files.read', title: 'Read a project file range', authority: 'read_only', operation: null, readsPaths: true, writesPaths: false, timeoutMs: 10_000, maxOutputBytes: 256_000, costClass: 'local_free', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({ path: relativePathSchema, startLine: z.number().int().min(1).optional().default(1), endLine: z.number().int().min(1).max(100_000).optional() }).strict(),
    execute: async (input, context) => {
      const preview = await previewProjectFile(context.projectRoot, input.path);
      const lines = preview.content.split(/\r?\n/);
      const end = Math.min(input.endLine || input.startLine + 399, input.startLine + 399, lines.length);
      return { ...preview, content: lines.slice(input.startLine - 1, end).join('\n'), startLine: input.startLine, endLine: end };
    },
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
      return runBoundedProcess({ command: 'git', args, cwd: context.projectRoot, timeoutMs: 15_000, maxOutputBytes: 128_000 });
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
    schema: z.object({ check: z.enum(['build', 'test', 'lint', 'typecheck']) }).strict(),
    execute: async (input, context) => {
      const scripts = await packageScripts(context.projectRoot);
      const candidates: Record<string, string[]> = { build: ['build'], test: ['test'], lint: ['lint'], typecheck: ['typecheck', 'type-check'] };
      const script = candidates[input.check]!.find((name) => typeof scripts[name] === 'string');
      if (!script) throw new GovernedToolError('PROJECT_CHECK_UNAVAILABLE', `No ${input.check} script is declared.`);
      const npm = await npmInvocation(['run', script, '--']);
      return runBoundedProcess({ ...npm, cwd: context.projectRoot, timeoutMs: Math.min(context.authority.maxDurationMs, 120_000), maxOutputBytes: context.authority.maxOutputBytes });
    },
    summarize: (output) => ({ exitCode: output.exitCode, timedOut: output.timedOut, stdout: output.stdout, stderr: output.stderr })
  },
  {
    metadata: metadata({ name: 'project.format_check', title: 'Check project formatting', authority: 'mutating', operation: 'run_tests', readsPaths: true, writesPaths: false, timeoutMs: 120_000, maxOutputBytes: 256_000, costClass: 'local_process', reversibility: 'not_applicable', idempotent: true }),
    schema: z.object({}).strict(),
    execute: async (_input, context) => {
      const scripts = await packageScripts(context.projectRoot);
      const script = ['format:check', 'format-check'].find((name) => typeof scripts[name] === 'string');
      if (!script) throw new GovernedToolError('FORMAT_CHECK_UNAVAILABLE', 'No non-mutating format check script is declared.');
      const npm = await npmInvocation(['run', script, '--']);
      return runBoundedProcess({ ...npm, cwd: context.projectRoot, timeoutMs: Math.min(context.authority.maxDurationMs, 120_000), maxOutputBytes: context.authority.maxOutputBytes });
    },
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
      const child = spawn(npm.command, npm.args, { cwd: context.projectRoot, shell: false, windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });
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
      return { handle, pid: child.pid, command: record.command, startedAt: record.startedAt, output: record.output.join('').slice(-8000) };
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
      return { handle: input.handle, stopped: true, output: record.output.join('').slice(-8000) };
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
    const output = await withTimeout(definition.execute(input, context), effectiveTimeout, request.name);
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

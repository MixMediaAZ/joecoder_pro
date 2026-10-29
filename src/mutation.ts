/**
 * Mutation engine: collision-safe snapshots, transactional scoped writes,
 * budget enforcement, and byte-verified rollback.
 */

import { createHash, randomBytes } from 'node:crypto';
import { lstatSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile, atomicWriteJson } from './persistence.js';

export interface ProposedEdit {
  relPath: string;
  content: string;
}

export interface SnapshotFileRecord {
  relPath: string;
  snapshotFile?: string;
  existed: boolean;
  hash: string | null;
  sizeBytes: number | null;
}

export interface SnapshotManifest {
  snapshotId: string;
  projectRoot: string;
  createdAt: string;
  files: SnapshotFileRecord[];
}

export interface AppliedChange {
  relPath: string;
  action: 'created_file' | 'replaced_file';
  previousHash: string | null;
  newHash: string;
  linesBefore: number;
  linesAfter: number;
  changedLines: number;
}

export interface ApplyEditsResult {
  applied: AppliedChange[];
  totalChangedLines: number;
}

export interface RollbackFailure {
  relPath: string;
  reason: string;
}

export class MutationTransactionError extends Error {
  readonly code: 'MUTATION_COMMIT_FAILED_ROLLED_BACK' | 'MUTATION_RECOVERY_INCOMPLETE';

  constructor(
    message: string,
    readonly committedPaths: string[],
    readonly recoveryFailures: RollbackFailure[]
  ) {
    super(message);
    this.name = 'MutationTransactionError';
    this.code = recoveryFailures.length
      ? 'MUTATION_RECOVERY_INCOMPLETE'
      : 'MUTATION_COMMIT_FAILED_ROLLED_BACK';
  }

  get recoveryComplete(): boolean {
    return this.recoveryFailures.length === 0;
  }
}

const FORBIDDEN_SEGMENTS = new Set(['.git', 'node_modules', '.jc']);
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_EDIT_BYTES = 2_000_000;
const MAX_TRANSACTION_BYTES = 8_000_000;

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function canonicalRelativePath(projectRoot: string, relPath: string): string {
  if (!relPath) {
    throw new Error("SCOPE_VIOLATION: path must be project-relative: '" + relPath + "'");
  }
  // Reject absolute paths on any platform, including Windows drive letters that
  // path.isAbsolute() may not treat as absolute when running on Linux.
  const forward = relPath.replace(/\\/g, '/');
  if (
    path.isAbsolute(relPath) ||
    path.isAbsolute(forward) ||
    /^[a-zA-Z]:(\/|$)/.test(forward) ||
    relPath.includes('\0')
  ) {
    throw new Error("SCOPE_VIOLATION: path must be project-relative: '" + relPath + "'");
  }
  const segments = forward.split('/');
  if (segments.some((segment) =>
    !segment ||
    segment === '.' ||
    segment === '..' ||
    segment.includes(':') ||
    /[. ]$/.test(segment) ||
    WINDOWS_DEVICE_NAME.test(segment)
  )) {
    throw new Error("SCOPE_VIOLATION: path is not canonical or portable: '" + relPath + "'");
  }
  const root = path.resolve(projectRoot);
  const full = path.resolve(root, relPath);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error("SCOPE_VIOLATION: path escapes the project root: '" + relPath + "'");
  }
  for (const segment of rel.split(path.sep)) {
    if (FORBIDDEN_SEGMENTS.has(segment.toLowerCase())) {
      throw new Error("SCOPE_VIOLATION: writes into '" + segment + "' are not permitted: '" + relPath + "'");
    }
  }
  const canonical = rel.split(path.sep).join('/');
  if (canonical !== forward) {
    throw new Error("SCOPE_VIOLATION: path must use its canonical project-relative form: '" + relPath + "'");
  }
  return canonical;
}

function pathIdentity(relPath: string): string {
  return process.platform === 'win32' ? relPath.toLowerCase() : relPath;
}

export function resolveJailedPath(projectRoot: string, relPath: string): string {
  const canonical = canonicalRelativePath(projectRoot, relPath);
  const root = path.resolve(projectRoot);
  const full = path.resolve(root, canonical);
  let current = root;
  for (const segment of canonical.split('/')) {
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error("SCOPE_VIOLATION: linked paths are not permitted: '" + relPath + "'");
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
  return full;
}

function normalizeRel(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

function snapshotFileName(relPath: string): string {
  return 'file-' + sha256(Buffer.from(normalizeRel(relPath), 'utf8')) + '.bin';
}

function snapshotRecordPath(snapshotDir: string, record: SnapshotFileRecord): string {
  // Backward-compatible fallback for manifests created before collision-safe names.
  return path.join(snapshotDir, record.snapshotFile || record.relPath.replace(/\//g, '__'));
}

export function validateSnapshotManifest(
  value: unknown,
  options: { expectedSnapshotId?: string; expectedProjectRoot?: string } = {}
): SnapshotManifest {
  if (!value || typeof value !== 'object') throw new Error('SNAPSHOT_MANIFEST_INVALID');
  const manifest = value as Partial<SnapshotManifest>;
  if (
    typeof manifest.snapshotId !== 'string' ||
    !/^SNAP-\d+-[a-f0-9]+$/.test(manifest.snapshotId) ||
    (options.expectedSnapshotId !== undefined && manifest.snapshotId !== options.expectedSnapshotId) ||
    typeof manifest.projectRoot !== 'string' ||
    !path.isAbsolute(manifest.projectRoot) ||
    typeof manifest.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error('SNAPSHOT_MANIFEST_INVALID');
  }
  if (
    options.expectedProjectRoot !== undefined &&
    pathIdentity(path.resolve(manifest.projectRoot)) !== pathIdentity(path.resolve(options.expectedProjectRoot))
  ) {
    throw new Error('SNAPSHOT_PROJECT_MISMATCH');
  }
  const seen = new Set<string>();
  for (const candidate of manifest.files) {
    if (!candidate || typeof candidate !== 'object') throw new Error('SNAPSHOT_RECORD_INVALID');
    const record = candidate as Partial<SnapshotFileRecord>;
    if (typeof record.relPath !== 'string') throw new Error('SNAPSHOT_RECORD_INVALID');
    const canonical = canonicalRelativePath(manifest.projectRoot, record.relPath);
    const identity = pathIdentity(canonical);
    if (seen.has(identity)) throw new Error('SNAPSHOT_RECORD_DUPLICATE');
    seen.add(identity);
    if (
      typeof record.existed !== 'boolean' ||
      (record.snapshotFile !== undefined && record.snapshotFile !== snapshotFileName(canonical)) ||
      (record.existed
        ? typeof record.hash !== 'string' || !/^[a-f0-9]{64}$/.test(record.hash) ||
          !Number.isSafeInteger(record.sizeBytes) || Number(record.sizeBytes) < 0
        : record.hash !== null || record.sizeBytes !== null)
    ) {
      throw new Error('SNAPSHOT_RECORD_INVALID');
    }
  }
  return manifest as SnapshotManifest;
}

export function countChangedLines(before: string, after: string): number {
  if (before === after) return 0;
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const shared = Math.min(a.length, b.length);
  let changed = Math.abs(a.length - b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) changed++;
  }
  return changed;
}

export async function snapshotScopedFiles(
  projectRoot: string,
  relPaths: string[],
  snapshotsRoot: string
): Promise<SnapshotManifest> {
  const snapshotId = 'SNAP-' + Date.now() + '-' + randomBytes(6).toString('hex');
  const snapshotDir = path.join(snapshotsRoot, snapshotId);
  await fs.mkdir(snapshotDir, { recursive: true });

  const files: SnapshotFileRecord[] = [];
  const seen = new Set<string>();
  for (const requestedPath of relPaths) {
    const relPath = canonicalRelativePath(projectRoot, requestedPath);
    const identity = pathIdentity(relPath);
    if (seen.has(identity)) throw new Error("DUPLICATE_SNAPSHOT_PATH: '" + relPath + "'");
    seen.add(identity);

    const full = resolveJailedPath(projectRoot, relPath);
    const snapshotFile = snapshotFileName(relPath);
    try {
      const content = await fs.readFile(full);
      await atomicWriteFile(path.join(snapshotDir, snapshotFile), content);
      files.push({
        relPath,
        snapshotFile,
        existed: true,
        hash: sha256(content),
        sizeBytes: content.length
      });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      files.push({ relPath, snapshotFile, existed: false, hash: null, sizeBytes: null });
    }
  }

  const manifest: SnapshotManifest = {
    snapshotId,
    projectRoot: path.resolve(projectRoot),
    createdAt: new Date().toISOString(),
    files
  };
  await atomicWriteJson(path.join(snapshotDir, 'manifest.json'), manifest);
  return manifest;
}

interface StagedEdit {
  full: string;
  rel: string;
  content: string;
  beforeBuffer: Buffer | null;
  beforeText: string | null;
  changed: number;
  bytes: number;
}

async function restoreCommitted(projectRoot: string, staged: StagedEdit[]): Promise<RollbackFailure[]> {
  const failures: RollbackFailure[] = [];
  for (const item of [...staged].reverse()) {
    try {
      const full = resolveJailedPath(projectRoot, item.rel);
      if (item.beforeBuffer === null) {
        await fs.unlink(full).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
        const stillExists = await fs.stat(full).then(() => true).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        });
        if (stillExists) throw new Error('CREATED_FILE_STILL_EXISTS');
      } else {
        await atomicWriteFile(full, item.beforeBuffer);
        const restored = await fs.readFile(full);
        if (sha256(restored) !== sha256(item.beforeBuffer)) {
          throw new Error('RESTORE_HASH_MISMATCH');
        }
      }
    } catch (error: unknown) {
      failures.push({
        relPath: item.rel,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return failures;
}

export async function applyEdits(
  projectRoot: string,
  edits: ProposedEdit[],
  options: {
    scopeRelPaths: string[];
    maxFiles: number;
    maxChangedLines?: number;
    maxChangedBytes?: number;
    beforeWrite?: (relPath: string, index: number) => void | Promise<void>;
  }
): Promise<ApplyEditsResult> {
  if (!edits.length) throw new Error('NO_EDITS_PROPOSED');
  if (edits.length > options.maxFiles) {
    throw new Error('BUDGET_EXCEEDED: ' + edits.length + ' files proposed, budget allows ' + options.maxFiles);
  }

  const scope = new Set(options.scopeRelPaths.map((item) =>
    pathIdentity(canonicalRelativePath(projectRoot, item))
  ));
  const seen = new Set<string>();
  const staged: StagedEdit[] = [];
  let totalChangedLines = 0;
  let totalChangedBytes = 0;

  // Validate and read every pre-state before the first target write.
  for (const edit of edits) {
    const rel = canonicalRelativePath(projectRoot, edit.relPath);
    const identity = pathIdentity(rel);
    if (seen.has(identity)) throw new Error("DUPLICATE_EDIT: '" + rel + "' proposed twice");
    seen.add(identity);
    if (!scope.has(identity)) {
      throw new Error("SCOPE_VIOLATION: '" + rel + "' is not in the authorized exactPaths scope");
    }

    const full = resolveJailedPath(projectRoot, rel);
    let beforeBuffer: Buffer | null = null;
    try {
      beforeBuffer = await fs.readFile(full);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const beforeText = beforeBuffer?.toString('utf8') ?? null;
    const changed = countChangedLines(beforeText ?? '', edit.content);
    const bytes = Buffer.byteLength(edit.content);
    if (bytes > MAX_EDIT_BYTES) {
      throw new Error('BUDGET_EXCEEDED: ' + rel + ' contains ' + bytes + ' bytes, per-file budget allows ' + MAX_EDIT_BYTES);
    }
    totalChangedLines += changed;
    totalChangedBytes += bytes;
    staged.push({ full, rel, content: edit.content, beforeBuffer, beforeText, changed, bytes });
  }

  if (options.maxChangedLines !== undefined && totalChangedLines > options.maxChangedLines) {
    throw new Error('BUDGET_EXCEEDED: ' + totalChangedLines + ' changed lines proposed, budget allows ' + options.maxChangedLines);
  }
  const byteBudget = Math.min(options.maxChangedBytes ?? MAX_TRANSACTION_BYTES, MAX_TRANSACTION_BYTES);
  if (totalChangedBytes > byteBudget) {
    throw new Error('BUDGET_EXCEEDED: ' + totalChangedBytes + ' changed bytes proposed, budget allows ' + byteBudget);
  }

  const applied: AppliedChange[] = [];
  const committed: StagedEdit[] = [];
  try {
    for (let index = 0; index < staged.length; index++) {
      const item = staged[index];
      if (!item) continue;
      await options.beforeWrite?.(item.rel, index);
      const full = resolveJailedPath(projectRoot, item.rel);
      let current: Buffer | null = null;
      try {
        current = await fs.readFile(full);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (
        (item.beforeBuffer === null && current !== null) ||
        (item.beforeBuffer !== null && (current === null || sha256(current) !== sha256(item.beforeBuffer)))
      ) {
        throw new Error("MUTATION_PRECONDITION_FAILED: '" + item.rel + "' changed after staging");
      }
      await atomicWriteFile(full, item.content);
      committed.push(item);
      const written = await fs.readFile(resolveJailedPath(projectRoot, item.rel));
      if (sha256(written) !== sha256(item.content)) {
        throw new Error("MUTATION_WRITE_VERIFICATION_FAILED: '" + item.rel + "'");
      }
      applied.push({
        relPath: item.rel,
        action: item.beforeBuffer === null ? 'created_file' : 'replaced_file',
        previousHash: item.beforeBuffer === null ? null : sha256(item.beforeBuffer),
        newHash: sha256(item.content),
        linesBefore: item.beforeText === null ? 0 : item.beforeText.split(/\r?\n/).length,
        linesAfter: item.content.split(/\r?\n/).length,
        changedLines: item.changed
      });
    }
  } catch (error: unknown) {
    const recoveryFailures = await restoreCommitted(projectRoot, committed);
    const reason = error instanceof Error ? error.message : String(error);
    throw new MutationTransactionError(
      'MUTATION_COMMIT_FAILED: ' + reason,
      committed.map((item) => item.rel),
      recoveryFailures
    );
  }

  return { applied, totalChangedLines };
}

export interface RollbackResult {
  restored: string[];
  deleted: string[];
  failures: RollbackFailure[];
}

export async function rollbackToSnapshot(
  snapshotsRoot: string,
  manifest: SnapshotManifest,
  options: { expectedProjectRoot?: string } = {}
): Promise<RollbackResult> {
  manifest = validateSnapshotManifest(manifest, {
    expectedSnapshotId: manifest.snapshotId,
    ...(options.expectedProjectRoot === undefined ? {} : { expectedProjectRoot: options.expectedProjectRoot })
  });
  const snapshotDir = path.join(snapshotsRoot, manifest.snapshotId);
  const result: RollbackResult = { restored: [], deleted: [], failures: [] };

  for (const record of manifest.files) {
    const full = resolveJailedPath(manifest.projectRoot, record.relPath);
    try {
      if (record.existed) {
        const source = snapshotRecordPath(snapshotDir, record);
        const content = await fs.readFile(source);
        if (!record.hash || sha256(content) !== record.hash) {
          throw new Error('SNAPSHOT_HASH_MISMATCH');
        }
        await atomicWriteFile(full, content);
        const restored = await fs.readFile(full);
        if (sha256(restored) !== record.hash) {
          throw new Error('RESTORE_HASH_MISMATCH');
        }
        result.restored.push(record.relPath);
      } else {
        await fs.unlink(full).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
        const stillExists = await fs.stat(full).then(() => true).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        });
        if (stillExists) throw new Error('CREATED_FILE_STILL_EXISTS');
        result.deleted.push(record.relPath);
      }
    } catch (error: unknown) {
      result.failures.push({
        relPath: record.relPath,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return result;
}
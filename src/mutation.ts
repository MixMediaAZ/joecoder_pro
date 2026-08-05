/**
 * Mutation engine: collision-safe snapshots, transactional scoped writes,
 * budget enforcement, and byte-verified rollback.
 */

import { createHash, randomBytes } from 'node:crypto';
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

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function resolveJailedPath(projectRoot: string, relPath: string): string {
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
    const relPath = normalizeRel(requestedPath);
    if (seen.has(relPath)) throw new Error("DUPLICATE_SNAPSHOT_PATH: '" + relPath + "'");
    seen.add(relPath);

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
}

async function restoreCommitted(staged: StagedEdit[]): Promise<RollbackFailure[]> {
  const failures: RollbackFailure[] = [];
  for (const item of [...staged].reverse()) {
    try {
      if (item.beforeBuffer === null) {
        await fs.unlink(item.full).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
        const stillExists = await fs.stat(item.full).then(() => true).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        });
        if (stillExists) throw new Error('CREATED_FILE_STILL_EXISTS');
      } else {
        await atomicWriteFile(item.full, item.beforeBuffer);
        const restored = await fs.readFile(item.full);
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
    beforeWrite?: (relPath: string, index: number) => void | Promise<void>;
  }
): Promise<ApplyEditsResult> {
  if (!edits.length) throw new Error('NO_EDITS_PROPOSED');
  if (edits.length > options.maxFiles) {
    throw new Error('BUDGET_EXCEEDED: ' + edits.length + ' files proposed, budget allows ' + options.maxFiles);
  }

  const scope = new Set(options.scopeRelPaths.map(normalizeRel));
  const seen = new Set<string>();
  const staged: StagedEdit[] = [];
  let totalChangedLines = 0;

  // Validate and read every pre-state before the first target write.
  for (const edit of edits) {
    const rel = normalizeRel(edit.relPath);
    if (seen.has(rel)) throw new Error("DUPLICATE_EDIT: '" + rel + "' proposed twice");
    seen.add(rel);
    if (!scope.has(rel)) {
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
    totalChangedLines += changed;
    staged.push({ full, rel, content: edit.content, beforeBuffer, beforeText, changed });
  }

  if (options.maxChangedLines !== undefined && totalChangedLines > options.maxChangedLines) {
    throw new Error('BUDGET_EXCEEDED: ' + totalChangedLines + ' changed lines proposed, budget allows ' + options.maxChangedLines);
  }

  const applied: AppliedChange[] = [];
  const committed: StagedEdit[] = [];
  try {
    for (let index = 0; index < staged.length; index++) {
      const item = staged[index];
      if (!item) continue;
      await options.beforeWrite?.(item.rel, index);
      await atomicWriteFile(item.full, item.content);
      committed.push(item);
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
    const recoveryFailures = await restoreCommitted(committed);
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
  manifest: SnapshotManifest
): Promise<RollbackResult> {
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
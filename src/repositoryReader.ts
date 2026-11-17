import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ProjectFileAccessError, resolveExistingPath, sensitiveName } from './projectExplorer.js';

const EXCLUDED = new Set(['.git', '.jc', 'node_modules', '.next', 'dist', 'build', 'coverage', 'vendor', '.venv', '__pycache__', '.cache', '.snapshots', '.artifacts', '.aws', '.ssh', '.azure']);
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LINE_CHARS = 1024 * 1024;
const MAX_SCAN_BYTES = 32 * 1024 * 1024;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const failure = (code: string, message: string): never => { throw new ProjectFileAccessError(code, 409, message); };
const slash = (value: string) => value.replace(/\\/g, '/');

async function target(root: string, relative: string, directory = false) {
  const normalized = slash(relative);
  if (normalized.split('/').some(part => part.includes(':') || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    failure('INVALID_PROJECT_PATH', 'Choose an ordinary project-relative path.');
  }
  const resolved = await resolveExistingPath(root, relative, directory);
  let current = resolved.root;
  for (const part of resolved.normalized.split('/').filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) failure('SYMLINK_NOT_BROWSABLE', 'Linked paths are not agent-readable.');
  }
  if (resolved.normalized.split('/').some(part => ['.aws', '.ssh', '.azure'].includes(part.toLowerCase()))) failure('PROTECTED_AGENT_FILE', 'Credential directories are not agent-readable.');
  if (!directory && (sensitiveName(path.basename(resolved.normalized)) || resolved.stat.nlink > 1)) {
    failure('PROTECTED_AGENT_FILE', 'Sensitive or multiply-linked files are not supplied to the model.');
  }
  return resolved;
}

function decodeCursor(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    if (value.length > 4000) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || parsed.v !== 1 || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { return failure('INVALID_SEARCH_CURSOR', 'The continuation is invalid; restart this read.'); }
}
const cursor = (value: Record<string, unknown>) => Buffer.from(JSON.stringify({ v: 1, ...value })).toString('base64url');

export interface AgentDirectoryEntry {
  name: string; path: string; type: 'directory' | 'file'; size: number; modifiedAt: number; protected: boolean;
}
export async function listAgentFiles(root: string, input: { path?: string; cursor?: string | undefined; limit?: number } = {}) {
  const resolved = await target(root, input.path || '', true);
  if (!resolved.stat.isDirectory()) failure('PROJECT_DIRECTORY_REQUIRED', 'Choose a directory.');
  const raw = (await fs.readdir(resolved.real, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (raw.length > 50_000) failure('DIRECTORY_SCAN_LIMIT', 'Directory exceeds the 50,000-entry scan limit; choose a narrower path.');
  const version = hash(raw.map(item => [item.name, item.isDirectory(), item.isSymbolicLink()].join(':')).join('\n'));
  const prior = decodeCursor(input.cursor);
  if (prior && (prior.path !== resolved.normalized || prior.version !== version)) failure('SEARCH_CURSOR_STALE', 'Directory changed; restart the listing.');
  const offset = prior ? Number(prior.offset) : 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > raw.length) failure('INVALID_SEARCH_CURSOR', 'Invalid listing offset.');
  const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
  const entries: AgentDirectoryEntry[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let position = offset;
  while (position < raw.length && position < offset + limit) {
    const item = raw[position++]!;
    const relative = slash(path.join(resolved.normalized, item.name));
    if (item.isSymbolicLink() || EXCLUDED.has(item.name.toLowerCase()) || (!item.isDirectory() && !item.isFile())) {
      skipped.push({ path: relative, reason: 'excluded_or_linked' }); continue;
    }
    try {
      const stat = await fs.lstat(path.join(resolved.real, item.name));
      if (stat.isSymbolicLink()) { skipped.push({ path: relative, reason: 'linked' }); continue; }
      entries.push({ name: item.name, path: relative, type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size, modifiedAt: stat.mtimeMs, protected: sensitiveName(item.name) || (stat.isFile() && stat.nlink > 1) });
    } catch { skipped.push({ path: relative, reason: 'unreadable_or_changed' }); }
  }
  return { directory: resolved.normalized, entries, skipped, readOnly: true as const, version,
    truncated: position < raw.length, nextCursor: position < raw.length ? cursor({ path: resolved.normalized, version, offset: position }) : null };
}

async function scanText(root: string, relative: string, onLine: (text: string, number: number) => void, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const resolved = await target(root, relative);
  if (!resolved.stat.isFile()) failure('PROJECT_FILE_REQUIRED', 'Choose a text file.');
  if (resolved.stat.size > MAX_FILE_BYTES) failure('FILE_SCAN_LIMIT', 'File exceeds the 16 MiB text scan limit.');
  const handle = await fs.open(resolved.real, 'r');
  try {
    const before = await handle.stat();
    if (before.ino !== resolved.stat.ino || before.dev !== resolved.stat.dev || before.nlink > 1) failure('FILE_CHANGED_DURING_READ', 'File identity changed before reading.');
    const digest = createHash('sha256');
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const chunk = Buffer.alloc(64 * 1024);
    let position = 0, lineCount = 0, pending = '';
    const accept = (text: string) => {
      pending += text;
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        if (end > MAX_LINE_CHARS) failure('LINE_SCAN_LIMIT', 'A line exceeds the 1 MiB scan limit.');
        onLine(pending.slice(0, end).replace(/\r$/, ''), ++lineCount);
        pending = pending.slice(end + 1);
      }
      if (pending.length > MAX_LINE_CHARS) failure('LINE_SCAN_LIMIT', 'A line exceeds the 1 MiB scan limit.');
    };
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      if (position > MAX_FILE_BYTES) failure('FILE_SCAN_LIMIT', 'File grew beyond the 16 MiB text scan limit.');
      const bytes = chunk.subarray(0, bytesRead);
      if (bytes.includes(0)) failure('BINARY_FILE_PREVIEW_BLOCKED', 'Binary files are excluded from text reads.');
      digest.update(bytes);
      try { accept(decoder.decode(bytes, { stream: true })); } catch (error) {
        if (error instanceof ProjectFileAccessError) throw error;
        failure('INVALID_FILE_ENCODING', 'The file is not valid UTF-8.');
      }
    }
    try { accept(decoder.decode()); } catch { failure('INVALID_FILE_ENCODING', 'The file is not valid UTF-8.'); }
    if (pending) onLine(pending.replace(/\r$/, ''), ++lineCount);
    const after = await handle.stat();
    const now = await target(root, relative);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
        || now.stat.ino !== before.ino || now.stat.dev !== before.dev || now.stat.size !== after.size || now.stat.mtimeMs !== after.mtimeMs) {
      failure('FILE_CHANGED_DURING_READ', 'The file changed during reading; request a fresh range.');
    }
    return { path: resolved.normalized, size: position, sha256: digest.digest('hex'), lineCount };
  } finally { await handle.close(); }
}

export async function readAgentFile(root: string, input: { path: string; startLine?: number; endLine?: number; expectedSha256?: string }, signal?: AbortSignal) {
  const start = input.startLine ?? 1;
  const end = Math.min(input.endLine ?? start + 399, start + 399);
  if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || end < start) failure('INVALID_LINE_RANGE', 'Choose a valid inclusive line range.');
  const lines: string[] = [];
  let bytes = 0, clipped = false;
  const metadata = await scanText(root, input.path, (text, number) => {
    if (number < start || number > end) return;
    if (bytes + Buffer.byteLength(text) + 1 > 128_000) { clipped = true; return; }
    if (!clipped) { lines.push(text); bytes += Buffer.byteLength(text) + 1; }
  }, signal);
  if (clipped && !lines.length) failure('RANGE_OUTPUT_LIMIT', 'The requested line exceeds the 128 KB output limit; use a literal search for a bounded excerpt.');
  if (input.expectedSha256 && metadata.sha256 !== input.expectedSha256) failure('FILE_VERSION_CHANGED', 'File changed between reads; restart with its new version.');
  const returnedEnd = start + lines.length - 1;
  return { ...metadata, content: lines.join('\n'), startLine: start, endLine: returnedEnd,
    truncated: clipped || returnedEnd < metadata.lineCount, rangeTruncated: clipped,
    nextStartLine: returnedEnd < metadata.lineCount && lines.length ? returnedEnd + 1 : null, readOnly: true as const };
}

async function inventory(root: string, relative: string, signal?: AbortSignal) {
  const files: AgentDirectoryEntry[] = [];
  const queue = [relative];
  const issues: Array<{ path: string; reason: string }> = [];
  let visits = 0, excluded = 0;
  while (queue.length && visits < 20_000) {
    signal?.throwIfAborted();
    const directory = queue.shift()!;
    let next: string | undefined;
    try {
      do {
        const page = await listAgentFiles(root, { path: directory, cursor: next, limit: 500 });
        visits += page.entries.length + page.skipped.length;
        for (const skip of page.skipped) {
          if (skip.reason === 'unreadable_or_changed') issues.push(skip); else excluded++;
        }
        for (const entry of page.entries) {
          if (entry.protected) { excluded++; continue; }
          if (entry.type === 'directory') {
            if (entry.path.split('/').length < 32) queue.push(entry.path);
            else issues.push({ path: entry.path, reason: 'depth_limit' });
          } else files.push(entry);
        }
        next = page.nextCursor || undefined;
      } while (next && visits < 20_000);
      if (next) issues.push({ path: directory, reason: 'inventory_limit' });
    } catch (error) { signal?.throwIfAborted(); issues.push({ path: directory, reason: error instanceof ProjectFileAccessError ? error.code : 'unreadable' }); }
  }
  if (queue.length) issues.push({ path: relative, reason: 'inventory_limit' });
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files, issues, visits, excluded, version: hash(JSON.stringify(files.map(f => [f.path, f.size, f.modifiedAt]))) };
}

export async function searchAgentFiles(root: string, input: { query: string; path?: string; maxResults?: number; cursor?: string | undefined; caseSensitive?: boolean; pathFilter?: string }, signal?: AbortSignal) {
  if (!input.query.trim() || input.query.length > 120) failure('INVALID_SEARCH_QUERY', 'Provide a literal search of 1 to 120 characters.');
  const found = await inventory(root, input.path || '', signal);
  const signature = hash(JSON.stringify([input.path || '', input.query, !!input.caseSensitive, input.pathFilter || '']));
  const previous = decodeCursor(input.cursor);
  if (previous && (previous.signature !== signature || previous.version !== found.version)) failure('SEARCH_CURSOR_STALE', 'Search files or parameters changed; restart the search.');
  let index = previous ? Number(previous.index) : 0;
  let afterLine = previous ? Number(previous.line) : 0;
  if (!Number.isInteger(index) || index < 0 || index > found.files.length || !Number.isInteger(afterLine) || afterLine < 0) failure('INVALID_SEARCH_CURSOR', 'Invalid search continuation.');
  const maximum = Math.max(1, Math.min(input.maxResults ?? 100, 200));
  const results: Array<{ path: string; line: number; text: string; sha256: string }> = [];
  const issues = [...found.issues];
  const priorLimited = previous?.limited === true;
  let scannedBytes = 0, scannedFiles = 0, nextCursor: string | null = null;
  const needle = input.caseSensitive ? input.query : input.query.toLowerCase();
  while (index < found.files.length) {
    signal?.throwIfAborted();
    const file = found.files[index]!;
    if (input.pathFilter && !file.path.toLowerCase().includes(input.pathFilter.toLowerCase())) { index++; afterLine = 0; continue; }
    if (scannedFiles >= 128 || (scannedBytes + file.size > MAX_SCAN_BYTES && scannedFiles > 0)) {
      nextCursor = cursor({ signature, version: found.version, limited: priorLimited || issues.length > 0, index, line: afterLine }); break;
    }
    const matches: Array<{ path: string; line: number; text: string; sha256: string }> = [];
    let extra = false;
    try {
      const meta = await scanText(root, file.path, (text, number) => {
        if (number <= afterLine || !(input.caseSensitive ? text : text.toLowerCase()).includes(needle)) return;
        if (results.length + matches.length >= maximum) { extra = true; return; }
        const position = (input.caseSensitive ? text : text.toLowerCase()).indexOf(needle);
        matches.push({ path: file.path, line: number, text: text.slice(Math.max(0, position - 120), position + 380), sha256: '' });
      }, signal);
      if (previous && index === previous.index && previous.sha256 && previous.sha256 !== meta.sha256) failure('SEARCH_CURSOR_STALE', 'File changed between search pages.');
      scannedBytes += meta.size;
      results.push(...matches.map(match => ({ ...match, sha256: meta.sha256 })));
      if (extra) { nextCursor = cursor({ signature, version: found.version, limited: priorLimited || issues.length > 0, index, line: matches.at(-1)?.line || afterLine, sha256: meta.sha256 }); break; }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ProjectFileAccessError && error.code === 'SEARCH_CURSOR_STALE') throw error;
      issues.push({ path: file.path, reason: error instanceof ProjectFileAccessError ? error.code : 'unreadable' });
    }
    scannedFiles++; index++; afterLine = 0;
    if (results.length >= maximum && index < found.files.length) { nextCursor = cursor({ signature, version: found.version, limited: priorLimited || issues.length > 0, index, line: 0 }); break; }
  }
  return { query: input.query, results, nextCursor, visited: found.visits, scannedFiles, scannedBytes, excluded: found.excluded,
    truncated: !!nextCursor || priorLimited || issues.length > 0, coverage: nextCursor ? 'more_pages' : priorLimited || issues.length ? 'limited' : 'complete_for_searchable_files',
    skipped: issues.slice(0, 50), skippedCount: issues.length, readOnly: true as const };
}

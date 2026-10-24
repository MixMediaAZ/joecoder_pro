import fs from 'node:fs/promises';
import path from 'node:path';

const HIDDEN_DIRECTORIES = new Set(['.git', '.jc', 'node_modules']);
const MAX_DIRECTORY_ENTRIES = 1000;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_VISITS = 20_000;
const MAX_SEARCH_DEPTH = 16;
export const MAX_PREVIEW_BYTES = 256 * 1024;

export type ProjectFileKind = 'directory' | 'file';

export interface ProjectFileEntry {
  name: string;
  path: string;
  type: ProjectFileKind;
  size: number | null;
  extension: string;
  protected: boolean;
}

export interface ProjectDirectoryListing {
  directory: string;
  entries: ProjectFileEntry[];
  query: string | null;
  truncated: boolean;
  skipped: number;
  readOnly: true;
}

export interface ProjectFilePreview {
  path: string;
  name: string;
  extension: string;
  size: number;
  content: string;
  lineCount: number;
  truncated: boolean;
  readOnly: true;
}

export class ProjectFileAccessError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = 'ProjectFileAccessError';
  }
}

function slash(value: string): string {
  return value.replace(/\\/g, '/');
}

export function sensitiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === '.env' ||
    lower.startsWith('.env.') ||
    lower === '.npmrc' ||
    lower === '.pypirc' ||
    lower === 'credentials.json' ||
    lower === 'service-account.json' ||
    lower === 'id_rsa' ||
    lower === 'id_ed25519' ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key') ||
    lower.startsWith('secrets.');
}

function normalizeRelativePath(value: string, allowRoot: boolean): string {
  const input = String(value || '').trim();
  if (!input && allowRoot) return '';
  const forward = slash(input);
  if (
    !forward ||
    path.isAbsolute(input) ||
    path.posix.isAbsolute(forward) ||
    /^[a-zA-Z]:(\/|$)/.test(forward) ||
    forward.includes('\0')
  ) {
    throw new ProjectFileAccessError('INVALID_PROJECT_PATH', 400, 'Choose a project-relative path.');
  }
  const segments = forward.split('/').filter(Boolean);
  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new ProjectFileAccessError('PROJECT_PATH_ESCAPE', 403, 'That path leaves the selected project.');
  }
  if (segments.some(segment => HIDDEN_DIRECTORIES.has(segment.toLowerCase()))) {
    throw new ProjectFileAccessError('PROTECTED_PROJECT_PATH', 403, 'That protected project folder is not available in Files.');
  }
  return segments.join('/');
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function resolveExistingPath(projectRoot: string, relativePath: string, allowRoot: boolean) {
  const normalized = normalizeRelativePath(relativePath, allowRoot);
  const root = await fs.realpath(path.resolve(projectRoot));
  const candidate = normalized ? path.resolve(root, normalized) : root;
  if (!pathInside(root, candidate)) {
    throw new ProjectFileAccessError('PROJECT_PATH_ESCAPE', 403, 'That path leaves the selected project.');
  }
  let real: string;
  let stat;
  try {
    const directStat = await fs.lstat(candidate);
    if (directStat.isSymbolicLink()) {
      throw new ProjectFileAccessError('SYMLINK_NOT_BROWSABLE', 403, 'Linked files and folders are not browsable.');
    }
    real = await fs.realpath(candidate);
    stat = await fs.stat(real);
  } catch (error) {
    if (error instanceof ProjectFileAccessError) throw error;
    throw new ProjectFileAccessError('PROJECT_FILE_NOT_FOUND', 404, 'That file or folder no longer exists.');
  }
  if (!pathInside(root, real)) {
    throw new ProjectFileAccessError('PROJECT_PATH_ESCAPE', 403, 'That linked path leaves the selected project.');
  }
  return { root, real, normalized, stat };
}

async function entryFromDirent(
  directory: string,
  baseRelative: string,
  entry: import('node:fs').Dirent
): Promise<ProjectFileEntry | null> {
  if (entry.isSymbolicLink()) return null;
  if (entry.isDirectory() && HIDDEN_DIRECTORIES.has(entry.name.toLowerCase())) return null;
  if (!entry.isDirectory() && !entry.isFile()) return null;
  const relative = slash(path.join(baseRelative, entry.name));
  let size: number | null = null;
  if (entry.isFile()) {
    try { size = (await fs.stat(path.join(directory, entry.name))).size; } catch { return null; }
  }
  return {
    name: entry.name,
    path: relative,
    type: entry.isDirectory() ? 'directory' : 'file',
    size,
    extension: entry.isFile() ? path.extname(entry.name).toLowerCase() : '',
    protected: entry.isFile() && sensitiveName(entry.name)
  };
}

function sortEntries(entries: ProjectFileEntry[]): ProjectFileEntry[] {
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

async function searchProject(root: string, query: string): Promise<ProjectDirectoryListing> {
  const results: ProjectFileEntry[] = [];
  const queue: Array<{ full: string; relative: string; depth: number }> = [{ full: root, relative: '', depth: 0 }];
  let visits = 0;
  let skipped = 0;

  while (queue.length && results.length < MAX_SEARCH_RESULTS && visits < MAX_SEARCH_VISITS) {
    const current = queue.shift()!;
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(current.full, { withFileTypes: true }); } catch { skipped++; continue; }
    for (const entry of entries) {
      visits++;
      if (visits >= MAX_SEARCH_VISITS || results.length >= MAX_SEARCH_RESULTS) break;
      if (entry.isSymbolicLink()) { skipped++; continue; }
      if (entry.isDirectory()) {
        if (HIDDEN_DIRECTORIES.has(entry.name.toLowerCase())) { skipped++; continue; }
        if (current.depth < MAX_SEARCH_DEPTH) {
          queue.push({
            full: path.join(current.full, entry.name),
            relative: slash(path.join(current.relative, entry.name)),
            depth: current.depth + 1
          });
        } else skipped++;
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = slash(path.join(current.relative, entry.name));
      if (!relative.toLowerCase().includes(query)) continue;
      const item = await entryFromDirent(current.full, current.relative, entry);
      if (item) results.push(item);
    }
  }

  return {
    directory: '',
    entries: sortEntries(results),
    query,
    truncated: results.length >= MAX_SEARCH_RESULTS || visits >= MAX_SEARCH_VISITS,
    skipped,
    readOnly: true
  };
}

export async function listProjectFiles(
  projectRoot: string,
  relativePath = '',
  search = ''
): Promise<ProjectDirectoryListing> {
  const rootInfo = await resolveExistingPath(projectRoot, '', true);
  const query = String(search || '').trim().toLowerCase().slice(0, 120);
  if (query) return searchProject(rootInfo.root, query);

  const target = await resolveExistingPath(rootInfo.root, relativePath, true);
  if (!target.stat.isDirectory()) {
    throw new ProjectFileAccessError('PROJECT_DIRECTORY_REQUIRED', 400, 'Choose a folder to browse.');
  }
  const raw = await fs.readdir(target.real, { withFileTypes: true });
  const entries: ProjectFileEntry[] = [];
  let skipped = 0;
  for (const dirent of raw.slice(0, MAX_DIRECTORY_ENTRIES + 1)) {
    const entry = await entryFromDirent(target.real, target.normalized, dirent);
    if (entry) entries.push(entry); else skipped++;
  }
  return {
    directory: target.normalized,
    entries: sortEntries(entries.slice(0, MAX_DIRECTORY_ENTRIES)),
    query: null,
    truncated: raw.length > MAX_DIRECTORY_ENTRIES,
    skipped,
    readOnly: true
  };
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let controls = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) controls++;
  }
  return sample.length > 0 && controls / sample.length > 0.02;
}

export async function previewProjectFile(
  projectRoot: string,
  relativePath: string
): Promise<ProjectFilePreview> {
  const target = await resolveExistingPath(projectRoot, relativePath, false);
  if (!target.stat.isFile()) {
    throw new ProjectFileAccessError('PROJECT_FILE_REQUIRED', 400, 'Choose a file to preview.');
  }
  if (sensitiveName(path.basename(target.normalized))) {
    throw new ProjectFileAccessError(
      'SENSITIVE_FILE_PREVIEW_BLOCKED',
      403,
      'This file may contain secrets, so Joe will not place it in the preview surface.'
    );
  }
  const readLength = Math.min(target.stat.size, MAX_PREVIEW_BYTES + 1);
  const handle = await fs.open(target.real, 'r');
  let buffer: Buffer;
  try {
    buffer = Buffer.alloc(readLength);
    const result = await handle.read(buffer, 0, readLength, 0);
    buffer = buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
  if (looksBinary(buffer)) {
    throw new ProjectFileAccessError(
      'BINARY_FILE_PREVIEW_BLOCKED',
      415,
      'Binary files are not shown in the text preview.'
    );
  }
  const truncated = target.stat.size > MAX_PREVIEW_BYTES;
  const visible = truncated ? buffer.subarray(0, MAX_PREVIEW_BYTES) : buffer;
  const content = visible.toString('utf8');
  return {
    path: target.normalized,
    name: path.basename(target.normalized),
    extension: path.extname(target.normalized).toLowerCase(),
    size: target.stat.size,
    content,
    lineCount: content ? content.split(/\r?\n/).length : 0,
    truncated,
    readOnly: true
  };
}

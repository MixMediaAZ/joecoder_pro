import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { previewProjectFile, sensitiveName, ProjectFileAccessError } from './projectExplorer.js';

const execute = promisify(execFile);
async function git(root: string, args: string[]) {
  try {
    const result = await execute('git', ['--no-pager', ...args], {
      cwd: root, windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
    });
    return result.stdout;
  } catch (error) {
    const detail = error as Error & { code?: string | number; stderr?: string };
    const reason = String(detail.stderr || detail.message).slice(0, 1500);
    console.warn('[workspace.git] Read failed:', detail.code, reason);
    throw new ProjectFileAccessError('GIT_REVIEW_UNAVAILABLE', 422, `Git review is unavailable: ${reason}`);
  }
}
export function reviewablePath(relative: string): boolean {
  const parts = relative.replace(/\\/g, '/').split('/');
  return Boolean(relative) && !path.isAbsolute(relative) && !relative.includes(':') &&
    parts.every(part => part && part !== '.' && part !== '..' && !['.git', '.jc', 'node_modules'].includes(part.toLowerCase()) && !sensitiveName(part));
}
export async function listProjectChanges(root: string) {
  const [changed, untracked] = await Promise.all([
    git(root, ['diff', '--relative', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD', '--', '.']),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.'])
  ]);
  const files = [...new Set([...changed.split('\0'), ...untracked.split('\0')].filter(reviewablePath))];
  return { files: files.slice(0, 500).map(file => ({ path: file, untracked: untracked.split('\0').includes(file) })), truncated: files.length > 500, baseline: 'HEAD', readOnly: true };
}
export async function readProjectDiff(root: string, relative: string) {
  if (!reviewablePath(relative)) throw new ProjectFileAccessError('DIFF_PATH_BLOCKED', 403, 'This path is not available for review.');
  // Reuse containment, symlink, binary and sensitive-file checks. Deleted files
  // cannot be opened through this surface; no fallback may bypass those checks.
  const preview = await previewProjectFile(root, relative);
  if (preview.truncated) throw new ProjectFileAccessError('DIFF_TOO_LARGE', 413, 'This file exceeds the safe review size.');
  const tracked = await git(root, ['ls-files', '-z', '--', relative]);
  const diff = tracked ? await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', 'HEAD', '--', relative])
    : `New untracked file: ${relative}\n${preview.content.split('\n').map(line => `+${line}`).join('\n')}`;
  return { path: relative, diff, currentSha256: createHash('sha256').update(preview.content).digest('hex'), baseline: tracked ? 'HEAD' : 'untracked', readOnly: true };
}

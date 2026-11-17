import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkWorkflow } from './agentWorkflowBudget.js';

// This checks repository source, not every output file and not files outside the selected project.
const generated = new Set(['.git', '.jc', 'node_modules', '.next', 'dist', 'build', 'coverage', 'vendor',
  '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.nox', '.hypothesis', '.cache', '.snapshots', '.artifacts', '.aws', '.ssh', '.azure']);
const sourceName = /\.(?:[cm]?[jt]sx?|json|py|rb|go|rs|java|cs|cpp|c|h|css|scss|html|vue|svelte|ya?ml|toml|xml|md|sql|ps1|bat|sh)$/i;
export async function sourceVersions(root: string): Promise<Record<string, string>> {
  const versions: Record<string, string> = {};
  let entries = 0, totalBytes = 0;
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 32) throw new Error('SOURCE_CHECK_LIMIT: source depth exceeds 32.');
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      checkWorkflow();
      if (++entries > 20_000) throw new Error('SOURCE_CHECK_LIMIT: source inventory exceeds 20000 entries.');
      if (generated.has(entry.name.toLowerCase()) || /^\.env(?:\.|$)/i.test(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await walk(full, depth + 1); continue; }
      if (!entry.isFile() || !sourceName.test(entry.name)) continue;
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) throw new Error('SOURCE_CHECK_LINK: source link changed.');
      totalBytes += stat.size;
      if (stat.size > 16 * 1024 * 1024 || totalBytes > 512 * 1024 * 1024) throw new Error('SOURCE_CHECK_LIMIT: source byte limit reached.');
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(full)) digest.update(chunk);
      const after = await fs.lstat(full);
      if (after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
        throw new Error('SOURCE_CHECK_CONFLICT: source changed while its version was captured.');
      }
      versions[path.relative(root, full).replace(/\\/g, '/')] = digest.digest('hex');
    }
  }
  await walk(path.resolve(root), 0);
  return versions;
}
export function changedSources(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]).sort();
}

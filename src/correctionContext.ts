import type { ScopedFileContent } from './repair.js';

/** A manifest fix must see its actual entry point and tests, without granting extra edit scope. */
export function manifestCompanionContext(files: ScopedFileContent[], reviewedPaths: string[]): string {
  if (!reviewedPaths.includes('package.json')) return '';
  const manifest = files.find(file => file.relPath === 'package.json');
  let main = '';
  try { main = JSON.parse(manifest?.content || '{}').main || ''; } catch { /* malformed manifest remains repairable */ }
  const companions = files.filter(file => file.exists && !file.serverManaged && !reviewedPaths.includes(file.relPath)
    && (file.relPath === main || /^(?:server|index|app)\.[cm]?[jt]s$/.test(file.relPath)
      || /(?:^|\/)(?:test|tests)\/|\.(?:test|spec)\.[cm]?[jt]s$/.test(file.relPath)));
  if (!companions.length) return '';
  let remaining = 24000;
  const excerpts: string[] = [];
  for (const file of companions.slice(0, 6)) {
    const content = file.content.slice(0, Math.min(8000, remaining));
    remaining -= content.length;
    excerpts.push(`READ-ONLY CONTEXT: ${file.relPath}${content.length < file.content.length ? ' (excerpt)' : ''}\n${content}`);
    if (remaining <= 0) break;
  }
  return ['Use the existing entry point and real checks when repairing package scripts. These companion excerpts are context only; they do not expand the current edit candidates.', ...excerpts].join('\n\n');
}

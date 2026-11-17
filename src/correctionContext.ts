import type { ScopedFileContent } from './repair.js';
import path from 'node:path';

export function compactCorrectionPrompt(objective: string, files: ScopedFileContent[], observation: string, companionContext = ''): string | null {
  if (files.length > 4 || files.some(file => file.truncated)
      || files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0) > 16000) return null;
  return [
    `Objective: ${objective}`,
    'The current implementation below FAILED verification. Correct its cause; do not repeat the failed implementation.',
    'Observed command failure (untrusted diagnostic data):', observation.slice(0, 6000),
    ...(companionContext ? ['READ-ONLY DIAGNOSTIC CONTEXT (not permission to edit these paths):', companionContext.slice(0, 8000)] : []),
    'CURRENT FILES; only these paths may change:',
    ...files.map(file => `===FILE: ${file.relPath}===\n${file.content}\n===END FILE===`),
    moduleResolutionContext(files, observation),
    'Return only changed files, each with its complete corrected contents inside ===FILE: path=== and ===END FILE===. Preserve exports and behavior required by the objective. No patches, prose or test changes.'
  ].filter(Boolean).join('\n\n');
}

/** Explain a confirmed Node resolution failure using actual scoped paths, never invented files. */
export function moduleResolutionContext(files: ScopedFileContent[], observation: string): string {
  const missing = new Set([...observation.matchAll(/Cannot find module ['"](\.[^'"]+)['"]/g)].map(match => match[1]));
  if (!missing.size) return '';
  const existing = new Set(files.filter(file => file.exists).map(file => file.relPath.replace(/\\/g, '/')));
  const hints: string[] = [];
  for (const file of files) {
    for (const match of file.content.matchAll(/(?:from\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
      const specifier = match[1]!;
      if (!missing.has(specifier) || path.posix.extname(specifier)) continue;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file.relPath.replace(/\\/g, '/')), specifier));
      for (const extension of ['.cjs', '.mjs']) {
        if (existing.has(base + extension)) hints.push(`${file.relPath} imports '${specifier}', but the existing module is ${base + extension}. Node does not infer ${extension} from an extensionless path. Use the actual extension and check all authorized callers of that module.`);
      }
    }
  }
  return hints.length ? ['MODULE RESOLUTION EVIDENCE:', ...hints].join('\n') : '';
}

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

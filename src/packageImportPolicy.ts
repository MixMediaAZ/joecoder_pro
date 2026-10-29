/**
 * Fail closed when model edits invent bare package imports that package.json
 * does not declare. G2e built cleanly with esbuild --packages=external, then
 * production start died on `import … from 'uuid'` with uuid never declared.
 */

import { builtinModules } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProposedEdit } from './mutation.js';

const BARE_IMPORT =
  /(?:(?:import|export)\s+(?:[^'"\n]+?\s+from\s+)?|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`)
]);

export function packageRootName(specifier: string): string | null {
  const trimmed = specifier.trim();
  if (!trimmed || trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.startsWith('node:')) {
    return null;
  }
  if (NODE_BUILTINS.has(trimmed) || NODE_BUILTINS.has(trimmed.replace(/^node:/, ''))) {
    return null;
  }
  if (trimmed.startsWith('@')) {
    const parts = trimmed.split('/');
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return trimmed.split('/')[0] || null;
}

/** Drop comments so JSDoc `import('pkg')` type hints are not treated as runtime deps. */
function stripCommentsForImportScan(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

export function extractBarePackageNames(source: string): string[] {
  const found = new Set<string>();
  const code = stripCommentsForImportScan(source);
  BARE_IMPORT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BARE_IMPORT.exec(code))) {
    const root = packageRootName(match[1] || '');
    if (root) found.add(root);
  }
  return [...found].sort();
}

export function declaredPackageNames(packageJsonText: string): Set<string> {
  const declared = new Set<string>();
  let parsed: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  try {
    parsed = JSON.parse(packageJsonText) as typeof parsed;
  } catch {
    return declared;
  }
  for (const bag of [
    parsed.dependencies,
    parsed.devDependencies,
    parsed.optionalDependencies,
    parsed.peerDependencies
  ]) {
    for (const name of Object.keys(bag || {})) declared.add(name);
  }
  return declared;
}

export function undeclaredPackageImportsInSource(
  source: string,
  declared: Set<string>
): string[] {
  return extractBarePackageNames(source).filter((name) => !declared.has(name));
}

/** Declared packages that are suitable for ZIP upload/extract (G2p guidance). */
const UPLOAD_HELPER_PACKAGES = [
  'jszip',
  'multer',
  'adm-zip',
  'yauzl',
  'yazl',
  'fflate',
  'unzipper',
  'archiver',
  'busboy',
  'formidable'
] as const;

export function declaredUploadHelperPackages(declared: Set<string> | string): string[] {
  const set = typeof declared === 'string' ? declaredPackageNames(declared) : declared;
  return UPLOAD_HELPER_PACKAGES.filter((name) => set.has(name));
}

/** Reject edits that introduce bare imports absent from the governing package.json. */
export function rejectUndeclaredPackageImports(
  edits: ProposedEdit[],
  packageJsonText: string | null | undefined
): ProposedEdit[] {
  if (!packageJsonText) return edits;
  const declared = declaredPackageNames(packageJsonText);
  // Apply package.json edit first so a same-batch dependency add can authorize new imports.
  const packageEdit = edits.find((edit) => /(^|\/)package\.json$/i.test(edit.relPath.replace(/\\/g, '/')));
  if (packageEdit) {
    for (const name of declaredPackageNames(packageEdit.content)) declared.add(name);
  }
  const violations: string[] = [];
  for (const edit of edits) {
    const rel = edit.relPath.replace(/\\/g, '/');
    if (!/\.(?:[cm]?[jt]sx?)$/i.test(rel)) continue;
    if (/(^|\/)package\.json$/i.test(rel)) continue;
    for (const name of undeclaredPackageImportsInSource(edit.content, declared)) {
      violations.push(`${rel} -> ${name}`);
    }
  }
  if (violations.length) {
    const helpers = declaredUploadHelperPackages(declared);
    const helperHint = helpers.length
      ? ` For ZIP upload/extract use already-declared packages only: ${helpers.join(', ')}.`
      : ' Prefer node: builtins or packages already listed in package.json.';
    throw new Error(
      `EDIT_UNDECLARED_PACKAGE_IMPORT: edits import packages not declared in package.json: ${violations.join('; ')}.` +
      `${helperHint} Do not invent undeclared packages (for example unzipper, archiver, @libsql/client) unless package.json is edited in the same response to add them.`
    );
  }
  return edits;
}

export async function findUndeclaredImportsInProjectFiles(
  projectRoot: string,
  relPaths: string[]
): Promise<{ undeclared: Array<{ file: string; packageName: string }>; packageJsonPath: string | null }> {
  const root = path.resolve(projectRoot);
  let packageJsonText: string | null = null;
  let packageJsonPath: string | null = null;
  for (const candidate of ['package.json', ...relPaths.filter((rel) => /(^|\/)package\.json$/i.test(rel))]) {
    try {
      const abs = path.join(root, candidate);
      packageJsonText = await fs.readFile(abs, 'utf8');
      packageJsonPath = candidate.replace(/\\/g, '/');
      break;
    } catch {
      // try next
    }
  }
  if (!packageJsonText) {
    return { undeclared: [], packageJsonPath: null };
  }
  const declared = declaredPackageNames(packageJsonText);
  const undeclared: Array<{ file: string; packageName: string }> = [];
  const seen = new Set<string>();
  for (const rel of relPaths) {
    const normalized = rel.replace(/\\/g, '/');
    if (!/\.(?:[cm]?[jt]sx?)$/i.test(normalized)) continue;
    let source: string;
    try {
      source = await fs.readFile(path.join(root, normalized), 'utf8');
    } catch {
      continue;
    }
    for (const name of undeclaredPackageImportsInSource(source, declared)) {
      const key = `${normalized}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      undeclared.push({ file: normalized, packageName: name });
    }
  }
  return { undeclared, packageJsonPath };
}

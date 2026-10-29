/**
 * Offline dependency-consistency diagnosis for the read-only survey.
 *
 * Why this exists: a Stage 2 qualification run failed honestly because planning was blind.
 * The operator's request was "dependencies won't install"; the survey put nothing in
 * `Findings — broken`, so the local model scoped a stale nested pubspec.yaml, proposed a
 * byte-identical edit, and the job failed safe. The real cause sat in the root manifest:
 * `file_selector: ^3.0.0` — a version that has never been published.
 *
 * Read-only inspection cannot run installers to reproduce the failure: pub/npm hit the network,
 * and survey law is loopback-only with no writes. But the project's own committed lockfile
 * records what actually resolved the last time installation succeeded. A manifest constraint the
 * lockfile contradicts is provable with pure file reads — no network, no execution, no writes.
 *
 * Everything here is deliberately tolerant: these are evidence strings for planning, not a
 * resolver. A file this module cannot parse produces no finding rather than a false one.
 */

export interface ManifestFile {
  /** Project-relative path with forward slashes. */
  path: string;
  content: string;
}

export interface DependencyDiagnosis {
  broken: string[];
  questionable: string[];
  /** Manifest paths a broken finding identifies as the file to correct. */
  targets: string[];
}

interface ParsedDeclaration {
  name: string;
  constraint: string;
}

/** Depth of a relative path; the root manifest is the one the toolchain actually reads. */
function depth(rel: string): number {
  return rel.split('/').filter(Boolean).length;
}

function firstMajor(version: string): number | null {
  const match = version.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * Parse `dependencies:` / `dev_dependencies:` blocks of a pubspec without a YAML library.
 * Only simple `name: constraint` string entries are considered; structured entries (git:, path:,
 * sdk:) carry no registry constraint to check and are skipped.
 */
export function parsePubspecDeclarations(content: string): ParsedDeclaration[] {
  const declarations: ParsedDeclaration[] = [];
  const lines = content.split(/\r?\n/);
  let inBlock = false;
  for (const line of lines) {
    if (/^(dependencies|dev_dependencies):\s*$/.test(line)) { inBlock = true; continue; }
    if (/^\S/.test(line) && line.trim() !== '') { inBlock = false; continue; }
    if (!inBlock) continue;
    const entry = line.match(/^ {2}([A-Za-z0-9_]+):\s*(["']?)([^"'#\s][^"'#]*)\2\s*(#.*)?$/);
    if (!entry) continue;
    const name = entry[1]!;
    const constraint = entry[3]!.trim();
    if (name === 'flutter' || name === 'sdk') continue;
    if (!/\d/.test(constraint)) continue;
    declarations.push({ name, constraint });
  }
  return declarations;
}

/** Parse resolved versions out of a pubspec.lock: `  name:` ... `    version: "1.1.0"`. */
export function parsePubspecLockVersions(content: string): Map<string, string> {
  const versions = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  let currentPackage: string | null = null;
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
    if (inPackages && /^\S/.test(line) && line.trim() !== '') { inPackages = false; }
    if (!inPackages) continue;
    const pkg = line.match(/^ {2}([A-Za-z0-9_]+):\s*$/);
    if (pkg) { currentPackage = pkg[1]!; continue; }
    const version = line.match(/^ {4}version:\s*"([^"]+)"/);
    if (version && currentPackage) versions.set(currentPackage, version[1]!);
  }
  return versions;
}

function parseJsonSafe(content: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(content);
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Resolved versions from package-lock.json (v2/v3 `packages` preferred, v1 `dependencies` fallback). */
export function parseNpmLockVersions(content: string): Map<string, string> {
  const versions = new Map<string, string>();
  const lock = parseJsonSafe(content);
  if (!lock) return versions;
  const packages = lock.packages as Record<string, { version?: string }> | undefined;
  if (packages) {
    for (const [key, meta] of Object.entries(packages)) {
      const name = key.replace(/^node_modules\//, '');
      if (name && meta?.version) versions.set(name, meta.version);
    }
  }
  const legacy = lock.dependencies as Record<string, { version?: string }> | undefined;
  if (legacy) {
    for (const [name, meta] of Object.entries(legacy)) {
      if (!versions.has(name) && meta?.version) versions.set(name, meta.version);
    }
  }
  return versions;
}

function diagnoseDeclarations(
  manifestPath: string,
  lockPath: string | null,
  declared: ParsedDeclaration[],
  locked: Map<string, string> | null,
  out: DependencyDiagnosis
): void {
  if (!declared.length) return;
  if (!locked || !lockPath) {
    out.questionable.push(
      `${manifestPath} declares ${declared.length} version-constrained dependencies but no lockfile was found — resolution cannot be verified offline`
    );
    return;
  }
  for (const declaration of declared) {
    const resolved = locked.get(declaration.name);
    const declaredMajor = firstMajor(declaration.constraint);
    if (resolved === undefined) {
      out.questionable.push(
        `${manifestPath} declares ${declaration.name} (${declaration.constraint}) but ${lockPath} has no resolution for it — the constraint may never have resolved`
      );
      continue;
    }
    const resolvedMajor = firstMajor(resolved);
    if (declaredMajor === null || resolvedMajor === null) continue;
    // A caret constraint pins its major, so a locked resolution on a DIFFERENT major contradicts
    // it in either direction. The first live run only caught declared > locked; the same project
    // then failed on audioplayers ^0.23.1 with the lock proving 6.7.1 — declared BELOW the lock,
    // equally unresolvable, invisible to the one-sided rule. For non-caret ranges only the
    // declared-above case is provably wrong offline (a floor like >=0.5 can still reach 6.x).
    const caret = declaration.constraint.startsWith('^');
    const contradicted = caret ? declaredMajor !== resolvedMajor : declaredMajor > resolvedMajor;
    if (contradicted) {
      out.broken.push(
        `Dependency install cannot succeed: ${manifestPath} demands ${declaration.name} ${declaration.constraint}, but the committed ${lockPath} resolved ${declaration.name} ${resolved}. ` +
        `The declared constraint pins major ${declaredMajor} while the lock proves major ${resolvedMajor} is what actually resolves here; the constraint in ${manifestPath} is the file to correct (align it with the locked version, e.g. ^${resolved}).`
      );
      if (!out.targets.includes(manifestPath)) out.targets.push(manifestPath);
    }
  }
}

/**
 * Cross-check manifests against their lockfiles. Pass every candidate manifest/lock the survey
 * inventory found; the shallowest manifest of each ecosystem is treated as the root the
 * toolchain reads, and deeper ones are flagged so a planner does not mistake them for it.
 */
export function diagnoseDependencyConsistency(files: ManifestFile[]): DependencyDiagnosis {
  const out: DependencyDiagnosis = { broken: [], questionable: [], targets: [] };
  const byName = (name: string) => files
    .filter((file) => file.path.split('/').pop() === name)
    .sort((a, b) => depth(a.path) - depth(b.path));

  const pubspecs = byName('pubspec.yaml');
  const pubLocks = byName('pubspec.lock');
  if (pubspecs.length) {
    const root = pubspecs[0]!;
    const lock = pubLocks[0] ?? null;
    diagnoseDeclarations(
      root.path,
      lock ? lock.path : null,
      parsePubspecDeclarations(root.content),
      lock ? parsePubspecLockVersions(lock.content) : null,
      out
    );
    for (const nested of pubspecs.slice(1)) {
      out.questionable.push(
        `Nested manifest ${nested.path} exists but the toolchain reads ${root.path} — dependency fixes belong in the root manifest`
      );
    }
  }

  const packageJsons = byName('package.json');
  const npmLocks = byName('package-lock.json');
  if (packageJsons.length) {
    const root = packageJsons[0]!;
    const parsed = parseJsonSafe(root.content);
    if (parsed) {
      const declared: ParsedDeclaration[] = [];
      for (const key of ['dependencies', 'devDependencies'] as const) {
        const block = parsed[key] as Record<string, string> | undefined;
        if (!block) continue;
        for (const [name, constraint] of Object.entries(block)) {
          if (typeof constraint === 'string' && /\d/.test(constraint)) declared.push({ name, constraint });
        }
      }
      const lock = npmLocks[0] ?? null;
      diagnoseDeclarations(
        root.path,
        lock ? lock.path : null,
        declared,
        lock ? parseNpmLockVersions(lock.content) : null,
        out
      );
    }
  }

  diagnoseCssToolchainConsistency(files, out);
  return out;
}

const SCRIPT_ENTRY_RE = /(?:^|[\s"'`=])((?:\.\/)?(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs))\b/g;
/** Build outputs are emitted by toolchain scripts — never model-authored evidence creates (G2v). */
const BUILD_OUTPUT_ENTRY_RE = /^(?:dist|build|out|\.next|coverage)(?:\/|$)/i;

export function isBuildOutputPath(relPath: string): boolean {
  return BUILD_OUTPUT_ENTRY_RE.test(relPath.replace(/\\/g, '/').replace(/^\.\//, ''));
}

/**
 * G2l: InspectorCode scripts.build/dev reference server/index.ts, but that file is absent.
 * CSS script-protection correctly blocked esm→cjs theater; without sealing the missing entry
 * as a createable evidence target, build cannot go green after a correct Tailwind pin.
 *
 * G2v: scripts.start often points at dist/index.js. Recording that path as an evidence target
 * forced the model to hand-author build output alongside package.json/server creates and burned
 * the batch on EDIT_MISSES_EVIDENCE_TARGET. Keep the broken finding, but do not seal dist/build
 * outputs as model create targets — create the source entry and let build emit them.
 */
export function diagnoseMissingScriptEntrypoints(
  packageJsonContent: string,
  inventoryRelPaths: Iterable<string>,
  out: DependencyDiagnosis = { broken: [], questionable: [], targets: [] }
): DependencyDiagnosis {
  const parsed = parseJsonSafe(packageJsonContent);
  const scripts = parsed?.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return out;
  const inventory = new Set(
    [...inventoryRelPaths].map((rel) => rel.replace(/\\/g, '/').replace(/^\.\//, ''))
  );
  const seen = new Set<string>();
  for (const [scriptName, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    SCRIPT_ENTRY_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SCRIPT_ENTRY_RE.exec(value)) !== null) {
      const rel = (match[1] || '').replace(/\\/g, '/').replace(/^\.\//, '');
      if (!rel || rel.includes('node_modules') || seen.has(rel) || inventory.has(rel)) continue;
      seen.add(rel);
      if (isBuildOutputPath(rel)) {
        out.broken.push(
          `Runtime script scripts.${scriptName} references missing build output '${rel}'. ` +
          `Create or fix the source entry that build emits into '${rel}' (do not hand-write build output); ` +
          `do not rewrite scripts.* flags as a substitute.`
        );
        continue;
      }
      out.broken.push(
        `Runtime script scripts.${scriptName} references missing entry file '${rel}'. ` +
        `Create '${rel}' (or an equivalent in-scope entry) before build/start can succeed; ` +
        `do not rewrite scripts.* flags as a substitute.`
      );
      if (!out.targets.includes(rel)) out.targets.push(rel);
    }
  }
  return out;
}

/**
 * Detect the Tailwind v4 package paired with v3 PostCSS/CSS wiring that makes `vite build` fail
 * before application code runs. Pure file reads — no install, no Vite execution.
 */
export function diagnoseCssToolchainConsistency(
  files: ManifestFile[],
  out: DependencyDiagnosis = { broken: [], questionable: [], targets: [] }
): DependencyDiagnosis {
  const byBasename = (pattern: RegExp) => files
    .filter((file) => pattern.test(file.path.split('/').pop() || ''))
    .sort((a, b) => depth(a.path) - depth(b.path));

  const packageJson = byBasename(/^package\.json$/i)[0];
  if (!packageJson) return out;
  const parsed = parseJsonSafe(packageJson.content);
  if (!parsed) return out;

  let declaredConstraint: string | null = null;
  for (const key of ['dependencies', 'devDependencies'] as const) {
    const block = parsed[key] as Record<string, string> | undefined;
    if (block && typeof block.tailwindcss === 'string') {
      declaredConstraint = block.tailwindcss;
      break;
    }
  }
  const lock = byBasename(/^package-lock\.json$/i)[0];
  const lockedVersion = lock ? parseNpmLockVersions(lock.content).get('tailwindcss') : undefined;
  const major = firstMajor(lockedVersion || declaredConstraint || '');
  if (major === null) return out;

  const postcssConfigs = byBasename(/^postcss\.config\.(?:js|cjs|mjs|ts)$/i);
  const cssSamples = byBasename(/\.(?:css|scss)$/i);
  const usesV3PostcssPlugin = postcssConfigs.some((file) =>
    /(?:^|[^\w])tailwindcss\s*:\s*\{/.test(file.content)
    || /(?:require|from)\s*\(?['"]tailwindcss['"]\)?/.test(file.content)
  );
  const usesV4PostcssPlugin = postcssConfigs.some((file) =>
    /@tailwindcss\/postcss/.test(file.content)
  );
  const usesV3Directives = cssSamples.some((file) =>
    /@tailwind\s+(?:base|components|utilities)\b/.test(file.content)
  );
  const usesV4Import = cssSamples.some((file) =>
    /@import\s+["']tailwindcss["']/.test(file.content)
  );

  if (major >= 4 && (usesV3PostcssPlugin || (usesV3Directives && !usesV4Import && !usesV4PostcssPlugin))) {
    const postcssPath = postcssConfigs[0]?.path;
    const surfaces = [packageJson.path, ...(postcssPath ? [postcssPath] : [])].join(' and ');
    out.broken.push(
      `CSS build cannot succeed: ${packageJson.path} resolves tailwindcss ${lockedVersion || declaredConstraint} (major ${major}), ` +
      `but the project still uses Tailwind v3 PostCSS/CSS wiring` +
      `${postcssPath ? ` in ${postcssPath}` : ''}` +
      `${usesV3Directives ? ' with @tailwind directives' : ''}. ` +
      `Correct ${surfaces}: either pin tailwindcss to v3 matching the existing PostCSS plugin form, ` +
      `or migrate PostCSS/CSS to the Tailwind v4 plugin and import style.`
    );
    if (!out.targets.includes(packageJson.path)) out.targets.push(packageJson.path);
    if (postcssPath && !out.targets.includes(postcssPath)) out.targets.push(postcssPath);
  }

  return out;
}

function dependencyBag(manifest: Record<string, unknown>, name: string): string | null {
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const block = manifest[key] as Record<string, string> | undefined;
    if (block && typeof block[name] === 'string') return block[name];
  }
  return null;
}

/**
 * G2i wrote a 1-line package.json "fix" that left Tailwind v4 + @tailwindcss/vite in place,
 * then lock refresh produced an unadmissible nested optional tree. Require a real pin or v4 migrate.
 */
export function assertCssToolchainPackageJsonRepair(beforeText: string, afterText: string): void {
  const before = parseJsonSafe(beforeText);
  const after = parseJsonSafe(afterText);
  if (!before || !after) {
    throw new Error('EDIT_PACKAGE_JSON_INVALID: package.json edit must be valid JSON');
  }
  const beforeTw = dependencyBag(before, 'tailwindcss');
  const afterTw = dependencyBag(after, 'tailwindcss');
  const beforeMajor = firstMajor(beforeTw || '');
  const afterMajor = firstMajor(afterTw || '');
  if (beforeMajor === null || beforeMajor < 4) return;

  const beforeVite = Boolean(dependencyBag(before, '@tailwindcss/vite'));
  const afterVite = Boolean(dependencyBag(after, '@tailwindcss/vite'));
  const afterPostcssPlugin = Boolean(dependencyBag(after, '@tailwindcss/postcss'));

  if (afterPostcssPlugin) return;
  if (afterMajor !== null && afterMajor < 4) {
    if (beforeVite && afterVite) {
      throw new Error(
        'EDIT_CSS_TOOLCHAIN_INCOMPLETE: pinning tailwindcss to v3 also requires removing @tailwindcss/vite from package.json'
      );
    }
    return;
  }
  throw new Error(
    'EDIT_CSS_TOOLCHAIN_INCOMPLETE: recorded CSS evidence requires pinning tailwindcss to v3.x (and removing @tailwindcss/vite) or adding @tailwindcss/postcss for a v4 migration'
  );
}

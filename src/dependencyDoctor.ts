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
    if (declaredMajor !== null && resolvedMajor !== null && declaredMajor > resolvedMajor) {
      out.broken.push(
        `Dependency install cannot succeed: ${manifestPath} demands ${declaration.name} ${declaration.constraint}, but the committed ${lockPath} resolved ${declaration.name} ${resolved}. ` +
        `The declared major version ${declaredMajor} exceeds anything that has ever resolved here (${resolved}); the constraint in ${manifestPath} is the file to correct.`
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

  return out;
}

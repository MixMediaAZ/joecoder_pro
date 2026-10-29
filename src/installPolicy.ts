/**
 * Pure install-invalidation policy (v3 J2).
 * node_modules proof is valid only for the manifest/lock pair that produced it.
 */

export function normalizeRelPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

export function isManifestInstallPath(relPath: string): boolean {
  const base = normalizeRelPath(relPath).split('/').pop() || '';
  return /^(package\.json|package-lock\.json|npm-shrinkwrap\.json)$/i.test(base);
}

/** Lockfiles are sealed for install coherence but must not be model-loaded as ordinary source. */
export function isServerManagedLockfilePath(relPath: string): boolean {
  const base = normalizeRelPath(relPath).split('/').pop() || '';
  return /^(package-lock\.json|npm-shrinkwrap\.json)$/i.test(base);
}

export function appliedManifestPaths(appliedPaths: string[]): string[] {
  return appliedPaths.map(normalizeRelPath).filter(isManifestInstallPath);
}

/**
 * Decide whether a governed install must run before the next verification that
 * depends on node_modules.
 */
export function needsReinstall(options: {
  installAuthorized: boolean;
  dependencyFreeManifest?: boolean;
  appliedPaths: string[];
  lastInstallPassed: boolean | null;
  previousManifestHashes?: Record<string, string>;
  currentManifestHashes?: Record<string, string>;
}): boolean {
  if (!options.installAuthorized || options.dependencyFreeManifest) return false;
  if (options.lastInstallPassed !== true) return true;
  if (appliedManifestPaths(options.appliedPaths).length > 0) return true;
  const previous = options.previousManifestHashes || {};
  const current = options.currentManifestHashes || {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  for (const key of keys) {
    if ((previous[key] || '') !== (current[key] || '')) return true;
  }
  return false;
}

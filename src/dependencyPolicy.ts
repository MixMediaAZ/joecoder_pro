import type { PackageSummary } from './types.js';

/** Seal the npm-generated lockfile before authorization, never widen an active job. */
export function dependencyScope(plannedFiles: string[], installRequired: boolean): string[] {
  const normalized = plannedFiles.map(file => file.replace(/\\/g, '/').toLowerCase());
  return installRequired && normalized.includes('package.json') && !normalized.includes('package-lock.json')
    ? [...plannedFiles, 'package-lock.json']
    : [...plannedFiles];
}

export function needsDependencyInstall(
  intent: 'repair' | 'build',
  plannedFiles: string[],
  packageSummary: PackageSummary | null
): boolean {
  if (intent === 'build') {
    return plannedFiles.some((file) => file.replace(/\\/g, '/').toLowerCase() === 'package.json');
  }
  return Boolean(packageSummary && packageSummary.dependenciesCount + packageSummary.devDependenciesCount > 0);
}

import type { PackageSummary } from './types.js';

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

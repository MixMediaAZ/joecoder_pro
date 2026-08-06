import fs from 'fs/promises';
import path from 'path';
import type { BuildCondition, ContentSample, PackageSummary, SurveyFindings, SurveyResult } from './types.js';
import { discoverStackProfiles } from './stackProfiles.js';
import { diagnoseDependencyConsistency, type ManifestFile } from './dependencyDoctor.js';

async function readPackageSummary(projectRoot: string): Promise<PackageSummary | null> {
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const raw = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    return {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      dependenciesCount: pkg.dependencies ? Object.keys(pkg.dependencies).length : 0,
      devDependenciesCount: pkg.devDependencies ? Object.keys(pkg.devDependencies).length : 0,
      scripts: pkg.scripts ? Object.keys(pkg.scripts) : []
    };
  } catch {
    return null;
  }
}

function buildFindings(result: Omit<SurveyResult, 'findings' | 'buildCondition'>): {
  findings: SurveyFindings;
  buildCondition: BuildCondition;
} {
  const findings: SurveyFindings = {
    working: [],
    questionable: [],
    broken: [],
    mockOrPlaceholder: [],
    unknown: []
  };

  if (result.packageSummary) {
    findings.working.push(
      `Package identity: ${result.packageSummary.name || 'unnamed'}@${result.packageSummary.version || '?'}`
    );
    if (result.packageSummary.scripts.length > 0) {
      findings.working.push(`Scripts present: ${result.packageSummary.scripts.join(', ')}`);
    } else {
      findings.questionable.push('package.json has no scripts');
    }
    if (result.packageSummary.dependenciesCount + result.packageSummary.devDependenciesCount > 50) {
      findings.questionable.push(`Large dependency surface (${result.packageSummary.dependenciesCount + result.packageSummary.devDependenciesCount} total) — review for bloat/security`);
    }
  } else {
    findings.unknown.push('No package.json — project identity and dependency surface unknown');
  }

  if (result.keyFiles.length) {
    findings.working.push(`Key files found: ${result.keyFiles.join(', ')}`);
  } else {
    findings.questionable.push('No standard key files (package.json, tsconfig, README) detected');
  }

  if (result.summary.totalFiles === 0) {
    findings.broken.push('No files discovered within survey bounds');
  } else if (result.summary.totalFiles < 5) {
    findings.questionable.push(`Very small file count (${result.summary.totalFiles}) — may be incomplete or wrong folder`);
  } else {
    findings.working.push(
      `Inventory: ${result.summary.totalFiles} files, ${result.summary.totalDirectories} directories`
    );
  }

  if (result.status === 'truncated') {
    findings.questionable.push(`Survey truncated (${result.truncatedReason || 'limit'}) — results may be incomplete`);
  }

  if (Object.keys(result.languages).length === 0) {
    findings.unknown.push('No language extensions detected');
  } else {
    const sortedLangs = Object.entries(result.languages).sort((a, b) => b[1] - a[1]);
    const topLang = sortedLangs[0];
    if (topLang) {
      findings.working.push(`Primary language: ${topLang[0]} (${topLang[1]} files)`);
    }
  }

  // Heuristic placeholder/mock signals from filenames only (surface level)
  const mockHints = result.entries
    .filter(e => e.type === 'file')
    .map(e => e.path.toLowerCase())
    .filter(p =>
      p.includes('placeholder') ||
      p.includes('mock') ||
      p.includes('fake') ||
      p.includes('todo') ||
      p.endsWith('.example')
    );
  if (mockHints.length) {
    findings.mockOrPlaceholder.push(`Possible placeholder/mock paths: ${mockHints.slice(0, 8).join(', ')}`);
  }

  // Additional surface heuristics for N3
  const hasReadme = result.keyFiles.some(k => k.toLowerCase().includes('readme'));
  if (!hasReadme) {
    findings.questionable.push('No README detected — documentation may be missing');
  }

  for (const u of result.unknowns) {
    if (!findings.unknown.includes(u)) findings.unknown.push(u);
  }

  let buildCondition: BuildCondition = 'needs_inspection';
  if (result.summary.totalFiles === 0) buildCondition = 'cannot_assess';
  else if (findings.broken.length > 0) buildCondition = 'significant_problems';
  else if (findings.questionable.length > 0 || findings.mockOrPlaceholder.length > 0) {
    buildCondition = 'partly_working';
  } else if ((result.packageSummary || result.stackProfiles?.length) && result.status === 'complete') {
    buildCondition = 'looks_healthy';
  } else {
    buildCondition = 'needs_inspection';
  }

  return { findings, buildCondition };
}


const SAMPLE_MAX_FILES = 8;
const SAMPLE_MAX_BYTES = 48 * 1024;
const SAMPLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.md', '.txt', '.css', '.html', '.py', '.go', '.rs', '.dart',
  '.cs', '.fs', '.kt', '.java', '.yaml', '.yml', '.toml'
]);

/**
 * Pick up to SAMPLE_MAX_FILES text paths: key files first, then source-like
 * extensions from the inventory. Read-only; binary and oversize files skipped.
 */
async function collectContentSamples(
  projectRoot: string,
  keyFiles: string[],
  entries: SurveyResult['entries']
): Promise<ContentSample[]> {
  // Shallowest key files first: the root manifest is the one the toolchain reads, and it must be
  // in the samples a planner sees before any nested copy with the same filename.
  const keyFilesRootFirst = [...keyFiles].sort(
    (a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length
  );
  const preferred = [
    ...keyFilesRootFirst,
    ...entries
      .filter((e) => e.type === 'file')
      .map((e) => e.path.replace(/\\/g, '/'))
      .filter((rel) => {
        const ext = path.extname(rel).toLowerCase();
        return SAMPLE_EXTENSIONS.has(ext) || !ext;
      })
  ];

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of preferred) {
    const rel = raw.replace(/\\/g, '/');
    if (seen.has(rel)) continue;
    if (/(^|\/)(node_modules|\.git|\.jc)(\/|$)/.test(rel)) continue;
    seen.add(rel);
    ordered.push(rel);
    if (ordered.length >= SAMPLE_MAX_FILES * 3) break; // extra candidates for skips
  }

  const samples: ContentSample[] = [];
  for (const rel of ordered) {
    if (samples.length >= SAMPLE_MAX_FILES) break;
    const full = path.join(projectRoot, rel);
    try {
      const buffer = await fs.readFile(full);
      if (buffer.includes(0)) continue; // binary
      const truncated = buffer.length > SAMPLE_MAX_BYTES;
      const slice = buffer.subarray(0, Math.min(buffer.length, SAMPLE_MAX_BYTES));
      samples.push({
        path: rel,
        bytes: buffer.length,
        truncated,
        content: slice.toString('utf8')
      });
    } catch {
      // unreadable — skip
    }
  }
  return samples;
}

export async function performSurvey(
  targetPath: string,
  maxDepth: number,
  maxEntries: number,
  signal?: AbortSignal
): Promise<SurveyResult> {
  const projectName = path.basename(targetPath);
  const keyFileNames = new Set([
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'tsconfig.json', 'jsconfig.json', 'pubspec.yaml', 'pyproject.toml', 'requirements.txt',
    'setup.py', 'Cargo.toml', 'go.mod',
    'README.md', 'README', 'README.txt',
    '.gitignore', '.env.example'
  ]);

  const base: {
    requestedPath: string;
    projectName: string;
    generatedAt: string;
    projectType: string;
    keyFiles: string[];
    packageSummary: PackageSummary | null;
    summary: {
      totalFiles: number;
      totalDirectories: number;
      totalSizeBytes: number;
      maxDepthReached: number;
    };
    entries: SurveyResult['entries'];
    languages: Record<string, number>;
    observations: string[];
    unknowns: string[];
    status: 'complete' | 'truncated';
    truncatedReason?: string;
  } = {
    requestedPath: targetPath,
    projectName,
    generatedAt: new Date().toISOString(),
    projectType: 'unknown',
    keyFiles: [],
    packageSummary: null,
    summary: {
      totalFiles: 0,
      totalDirectories: 0,
      totalSizeBytes: 0,
      maxDepthReached: 0
    },
    entries: [],
    languages: {},
    observations: [],
    unknowns: [],
    status: 'complete'
  };

  const visited = new Set<string>();
  // Dependency and VCS internals would otherwise consume most of the bounded
  // entry budget and drown the findings in third-party paths.
  const skippedDirNames = new Set(['node_modules', '.git']);
  let skippedDirCount = 0;
  let entryCount = 0;
  let hasPackageJson = false;
  let hasTsconfig = false;

  async function walk(currentPath: string, depth: number) {
    if (signal?.aborted) {
      base.status = 'truncated';
      base.truncatedReason = 'timeout';
      return;
    }
    if (depth > maxDepth || entryCount >= maxEntries) return;
    if (visited.has(currentPath)) return;
    visited.add(currentPath);

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      base.summary.maxDepthReached = Math.max(base.summary.maxDepthReached, depth);

      for (const entry of entries) {
        if (signal?.aborted) {
          base.status = 'truncated';
          base.truncatedReason = 'timeout';
          return;
        }
        if (entryCount >= maxEntries) {
          base.status = 'truncated';
          base.truncatedReason = 'maxEntries';
          break;
        }

        const fullPath = path.join(currentPath, entry.name);
        const relative = path.relative(targetPath, fullPath);

        if (entry.isDirectory()) {
          base.summary.totalDirectories++;
          base.entries.push({ path: relative, type: 'directory' });
          if (skippedDirNames.has(entry.name)) {
            skippedDirCount++;
          } else {
            await walk(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          base.summary.totalFiles++;
          try {
            const stat = await fs.stat(fullPath);
            base.summary.totalSizeBytes += stat.size;
            base.entries.push({ path: relative, type: 'file', size: stat.size });

            if (keyFileNames.has(entry.name)) base.keyFiles.push(relative);
            if (entry.name === 'package.json') hasPackageJson = true;
            if (entry.name === 'tsconfig.json') hasTsconfig = true;

            const ext = path.extname(entry.name).toLowerCase();
            if (ext) base.languages[ext] = (base.languages[ext] || 0) + 1;
          } catch {}
        }
        entryCount++;
      }
    } catch {}
  }

  await walk(targetPath, 0);

  const sourceFiles = base.entries.filter((entry) => entry.type === 'file').map((entry) => entry.path);
  const stackProfiles = await discoverStackProfiles(targetPath, sourceFiles);

  if (hasPackageJson) {
    base.packageSummary = await readPackageSummary(targetPath);
    if (base.packageSummary?.name) base.projectName = base.packageSummary.name;
  }

  const primaryStack = stackProfiles[0];
  if (primaryStack) base.projectType = primaryStack.kind;
  else if (hasPackageJson && hasTsconfig) base.projectType = 'typescript-node';
  else if (hasPackageJson) base.projectType = 'node';
  else if (hasTsconfig) base.projectType = 'typescript';

  if (stackProfiles.length) {
    base.observations.push(`Detected stack: ${stackProfiles.map((profile) => `${profile.label} [${profile.root}]`).join(', ')}`);
    for (const profile of stackProfiles) {
      for (const manifest of profile.manifests) {
        if (!base.keyFiles.some((key) => key.replace(/\\/g, '/') === manifest)) base.keyFiles.push(manifest);
      }
    }
  }

  if (base.packageSummary) {
    base.observations.push(
      `Package identity detected: ${base.packageSummary.name || 'unnamed'}@${base.packageSummary.version || '?'}`
    );
    base.observations.push(
      `Dependency surface: ${base.packageSummary.dependenciesCount} runtime, ${base.packageSummary.devDependenciesCount} dev`
    );
  } else if (!stackProfiles.length) {
    base.unknowns.push('No supported project manifest found — stack and dependency surface remain unknown');
  }

  if (base.keyFiles.length) {
    base.observations.push(`Key files present: ${base.keyFiles.join(', ')}`);
  }
  if (skippedDirCount > 0) {
    base.observations.push(
      `Not traversed: ${skippedDirCount} dependency/VCS folder(s) (node_modules, .git) — the inventory reflects project source only`
    );
  }
  if (base.summary.maxDepthReached >= 3) {
    base.observations.push(`Survey reached depth ${base.summary.maxDepthReached} (bounded)`);
  }
  if (base.summary.totalFiles === 0) {
    base.unknowns.push('No files discovered within bounds — path may be empty or inaccessible');
  }
  if (Object.keys(base.languages).length === 0) {
    base.unknowns.push('No language extensions detected');
  }
  if (base.status === 'truncated') {
    base.observations.push(`Survey truncated (${base.truncatedReason})`);
    base.unknowns.push('Survey did not complete fully — results may be incomplete');
  }

  const { findings, buildCondition } = buildFindings(base as Omit<SurveyResult, 'findings' | 'buildCondition'>);

  // Offline dependency-consistency evidence: cross-check each ecosystem's root manifest against
  // its committed lockfile. Pure file reads — no network, no execution — so it is legal at
  // read-only inspection, and it is the only way a survey can establish "dependencies cannot
  // install" as evidence: installers themselves need the network the survey is denied.
  // Without this, planning was blind to install failures and a local model scoped a stale nested
  // manifest instead of the root one the toolchain reads.
  const manifestNames = new Set(['pubspec.yaml', 'pubspec.lock', 'package.json', 'package-lock.json']);
  const manifestFiles: ManifestFile[] = [];
  for (const entry of base.entries) {
    if (entry.type !== 'file') continue;
    const rel = entry.path.replace(/\\/g, '/');
    const name = rel.split('/').pop() || '';
    if (!manifestNames.has(name)) continue;
    if (/(^|\/)(node_modules|\.git|\.jc|build|\.dart_tool|ephemeral)(\/|$)/.test(rel)) continue;
    if (rel.split('/').length > 3 || manifestFiles.length >= 12) continue;
    try {
      const buffer = await fs.readFile(path.join(targetPath, rel));
      if (buffer.length <= 512 * 1024 && !buffer.includes(0)) {
        manifestFiles.push({ path: rel, content: buffer.toString('utf8') });
      }
    } catch { /* unreadable — no finding rather than a false one */ }
  }
  const dependencyDiagnosis = diagnoseDependencyConsistency(manifestFiles);
  findings.broken.push(...dependencyDiagnosis.broken);
  findings.questionable.push(...dependencyDiagnosis.questionable);
  const dependencyTargets = dependencyDiagnosis.targets;

  const contentSamples = await collectContentSamples(targetPath, base.keyFiles, base.entries);
  if (contentSamples.length) {
    base.observations.push(
      `Content samples: ${contentSamples.length} file(s) read for planning context (≤${SAMPLE_MAX_BYTES} bytes each, read-only)`
    );
  }

  const result: SurveyResult = {
    requestedPath: base.requestedPath,
    projectName: base.projectName,
    generatedAt: base.generatedAt,
    projectType: base.projectType,
    stackProfiles,
    keyFiles: base.keyFiles,
    packageSummary: base.packageSummary,
    summary: base.summary,
    entries: base.entries,
    languages: base.languages,
    observations: base.observations,
    unknowns: base.unknowns,
    findings,
    buildCondition,
    status: base.status,
    contentSamples
  };
  if (dependencyTargets.length) result.dependencyTargets = dependencyTargets;
  if (base.truncatedReason !== undefined) {
    result.truncatedReason = base.truncatedReason;
  }
  return result;
}

export function buildOverviewMarkdown(
  projectName: string,
  projectPath: string,
  result: SurveyResult
): string {
  const lines: string[] = [];
  lines.push(`# JOECODER Build Overview — ${projectName}`);
  lines.push('');
  lines.push(`- **Inspection date:** ${result.generatedAt}`);
  lines.push(`- **Path:** ${projectPath}`);
  lines.push(`- **Project type:** ${result.projectType}`);
  lines.push(`- **Build condition:** ${result.buildCondition}`);
  lines.push(`- **Survey status:** ${result.status}`);
  lines.push('');
  lines.push('## What This Build Appears To Be');
  if (result.packageSummary?.description) {
    lines.push(result.packageSummary.description);
  } else {
    lines.push(`Surface name: **${result.projectName}** (${result.projectType}). Full product purpose not verified at surface inspection.`);
  }
  lines.push('');
  lines.push('## Verified Facts (surface)');
  for (const w of result.findings.working) lines.push(`- ${w}`);
  if (!result.findings.working.length) lines.push('- (none recorded)');
  lines.push('');
  lines.push('## Questionable');
  for (const q of result.findings.questionable) lines.push(`- ${q}`);
  if (!result.findings.questionable.length) lines.push('- (none recorded)');
  lines.push('');
  lines.push('## Broken / Blocked');
  for (const b of result.findings.broken) lines.push(`- ${b}`);
  if (!result.findings.broken.length) lines.push('- (none recorded)');
  lines.push('');
  lines.push('## Mock or Placeholder Signals');
  for (const m of result.findings.mockOrPlaceholder) lines.push(`- ${m}`);
  if (!result.findings.mockOrPlaceholder.length) lines.push('- (none recorded)');
  lines.push('');
  lines.push('## Unknowns');
  for (const u of result.findings.unknown) lines.push(`- ${u}`);
  if (!result.findings.unknown.length) lines.push('- (none recorded)');
  lines.push('');
  if (result.contentSamples?.length) {
    lines.push('## Content Samples (planning only)');
    for (const sample of result.contentSamples) {
      lines.push(`- \`${sample.path}\` (${sample.bytes} bytes${sample.truncated ? ', truncated' : ''})`);
    }
    lines.push('');
  }
  lines.push('## Assumptions');
  lines.push('- This overview is from a **read-only surface survey** only.');
  lines.push('- No application was started; no tests were run; no files were modified in the build folder.');
  lines.push('- Content samples are bounded excerpts for planning; they are not a full code review.');
  lines.push('- Deeper inspection is required before claiming feature completeness.');
  lines.push('');
  lines.push('## Recommended Next Action');
  if (result.buildCondition === 'cannot_assess' || result.buildCondition === 'significant_problems') {
    lines.push('Resolve path/access or empty inventory issues before deeper work.');
  } else {
    lines.push('Review surface findings, then accept this build for deeper inspection or draft a work order from this survey.');
  }
  lines.push('');
  return lines.join('\n');
}

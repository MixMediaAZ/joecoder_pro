/**
 * Runtime verification — jailed spawn of the target project's own build/test
 * scripts, plus a file-integrity fallback when no scripts exist.
 *
 * Jail rules:
 * - cwd forced to the package root under the project
 * - shell: false
 * - env sanitized (no inherited secrets)
 * - timeout hard-capped
 * - only `npm run build` / `npm run test` from package.json scripts
 * - never treats missing scripts as a silent pass without recording why
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverStackProfiles, profilesForEditedFiles, type StackProfile, type StackVerificationCommand } from './stackProfiles.js';

export interface VerificationItem {
  script: 'build' | 'test' | 'lint' | 'analyze' | 'file_integrity';
  command: string;
  root: string;
  exitCode: number | null;
  timedOut: boolean;
  passed: boolean;
  outputTail: string[];
}

export interface VerificationReport {
  status: 'passed' | 'failed' | 'no_scripts';
  detail: string;
  items: VerificationItem[];
}

export type VerificationProofLevel = 'runtime' | 'integrity' | 'none' | 'failed';

export function verificationProofLevel(report: VerificationReport): VerificationProofLevel {
  if (report.status === 'failed') return 'failed';
  const runtime = report.items.filter((item) => item.script !== 'file_integrity');
  if (runtime.length > 0 && runtime.every((item) => item.passed)) return 'runtime';
  if (report.items.some((item) => item.script === 'file_integrity' && item.passed)) return 'integrity';
  return 'none';
}

const PLACEHOLDER_TEST = 'no test specified';
const MAX_TIMEOUT_MS = 180000;
const DEFAULT_TIMEOUT_MS = 120000;

function tail(text: string, lines: number): string[] {
  return text.split(/\r?\n/).filter(Boolean).slice(-lines);
}

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Minimal env: enough for npm/node, no inherited secrets or home expansion surprises. */
function jailedEnv(): NodeJS.ProcessEnv {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const pathVal = process.env[pathKey] || process.env.PATH || '';
  return {
    [pathKey]: pathVal,
    PATH: pathVal,
    CI: '1',
    FORCE_COLOR: '0',
    NODE_ENV: process.env.NODE_ENV || 'test',
    npm_config_yes: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false'
  };
}

async function collectProjectFiles(projectRoot: string, maxFiles = 2500): Promise<string[]> {
  const files: string[] = [];
  const skipped = new Set(['node_modules', '.git', '.jc', 'dist', 'build', 'target', '.venv', 'venv']);
  async function walk(current: string): Promise<void> {
    if (files.length >= maxFiles) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skipped.has(entry.name)) await walk(full);
      } else if (entry.isFile()) {
        files.push(path.relative(projectRoot, full).replace(/\\/g, '/'));
      }
    }
  }
  await walk(projectRoot);
  return files;
}

function runStackCommand(
  projectRoot: string,
  profile: StackProfile,
  command: StackVerificationCommand,
  timeoutMs: number
): VerificationItem {
  const runRoot = path.resolve(projectRoot, profile.root);
  const result = spawnSync(command.executable, command.args, {
    cwd: runRoot,
    shell: false,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    env: jailedEnv()
  });
  const timedOut = Boolean(result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT')
    || result.signal === 'SIGTERM'
    || result.signal === 'SIGKILL';
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const launchError = result.error instanceof Error ? result.error.message : '';
  return {
    script: command.purpose,
    command: command.display,
    root: profile.root,
    exitCode: result.status,
    timedOut,
    passed: !timedOut && result.status === 0,
    outputTail: [...tail(stdout, 15), ...tail(stderr, 15), ...(launchError ? [launchError] : [])]
  };
}
async function readScripts(projectRoot: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return pkg.scripts || {};
  } catch {
    return {};
  }
}

function runScript(
  runRoot: string,
  rootLabel: string,
  script: 'build' | 'test',
  timeoutMs: number
): VerificationItem {
  const result = spawnSync('npm', ['run', script, '--silent'], {
    cwd: runRoot,
    shell: false,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    env: jailedEnv()
  });
  const timedOut = Boolean(result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT')
    || result.signal === 'SIGTERM'
    || result.signal === 'SIGKILL';
  const exitCode = result.status;
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return {
    script,
    command: `npm run ${script}`,
    root: rootLabel,
    exitCode,
    timedOut,
    passed: !timedOut && exitCode === 0,
    outputTail: [...tail(stdout, 15), ...tail(stderr, 15)]
  };
}

async function hasPackageJson(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, 'package.json'));
    return true;
  } catch {
    return false;
  }
}

async function hasNodeModules(dir: string): Promise<boolean> {
  try {
    const st = await fs.stat(path.join(dir, 'node_modules'));
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Find the package roots that govern the edited files: the nearest ancestor
 * directory (within the project) containing a package.json.
 */
export async function findVerificationRoots(projectRoot: string, editedRelPaths: string[]): Promise<string[]> {
  const resolvedRoot = path.resolve(projectRoot);
  const roots = new Set<string>();
  for (const relPath of editedRelPaths) {
    let dir = path.dirname(path.resolve(resolvedRoot, relPath));
    while (dir.startsWith(resolvedRoot) || dir === resolvedRoot) {
      if (await hasPackageJson(dir)) {
        roots.add(dir);
        break;
      }
      if (dir === resolvedRoot) break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  if (!roots.size && await hasPackageJson(resolvedRoot)) roots.add(resolvedRoot);
  return Array.from(roots).slice(0, 2);
}

export interface ExpectedFileHash {
  relPath: string;
  expectedHash: string;
}

/**
 * When the project has no build/test scripts, prove the applied files still
 * exist and match the hashes recorded at apply time. This is not runtime
 * proof the app works — only that the writes landed and were not corrupted.
 */
export async function runFileIntegrityCheck(
  projectRoot: string,
  expected: ExpectedFileHash[]
): Promise<VerificationItem> {
  const failures: string[] = [];
  for (const item of expected) {
    const full = path.resolve(projectRoot, item.relPath);
    const root = path.resolve(projectRoot);
    if (!full.startsWith(root + path.sep) && full !== root) {
      failures.push(`${item.relPath}: path escapes project root`);
      continue;
    }
    try {
      const content = await fs.readFile(full);
      const actual = sha256(content);
      if (actual !== item.expectedHash) {
        failures.push(`${item.relPath}: hash mismatch`);
      }
    } catch {
      failures.push(`${item.relPath}: missing after apply`);
    }
  }
  const passed = failures.length === 0 && expected.length > 0;
  return {
    script: 'file_integrity',
    command: 'file-integrity-check',
    root: '.',
    exitCode: passed ? 0 : 1,
    timedOut: false,
    passed,
    outputTail: failures.length ? failures : [`${expected.length} file(s) hash-verified`]
  };
}

/**
 * Run whichever of build/test the governing package(s) actually define.
 * When no scripts exist and expectedHashes are supplied, fall back to file
 * integrity. `no_scripts` is an honest outcome only when neither is possible.
 */
export async function runVerification(
  projectRoot: string,
  options: {
    timeoutMs?: number;
    editedRelPaths?: string[];
    expectedHashes?: ExpectedFileHash[];
  } = {}
): Promise<VerificationReport> {
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const resolvedRoot = path.resolve(projectRoot);
  const projectFiles = await collectProjectFiles(resolvedRoot);
  const discoveredProfiles = await discoverStackProfiles(resolvedRoot, projectFiles);
  const selectedProfiles = profilesForEditedFiles(discoveredProfiles, options.editedRelPaths || []);
  const nonNodeProfiles = selectedProfiles.filter((profile) => profile.kind !== 'node');

  if (nonNodeProfiles.length) {
    const stackItems = nonNodeProfiles.flatMap((profile) =>
      profile.commands.map((command) => runStackCommand(resolvedRoot, profile, command, timeoutMs))
    );
    if (!stackItems.length && options.expectedHashes?.length) {
      stackItems.push(await runFileIntegrityCheck(resolvedRoot, options.expectedHashes));
    }
    if (!stackItems.length) {
      return {
        status: 'no_scripts',
        detail: `Detected ${nonNodeProfiles.map((profile) => profile.label).join(', ')}, but no safe verification command was discovered.`,
        items: []
      };
    }
    const passed = stackItems.every((item) => item.passed);
    return {
      status: passed ? 'passed' : 'failed',
      detail: passed
        ? `Verification passed: ${stackItems.map((item) => `${item.command} [${item.root}]`).join(', ')}.`
        : `Verification failed: ${stackItems.filter((item) => !item.passed).map((item) => `${item.command} [${item.root}] (exit ${item.timedOut ? 'timeout' : item.exitCode})`).join(', ')}.`,
      items: stackItems
    };
  }

  const runRoots = options.editedRelPaths?.length
    ? await findVerificationRoots(resolvedRoot, options.editedRelPaths)
    : [resolvedRoot];

  if (!runRoots.length && !(options.expectedHashes?.length)) {
    return {
      status: 'no_scripts',
      detail: 'No package.json governs the edited files and no file hashes were supplied; runtime verification could not be executed.',
      items: []
    };
  }

  const items: VerificationItem[] = [];
  for (const runRoot of runRoots) {
    const rootLabel = path.relative(resolvedRoot, runRoot).replace(/\\/g, '/') || '.';
    const scripts = await readScripts(runRoot);
    const runnable: Array<'build' | 'test'> = [];
    if (typeof scripts.build === 'string' && scripts.build.trim()) runnable.push('build');
    if (typeof scripts.test === 'string' && scripts.test.trim() && !scripts.test.includes(PLACEHOLDER_TEST)) {
      runnable.push('test');
    }
    // Always attempt declared scripts. Pure `node -e` / local tools often work
    // without node_modules. Missing-deps failures are real failures unless the
    // caller also supplied expectedHashes for integrity fallback after a skip.
    for (const script of runnable) {
      items.push(runScript(runRoot, rootLabel, script, timeoutMs));
    }
  }

  const onlySkip = items.length > 0 && items.every((item) => item.command === 'npm-scripts-skipped');
  if ((!items.length || onlySkip) && options.expectedHashes?.length) {
    if (onlySkip) items.length = 0; // replace skip markers with integrity evidence
    const integrity = await runFileIntegrityCheck(resolvedRoot, options.expectedHashes);
    items.push(integrity);
  }

  if (!items.length) {
    return {
      status: 'no_scripts',
      detail: 'The governing package(s) define no runnable build or test scripts; runtime verification could not be executed.',
      items: []
    };
  }

  // Skip markers alone are not a pass — require real script or integrity results
  const effective = items.filter((item) => item.command !== 'npm-scripts-skipped');
  if (!effective.length) {
    return {
      status: 'no_scripts',
      detail: 'npm scripts exist but node_modules is missing and no file hashes were supplied.',
      items
    };
  }

  const passed = effective.every((item) => item.passed);
  // rewrite items for report clarity
  items.length = 0;
  items.push(...effective);
  return {
    status: passed ? 'passed' : 'failed',
    detail: passed
      ? `Verification passed: ${items.map((i) => `${i.command} [${i.root}]`).join(', ')}.`
      : `Verification failed: ${items.filter((i) => !i.passed).map((i) => `${i.command} [${i.root}] (exit ${i.timedOut ? 'timeout' : i.exitCode})`).join(', ')}.`,
    items
  };
}

/**
 * Authorized dependency install — jailed to project root.
 *
 * Rules:
 * - Only callable when Work Order scope includes install_dependencies
 * - cwd forced to project root
 * - npm install --ignore-scripts --no-audit --no-fund
 * - shell: false, sanitized env
 * - timeout from caller (WO budget)
 * - Never installs outside project root
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface InstallDepsResult {
  attempted: boolean;
  skipped: boolean;
  skipReason?: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  passed: boolean;
  durationMs: number;
  outputTail: string[];
}

const MAX_TIMEOUT_MS = 300000;
const DEFAULT_TIMEOUT_MS = 180000;

function tail(text: string, lines: number): string[] {
  return text.split(/\r?\n/).filter(Boolean).slice(-lines);
}

function jailedEnv(): NodeJS.ProcessEnv {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const pathVal = process.env[pathKey] || process.env.PATH || '';
  return {
    [pathKey]: pathVal,
    PATH: pathVal,
    CI: '1',
    FORCE_COLOR: '0',
    NODE_ENV: process.env.NODE_ENV || 'development',
    npm_config_yes: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_ignore_scripts: 'true'
  };
}

async function hasPackageJson(projectRoot: string): Promise<boolean> {
  try {
    await fs.access(path.join(projectRoot, 'package.json'));
    return true;
  } catch {
    return false;
  }
}

async function hasNodeModules(projectRoot: string): Promise<boolean> {
  try {
    const st = await fs.stat(path.join(projectRoot, 'node_modules'));
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Run jailed npm install in projectRoot.
 * If node_modules already exists and force is false, skip (idempotent).
 */
export async function runJailedInstall(
  projectRoot: string,
  options: { timeoutMs?: number; force?: boolean } = {}
): Promise<InstallDepsResult> {
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const root = path.resolve(projectRoot);
  const command = 'npm install --ignore-scripts --no-audit --no-fund';

  if (!(await hasPackageJson(root))) {
    return {
      attempted: false,
      skipped: true,
      skipReason: 'No package.json at project root',
      command,
      exitCode: null,
      timedOut: false,
      passed: true,
      durationMs: 0,
      outputTail: []
    };
  }

  if (!options.force && (await hasNodeModules(root))) {
    return {
      attempted: false,
      skipped: true,
      skipReason: 'node_modules already present',
      command,
      exitCode: null,
      timedOut: false,
      passed: true,
      durationMs: 0,
      outputTail: ['Skipped install — node_modules exists']
    };
  }

  const started = Date.now();
  const result = spawnSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      env: jailedEnv()
    }
  );
  const durationMs = Date.now() - started;
  const timedOut =
    Boolean(result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') ||
    result.signal === 'SIGTERM' ||
    result.signal === 'SIGKILL';
  const exitCode = result.status;
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  return {
    attempted: true,
    skipped: false,
    command,
    exitCode,
    timedOut,
    passed: !timedOut && exitCode === 0,
    durationMs,
    outputTail: [...tail(stdout, 20), ...tail(stderr, 20)]
  };
}

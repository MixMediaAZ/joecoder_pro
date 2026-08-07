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

import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyDependencyAdmission, type DependencyInventory, type SignedEnvelope } from './supplyChain.js';
import { resolveCommand, runBoundedProcess } from './boundedProcess.js';

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
  const windowsSystem: NodeJS.ProcessEnv = process.platform === 'win32'
    ? Object.fromEntries(
        ['SystemRoot', 'SystemDrive', 'ComSpec', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData',
         'ProgramW6432', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'PUBLIC', 'TEMP', 'TMP',
         'PATHEXT', 'windir', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']
          .filter((name) => process.env[name] !== undefined)
          .map((name) => [name, process.env[name]])
      )
    : {};
  return {
    ...windowsSystem,
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
  options: { timeoutMs?: number; force?: boolean; admission?: SignedEnvelope<DependencyInventory>; trustedKeyId?: string } = {}
): Promise<InstallDepsResult> {
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const root = path.resolve(projectRoot);
  const command = 'npm ci --ignore-scripts --no-audit --no-fund';

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

  if (!options.admission) {
    return {
      attempted: false, skipped: false, command, exitCode: null, timedOut: false, passed: false, durationMs: 0,
      outputTail: ['Dependency admission metadata is required before install.']
    };
  }
  try {
    await verifyDependencyAdmission(root, options.admission, {
      ...(options.trustedKeyId ? { trustedKeyId: options.trustedKeyId } : {}), timeoutMs
    });
  } catch (error: unknown) {
    return {
      attempted: false, skipped: false, command, exitCode: null, timedOut: false, passed: false, durationMs: 0,
      outputTail: [error instanceof Error ? error.message : String(error)]
    };
  }

  const resolved = resolveCommand('npm');
  const result = await runBoundedProcess(
    resolved.executable,
    [...resolved.prefixArgs, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: root, timeoutMs, env: jailedEnv() }
  );

  return {
    attempted: true,
    skipped: false,
    command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    passed: !result.timedOut && result.exitCode === 0,
    durationMs: result.durationMs,
    outputTail: [
      ...tail(result.stdout, 20),
      ...tail(result.stderr, 20),
      ...(result.launchError ? [result.launchError] : [])
    ]
  };
}

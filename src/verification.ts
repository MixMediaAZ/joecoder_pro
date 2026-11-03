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

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { discoverStackProfiles, profilesForEditedFiles, type StackProfile, type StackVerificationCommand } from './stackProfiles.js';
import { resolveCommand, runBoundedProcess } from './boundedProcess.js';
import { findUndeclaredImportsInProjectFiles } from './packageImportPolicy.js';
import { assessApiImplementationSource } from './apiRouteContracts.js';

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
  /** Checks that failed identically before this change ran; recorded limitations, not caused by it. */
  preexistingFailures?: VerificationItem[];
}

/** Convert absent runtime proof into an actionable failure for runnable objectives. */
export function requireRuntimeVerification(report: VerificationReport): VerificationReport {
  const proof = verificationProofLevel(report);
  if (proof === 'runtime' || proof === 'failed') return report;
  const detail = 'RUNTIME_VERIFICATION_REQUIRED: file integrity alone cannot verify a runnable application. No runnable project build/test check completed. Add or repair a meaningful package.json build/test script and its real checks within the authorized scope.';
  return {
    ...report, status: 'failed', detail,
    items: [...report.items, {
      script: 'test', command: 'runtime-verification-required', root: '.', exitCode: null,
      timedOut: false, passed: false, outputTail: [detail]
    }]
  };
}

/**
 * Judge a post-change verification against the baseline recorded before any write.
 *
 * Verification was absolute: `flutter analyze` and friends judge the whole project's health, so on
 * a messy real codebase every repair failed for defects that predate the edit. Observed live: the
 * qualification project carries 1,931 pre-existing analyzer issues; JoeCoder made the correct
 * one-line dependency fix, verification failed on the pre-existing mess, the correction loop could
 * not "fix" 1,931 inherited problems, and the right change was rolled back.
 *
 * The honest standard for a bounded repair is no-regression: a check that failed identically
 * before the change is a recorded limitation, not evidence against the change. A check that passed
 * at baseline and fails after remains a hard failure. File-integrity is never excusable as
 * pre-existing — it judges the exact bytes this change wrote.
 */
export function adjustVerificationForBaseline(
  baseline: VerificationReport | null,
  post: VerificationReport
): VerificationReport {
  if (!baseline || post.status !== 'failed') return post;
  const key = (item: VerificationItem) => `${item.script}|${item.command}|${item.root}`;
  const baselineFailedByKey = new Map(
    baseline.items.filter((item) => !item.passed).map((item) => [key(item), item] as const)
  );
  // A check that fails on both sides can still have gotten WORSE. Observed live: a one-file edit
  // took flutter analyze from 25 to 39 issues, and pass/fail comparison called it "pre-existing"
  // because analyze failed at baseline too. Where both outputs report a countable magnitude
  // ("N issues found"), a larger count after the change is a regression, not an inherited state.
  const magnitude = (item: VerificationItem): number | null => {
    const joined = (item.outputTail || []).join('\n');
    const match = joined.match(/(\d+)\s+issues?\s+found/i) || joined.match(/(\d+)\s+(?:error|failure)s?\b/i);
    return match ? Number(match[1]) : null;
  };
  const regressions: VerificationItem[] = [];
  const preexisting: VerificationItem[] = [];
  for (const item of post.items) {
    if (item.passed) continue;
    const baselineItem = item.script !== 'file_integrity' ? baselineFailedByKey.get(key(item)) : undefined;
    if (!baselineItem) { regressions.push(item); continue; }
    const before = magnitude(baselineItem);
    const after = magnitude(item);
    if (before !== null && after !== null && after > before) regressions.push(item);
    else preexisting.push(item);
  }
  if (!regressions.length && preexisting.length) {
    return {
      status: 'passed',
      detail:
        `No regression against the recorded baseline. ${preexisting.length} check(s) were already failing ` +
        `before this change and fail the same way after it: ${preexisting.map((item) => `${item.command} [${item.root}]`).join(', ')}. ` +
        'These pre-existing failures are recorded as limitations; they are not evidence about this change.',
      items: post.items,
      preexistingFailures: preexisting
    };
  }
  if (regressions.length && preexisting.length) {
    return {
      ...post,
      detail: `${post.detail} (${preexisting.length} further failure(s) are pre-existing from the baseline and recorded as limitations)`,
      preexistingFailures: preexisting
    };
  }
  return post;
}

export type VerificationProofLevel = 'runtime' | 'integrity' | 'none' | 'failed';

/** Stable fingerprint of observed behavior; excludes timing noise that cannot represent progress. */
export function verificationEvidenceFingerprint(report: VerificationReport): string {
  const stable = {
    status: report.status,
    detail: report.detail,
    items: report.items.map((item) => ({
      script: item.script,
      command: item.command,
      root: item.root,
      exitCode: item.exitCode,
      timedOut: item.timedOut,
      passed: item.passed,
      output: item.outputTail.filter((line) => !/^\s*(?:#\s*)?duration_ms:?\s*[\d.]+\s*$/i.test(line))
    }))
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

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

export function diagnosticExcerpt(text: string, maxLines = 80): string[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length <= maxLines) return lines;
  const headCount = Math.min(20, Math.floor(maxLines / 3));
  const tailCount = maxLines - headCount - 1;
  return [
    ...lines.slice(0, headCount),
    '... ' + (lines.length - headCount - tailCount) + ' line(s) omitted ...',
    ...lines.slice(-tailCount)
  ];
}

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Minimal env: enough for npm/node, no inherited secrets or home expansion surprises. */
let jailedEnvironmentSequence = 0;

function jailedEnv(): NodeJS.ProcessEnv {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const pathVal = process.env[pathKey] || process.env.PATH || '';
  // Windows toolchains (flutter.bat and friends) dereference the standard system variables;
  // stripping them made `flutter test` die on "%PROGRAMFILES(X86)% environment variable not
  // found". These identify OS install locations, not secrets — the jail's purpose is to withhold
  // credentials and project-external configuration, not to break the OS contract.
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
    NODE_ENV: process.env.NODE_ENV || 'test',
    npm_config_yes: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPYCACHEPREFIX: path.join(os.tmpdir(), 'jc-python-fresh-cache', `${process.pid}-${++jailedEnvironmentSequence}`)
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

/**
 * Run a discovered stack command without blocking JoeCoder's API event loop.
 */
async function runStackCommand(
  projectRoot: string,
  profile: StackProfile,
  command: StackVerificationCommand,
  timeoutMs: number
): Promise<VerificationItem> {
  const runRoot = path.resolve(projectRoot, profile.root);
  const resolved = resolveCommand(command.executable);
  const result = await runBoundedProcess(
    resolved.executable,
    [...resolved.prefixArgs, ...command.args],
    { cwd: runRoot, timeoutMs, env: jailedEnv() }
  );
  return {
    script: command.purpose,
    command: command.display,
    root: profile.root,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    passed: !result.timedOut && result.exitCode === 0,
    outputTail: [
      ...diagnosticExcerpt(result.stdout),
      ...diagnosticExcerpt(result.stderr),
      ...(result.launchError ? [result.launchError] : [])
    ]
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

async function runScript(
  runRoot: string,
  rootLabel: string,
  script: 'build' | 'test',
  timeoutMs: number
): Promise<VerificationItem> {
  const resolved = resolveCommand('npm');
  const result = await runBoundedProcess(
    resolved.executable,
    [...resolved.prefixArgs, 'run', script, '--silent'],
    { cwd: runRoot, timeoutMs, env: jailedEnv() }
  );
  return {
    script,
    command: `npm run ${script}`,
    root: rootLabel,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    passed: !result.timedOut && result.exitCode === 0,
    outputTail: [
      ...diagnosticExcerpt(result.stdout),
      ...diagnosticExcerpt(result.stderr),
      ...(result.launchError ? [result.launchError] : [])
    ]
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
async function freeLoopbackPort(): Promise<number> {
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => resolve());
  });
  const address = listener.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  if (!port) throw new Error('API_SMOKE_PORT_UNAVAILABLE');
  return port;
}

/** Wait until a prior smoke child has released the loopback port (Windows EADDRINUSE). */
async function waitForLoopbackPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => {
        probe.close(() => resolve(true));
      });
    });
    if (free) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function readServerEntrySource(projectRoot: string): Promise<{ relPath: string; content: string } | null> {
  for (const relPath of ['server/index.ts', 'server/index.js', 'server/index.mjs', 'backend/index.ts', 'backend/index.js']) {
    try {
      const content = await fs.readFile(path.join(projectRoot, relPath), 'utf8');
      return { relPath, content };
    } catch { /* try next */ }
  }
  return null;
}

const ZIP_CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function zipCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildUncompressedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  // Uncompressed multi-entry ZIP with valid CRC — real extractors (jszip) reject zero-CRC theater.
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.data;
    const checksum = zipCrc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

function buildMinimalSmokeZip(): Buffer {
  // Mirror oracle fixture shape: multi-file ZIP with seeded eval for R4 findings smoke.
  return buildUncompressedZip([
    {
      name: 'src/index.js',
      data: Buffer.from("const userInput = 'oracle'; eval(userInput); // oracle-seeded-eval\n")
    },
    {
      name: 'src/math.js',
      data: Buffer.from('export const add = (a, b) => a + b;\n')
    },
    {
      name: 'README.md',
      data: Buffer.from('# Oracle multi-file project\n')
    }
  ]);
}

/** Same bar as tools/qualification-oracles/repair-inspectorcode.mjs meaningfulAnalysis (G2x). */
function meaningfulSmokeAnalysis(body: unknown): {
  ok: boolean;
  fileCount: number;
  seededFinding: boolean;
  placeholder: boolean;
} {
  const serialized = JSON.stringify(body ?? {}).toLowerCase();
  const placeholder = /placeholder|mock analysis|sample result|simulated/.test(serialized);
  const seededFinding = /oracle-seeded-eval|\beval\b|dynamic code execution/.test(serialized);
  let fileCount = 0;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/^(filecount|totalfiles|filesanalyzed|analyzedfiles)$/i.test(key) && Number.isFinite(Number(child))) {
        fileCount = Math.max(fileCount, Number(child));
      }
      if (/files/i.test(key) && Array.isArray(child)) fileCount = Math.max(fileCount, child.length);
      visit(child);
    }
  };
  visit(body);
  return {
    ok: !placeholder && seededFinding && fileCount >= 3,
    fileCount,
    seededFinding,
    placeholder
  };
}

function extractSmokeProjectId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  for (const key of ['projectId', 'id']) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  for (const value of Object.values(record)) {
    const nested = extractSmokeProjectId(value);
    if (nested) return nested;
  }
  return null;
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) found.push(full);
    }
  }
  await walk(root);
  return found;
}

/**
 * After a green build, prove the production entry is not a placeholder and that
 * critical client routes exist (static) and answer something other than 404/501 (smoke).
 */
async function runApiContractVerification(
  projectRoot: string,
  requiredRoutes: string[],
  timeoutMs: number
): Promise<VerificationItem> {
  const server = await readServerEntrySource(projectRoot);
  if (!server) {
    return {
      script: 'analyze',
      command: 'api-route-contracts',
      root: '.',
      exitCode: 1,
      timedOut: false,
      passed: false,
      outputTail: ['API_CONTRACT_MISSING_SERVER_ENTRY', `Required routes: ${requiredRoutes.join(', ')}`]
    };
  }
  const staticCheck = assessApiImplementationSource(server.content, requiredRoutes);
  if (!staticCheck.ok) {
    return {
      script: 'analyze',
      command: 'api-route-contracts',
      root: '.',
      exitCode: 1,
      timedOut: false,
      passed: false,
      outputTail: [staticCheck.detail]
    };
  }

  const distEntry = path.join(projectRoot, 'dist', 'index.js');
  try {
    await fs.access(distEntry);
  } catch {
    return {
      script: 'analyze',
      command: 'api-route-smoke',
      root: '.',
      exitCode: 1,
      timedOut: false,
      passed: false,
      outputTail: ['API_SMOKE_MISSING_DIST', 'npm run build must emit dist/index.js before API smoke']
    };
  }

  const port = await freeLoopbackPort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-api-smoke-'));
  const env = {
    ...jailedEnv(),
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: dataDir,
    INSPECTORCODE_DATA_DIR: dataDir,
    JC_DATA_DIR: dataDir
  };
  let activeChild = spawn(process.execPath, [distEntry], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  const attachLogs = (proc: ReturnType<typeof spawn>): void => {
    proc.stdout?.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-4000); });
    proc.stderr?.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  };
  attachLogs(activeChild);

  const base = `http://127.0.0.1:${port}`;
  const smokeDeadline = Date.now() + Math.min(timeoutMs, 20_000);
  let healthy = false;
  let healthStatus = 0;
  try {
    while (Date.now() < smokeDeadline) {
      if (activeChild.exitCode !== null) break;
      try {
        const health = await fetch(`${base}/api/health`);
        healthStatus = health.status;
        if (health.status === 200) {
          healthy = true;
          break;
        }
      } catch { /* retry */ }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    if (!healthy || activeChild.exitCode !== null) {
      return {
        script: 'analyze',
        command: 'api-route-smoke',
        root: '.',
        exitCode: 1,
        timedOut: false,
        passed: false,
        outputTail: [
          `healthStatus=${healthStatus}`,
          `childExit=${activeChild.exitCode}`,
          ...diagnosticExcerpt(stdout),
          ...diagnosticExcerpt(stderr)
        ]
      };
    }

    const zipBytes = buildMinimalSmokeZip();
    const form = new FormData();
    form.append('name', 'jc-api-smoke');
    form.append('file', new Blob([Uint8Array.from(zipBytes)], { type: 'application/zip' }), 'smoke.zip');
    const upload = await fetch(`${base}/api/projects/upload`, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body: form
    }).catch(() => null);
    const uploadStatus = upload?.status ?? 0;
    const uploadBody = upload ? await upload.json().catch(() => null) : null;
    const projectId = extractSmokeProjectId(uploadBody);
    let storedFiles = 0;
    let projectLocalDataFiles = 0;
    try {
      storedFiles = (await listFilesRecursive(dataDir)).length;
    } catch { storedFiles = 0; }
    try {
      // G2o: server wrote under project ./data while ignoring smoke's DATA_DIR env.
      projectLocalDataFiles = (await listFilesRecursive(path.join(projectRoot, 'data'))).length;
    } catch { projectLocalDataFiles = 0; }
    // Oracle R3 needs a real upload (2xx + id + files under the env DATA_DIR the server was started with).
    const uploadOk = uploadStatus >= 200 && uploadStatus < 300 && projectId !== null && storedFiles >= 1;
    const dataDirIgnored = !uploadOk
      && uploadStatus >= 200 && uploadStatus < 300
      && projectId !== null
      && storedFiles === 0
      && projectLocalDataFiles >= 1;

    // G2w/oracle R4: parameterized analysis routes + meaningful findings (eval seed), not 200 theater.
    let analysisStartStatus = 0;
    let analysisGetStatus = 0;
    let analysisMeaning = { ok: false, fileCount: 0, seededFinding: false, placeholder: false };
    if (uploadOk && projectId) {
      const started = await fetch(`${base}/api/analysis/start/${encodeURIComponent(projectId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ options: { depth: 'deep' }, testingInstructions: 'Inspect the real uploaded files.' })
      }).catch(() => null);
      analysisStartStatus = started?.status ?? 0;
      const analysisDeadline = Date.now() + 8_000;
      while (Date.now() < analysisDeadline) {
        const got = await fetch(`${base}/api/analysis/${encodeURIComponent(projectId)}`, {
          headers: { accept: 'application/json' }
        }).catch(() => null);
        analysisGetStatus = got?.status ?? 0;
        const body = got ? await got.json().catch(() => null) : null;
        analysisMeaning = meaningfulSmokeAnalysis(body);
        if (analysisGetStatus >= 200 && analysisGetStatus < 300 && analysisMeaning.ok) break;
        if (analysisGetStatus >= 400 && analysisGetStatus < 500) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    const analysisRouted = analysisStartStatus >= 200 && analysisStartStatus < 300
      && analysisGetStatus >= 200 && analysisGetStatus < 300
      && analysisMeaning.ok;

    // Staged oracle surface (review item 7): later probes run only after earlier gates pass,
    // and firstFailure names the earliest break for correction noise.
    const gateFailures: string[] = [];
    if (!uploadOk) gateFailures.push('R3-upload-dataDir');
    if (uploadOk && !analysisRouted) gateFailures.push('R4-analysis-findings');

    // Oracle R5 (lite): `/` must serve the client UI text (full browser check stays in the independent oracle).
    let rootStatus = 0;
    let rootLooksLikeUi = false;
    if (analysisRouted) {
      const root = await fetch(`${base}/`).catch(() => null);
      rootStatus = root?.status ?? 0;
      const rootText = root ? await root.text().catch(() => '') : '';
      rootLooksLikeUi = rootStatus === 200 && /inspectorcode|upload/i.test(rootText);
      if (!rootLooksLikeUi) gateFailures.push('R5-static-ui');
    }

    // Oracle R6 prelude: durable save before restart (only after UI gate).
    let saveStatus = 0;
    let saveOk = false;
    if (analysisRouted && rootLooksLikeUi && projectId) {
      const saved = await fetch(`${base}/api/projects/save/${encodeURIComponent(projectId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ name: 'jc-api-smoke-saved', description: 'persistence probe' })
      }).catch(() => null);
      saveStatus = saved?.status ?? 0;
      saveOk = saveStatus >= 200 && saveStatus < 300;
      if (!saveOk) gateFailures.push('R6-save');
    }

    // Oracle R7: zip-slip — only after save prelude so correction sees one causal lane.
    let slipStatus = 0;
    let escapedByPath = false;
    let escapedInTree = false;
    let slipOk = false;
    if (saveOk) {
      const escapeName = `jc-smoke-escape-${Date.now()}.js`;
      const slipZip = buildUncompressedZip([
        { name: `../${escapeName}`, data: Buffer.from('globalThis.oracleEscape = true;\n') },
        { name: 'safe.js', data: Buffer.from('export default true;\n') }
      ]);
      const slipForm = new FormData();
      slipForm.append('name', 'jc-api-smoke-slip');
      slipForm.append('file', new Blob([Uint8Array.from(slipZip)], { type: 'application/zip' }), 'slip.zip');
      const slipUpload = await fetch(`${base}/api/projects/upload`, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: slipForm
      }).catch(() => null);
      slipStatus = slipUpload?.status ?? 0;
      const escapeCandidates = [
        path.join(projectRoot, escapeName),
        path.join(dataDir, escapeName),
        path.join(path.dirname(dataDir), escapeName)
      ];
      escapedByPath = (await Promise.all(
        escapeCandidates.map((candidate) => fs.access(candidate).then(() => true).catch(() => false))
      )).some(Boolean);
      escapedInTree = (await listFilesRecursive(dataDir).catch(() => []) as string[])
        .some((file) => path.basename(file) === escapeName);
      slipOk = slipStatus >= 400 && slipStatus < 500 && !escapedByPath && !escapedInTree;
      if (!slipOk) gateFailures.push('R7-zip-slip');
    }

    // Oracle R8: malformed upload + unknown ids (after zip-slip gate).
    let malformedStatus = 0;
    let unknownGetStatus = 0;
    let unknownStartStatus = 0;
    let honestyOk = false;
    if (slipOk) {
      const malformedForm = new FormData();
      malformedForm.append('name', 'missing-archive');
      const malformed = await fetch(`${base}/api/projects/upload`, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: malformedForm
      }).catch(() => null);
      malformedStatus = malformed?.status ?? 0;
      const unknownGet = await fetch(`${base}/api/analysis/999999999`, {
        headers: { accept: 'application/json' }
      }).catch(() => null);
      unknownGetStatus = unknownGet?.status ?? 0;
      const unknownStart = await fetch(`${base}/api/analysis/start/999999999`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ options: {} })
      }).catch(() => null);
      unknownStartStatus = unknownStart?.status ?? 0;
      honestyOk = malformedStatus >= 400 && malformedStatus < 500
        && unknownGetStatus >= 400 && unknownGetStatus < 500
        && unknownStartStatus >= 400 && unknownStartStatus < 500;
      if (!honestyOk) gateFailures.push('R8-http-4xx');
    }

    // Oracle R6 restart: same DATA_DIR + same PORT after port is free (review item 3).
    let recentStatus = 0;
    let recentHasProject = false;
    let persistedAnalysisOk = false;
    let restartHealth = 0;
    let portFreed = false;
    if (honestyOk && projectId) {
      if (activeChild.exitCode === null) {
        activeChild.kill('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (activeChild.exitCode === null) activeChild.kill('SIGKILL');
      }
      portFreed = await waitForLoopbackPortFree(port, 10_000);
      if (!portFreed) {
        gateFailures.push('R6-port-busy');
      } else {
        activeChild = spawn(process.execPath, [distEntry], {
          cwd: projectRoot,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        });
        attachLogs(activeChild);
        const restartDeadline = Date.now() + 15_000;
        while (Date.now() < restartDeadline) {
          if (activeChild.exitCode !== null) break;
          try {
            const health = await fetch(`${base}/api/health`);
            restartHealth = health.status;
            if (health.status === 200) break;
          } catch { /* retry */ }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (restartHealth === 200) {
          const recent = await fetch(`${base}/api/projects/recent`, {
            headers: { accept: 'application/json' }
          }).catch(() => null);
          recentStatus = recent?.status ?? 0;
          const recentBody = recent ? await recent.json().catch(() => null) : null;
          recentHasProject = recentStatus === 200
            && JSON.stringify(recentBody ?? {}).includes(String(projectId));
          const persisted = await fetch(`${base}/api/analysis/${encodeURIComponent(projectId)}`, {
            headers: { accept: 'application/json' }
          }).catch(() => null);
          const persistedBody = persisted ? await persisted.json().catch(() => null) : null;
          persistedAnalysisOk = (persisted?.status ?? 0) === 200
            && meaningfulSmokeAnalysis(persistedBody).ok;
        }
        if (!(saveOk && recentHasProject && persistedAnalysisOk && restartHealth === 200)) {
          gateFailures.push('R6-restart-persist');
        }
      }
    }

    const persistOk = saveOk && recentHasProject && persistedAnalysisOk && restartHealth === 200 && portFreed;
    const firstFailure = gateFailures[0] || null;
    const passed = uploadOk && analysisRouted && rootLooksLikeUi && persistOk && slipOk && honestyOk
      && gateFailures.length === 0;
    return {
      script: 'analyze',
      command: 'api-route-smoke',
      root: '.',
      exitCode: passed ? 0 : 1,
      timedOut: false,
      passed,
      outputTail: [
        `firstFailure=${firstFailure ?? 'none'}`,
        `health=200`,
        `uploadStatus=${uploadStatus}`,
        `projectId=${projectId ?? 'none'}`,
        `storedFiles=${storedFiles}`,
        `projectLocalDataFiles=${projectLocalDataFiles}`,
        `analysisStartStatus=${analysisStartStatus}`,
        `analysisGetStatus=${analysisGetStatus}`,
        `analysisFiles=${analysisMeaning.fileCount}`,
        `seededFinding=${analysisMeaning.seededFinding}`,
        `placeholder=${analysisMeaning.placeholder}`,
        `rootStatus=${rootStatus}`,
        `rootUi=${rootLooksLikeUi}`,
        `saveStatus=${saveStatus}`,
        `slipStatus=${slipStatus}`,
        `escaped=${escapedByPath || escapedInTree}`,
        `malformed=${malformedStatus}`,
        `unknownGet=${unknownGetStatus}`,
        `unknownStart=${unknownStartStatus}`,
        `portFreed=${portFreed}`,
        `restartHealth=${restartHealth}`,
        `recentStatus=${recentStatus}`,
        `recentHasProject=${recentHasProject}`,
        `persistedAnalysis=${persistedAnalysisOk}`,
        ...(dataDirIgnored
          ? ['DATA_DIR_IGNORED: files appeared under project ./data but not under the smoke DATA_DIR/INSPECTORCODE_DATA_DIR/JC_DATA_DIR env path.']
          : []),
        passed
          ? 'Staged upload/analysis/UI/save/zip-slip/4xx/restart smoke passed under env DATA_DIR (oracle R3–R8 API surface).'
          : `First smoke break: ${firstFailure ?? 'unknown'}. Fix that gate before later oracle checks (R3→R8 staged).`
      ]
    };
  } finally {
    if (activeChild.exitCode === null) {
      activeChild.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (activeChild.exitCode === null) activeChild.kill('SIGKILL');
    }
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runVerification(
  projectRoot: string,
  options: {
    timeoutMs?: number;
    editedRelPaths?: string[];
    expectedHashes?: ExpectedFileHash[];
    /** When set, build pass is not enough — server must implement and smoke these routes (G2m). */
    apiRouteContracts?: string[];
  } = {}
): Promise<VerificationReport> {
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const resolvedRoot = path.resolve(projectRoot);
  const projectFiles = await collectProjectFiles(resolvedRoot);
  const discoveredProfiles = await discoverStackProfiles(resolvedRoot, projectFiles);
  const selectedProfiles = profilesForEditedFiles(discoveredProfiles, options.editedRelPaths || []);
  const nonNodeProfiles = selectedProfiles.filter((profile) => profile.kind !== 'node');

  if (nonNodeProfiles.length) {
    const stackItems: VerificationItem[] = [];
    for (const profile of nonNodeProfiles) {
      for (const command of profile.commands) {
        stackItems.push(await runStackCommand(resolvedRoot, profile, command, timeoutMs));
      }
    }
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
      items.push(await runScript(runRoot, rootLabel, script, timeoutMs));
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

  let passed = effective.every((item) => item.passed);
  // rewrite items for report clarity
  items.length = 0;
  items.push(...effective);

  // Build can pass while production start dies on undeclared externals (G2e: uuid).
  if (passed && (options.editedRelPaths || []).length) {
    const importAudit = await findUndeclaredImportsInProjectFiles(resolvedRoot, options.editedRelPaths || []);
    if (importAudit.undeclared.length) {
      const detail = importAudit.undeclared
        .map((entry) => `${entry.file} imports '${entry.packageName}'`)
        .join('; ');
      items.push({
        script: 'build',
        command: 'declared-package-imports',
        root: importAudit.packageJsonPath || '.',
        exitCode: 1,
        timedOut: false,
        passed: false,
        outputTail: [
          'EDITED_SOURCE_UNDECLARED_PACKAGE_IMPORT',
          detail,
          'Add the package to package.json dependencies or replace with a node: builtin / relative import.'
        ]
      });
      passed = false;
    }
  }

  // G2m: build-green placeholder servers must not complete operational repairs.
  if (passed && (options.apiRouteContracts || []).length) {
    const apiItem = await runApiContractVerification(
      resolvedRoot,
      options.apiRouteContracts || [],
      Math.min(timeoutMs, 45_000)
    );
    items.push(apiItem);
    if (!apiItem.passed) passed = false;
  }

  return {
    status: passed ? 'passed' : 'failed',
    detail: passed
      ? `Verification passed: ${items.map((i) => `${i.command} [${i.root}]`).join(', ')}.`
      : `Verification failed: ${items.filter((i) => !i.passed).map((i) => `${i.command} [${i.root}] (exit ${i.timedOut ? 'timeout' : i.exitCode})`).join(', ')}.`,
    items
  };
}

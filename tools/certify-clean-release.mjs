import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReleaseBundle } from '../dist/supplyChain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supplied = process.argv[2];
if (!supplied) throw new Error('Usage: node tools/certify-clean-release.mjs <signed-release-directory>');
const releaseRoot = path.resolve(supplied);
const payloadRoot = path.join(releaseRoot, 'payload');
const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-clean-release-'));
const installRoot = path.join(isolatedRoot, 'install');
const dataRoot = path.join(isolatedRoot, 'data');
const fixtureRoot = path.join(isolatedRoot, 'fixture');
const checks = [];

function run(command, args, cwd, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: { ...process.env, CI: '1', JC_NO_OPEN: '1' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ code, stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${(stderr || stdout).slice(-2000)}`));
    });
  });
}

async function waitFor(predicate, timeoutMs, failure) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(failure());
}

async function startServer() {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: installRoot,
    shell: false,
    windowsHide: true,
    env: { ...process.env, JC_DATA_DIR: dataRoot, JC_NO_OPEN: '1', JC_MOCK_MODEL: '1', JC_PORT: '0' }
  });
  let output = '';
  let errorOutput = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errorOutput += chunk; });
  const match = await waitFor(
    () => output.match(/http:\/\/127\.0\.0\.1:(\d+)\/bootstrap\.html#token=([A-Za-z0-9_-]+)/),
    30000,
    () => `server bootstrap timed out: ${(errorOutput || output).slice(-2000)}`
  );
  return { child, base: `http://127.0.0.1:${match[1]}`, token: match[2], output: () => output + errorOutput };
}

async function stopServer(server, client) {
  const exited = new Promise(resolve => server.child.once('exit', code => resolve(code)));
  const shutdown = await client.post('/api/v1/system/shutdown', { confirm: 'shutdown' });
  if (shutdown.response.status !== 202) throw new Error('authenticated shutdown request was rejected');
  const result = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve('timeout'), 10000))]);
  if (result === 'timeout') {
    server.child.kill('SIGKILL');
    throw new Error('server did not stop within 10 seconds');
  }
  return result;
}

async function sessionClient(base, token) {
  const exchange = await fetch(`${base}/api/v1/session/exchange`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bootstrapToken: token })
  });
  const exchangeBody = await exchange.json();
  const cookie = (exchange.headers.get('set-cookie') || '').split(';', 1)[0];
  if (exchange.status !== 200 || !cookie || !exchangeBody.csrfToken) throw new Error('session exchange failed');
  return {
    get: async route => {
      const response = await fetch(base + route, { headers: { Cookie: cookie } });
      return { response, body: await response.json().catch(() => ({})) };
    },
    post: async (route, body) => {
      const response = await fetch(base + route, {
        method: 'POST', headers: {
          Cookie: cookie, Origin: base, 'Content-Type': 'application/json',
          'X-JC-CSRF': exchangeBody.csrfToken, 'Idempotency-Key': randomBytes(16).toString('hex')
        }, body: JSON.stringify(body)
      });
      return { response, body: await response.json().catch(() => ({})) };
    }
  };
}

try {
  const envelope = JSON.parse(await fs.readFile(path.join(releaseRoot, 'RELEASE-ATTESTATION.json'), 'utf8'));
  const trustedKeyId = (await fs.readFile(path.join(releaseRoot, 'TRUSTED-KEY-ID'), 'utf8')).trim();
  const verified = await verifyReleaseBundle(payloadRoot, envelope, { trustedKeyId });
  checks.push({ id: 'signed_payload', passed: verified.files.length > 0, detail: `${verified.files.length} files` });

  await fs.cp(payloadRoot, installRoot, { recursive: true, errorOnExist: true, force: false });
  for (const required of ['src', 'dist', 'public', 'tools', 'tsconfig.json', 'package.json', 'package-lock.json', 'start.bat']) {
    await fs.access(path.join(installRoot, required));
  }
  checks.push({ id: 'launcher_layout', passed: true, detail: 'all launcher inputs present' });
  await fs.access(path.join(installRoot, 'node_modules')).then(
    () => { throw new Error('release payload unexpectedly contains node_modules'); },
    () => undefined
  );

  await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], installRoot, 300000);
  checks.push({ id: 'clean_dependency_install', passed: true, detail: 'exact lockfile install passed' });
  await run('npm', ['run', 'build'], installRoot, 180000);
  checks.push({ id: 'clean_build', passed: true, detail: 'TypeScript build passed from packaged source' });

  await fs.mkdir(fixtureRoot, { recursive: true });
  await fs.writeFile(path.join(fixtureRoot, 'README.md'), '# clean release fixture\n');

  const first = await startServer();
  const health = await fetch(`${first.base}/health`).then(response => response.json());
  if (health.database?.integrity !== 'ok') throw new Error('first launch database integrity failed');
  const client = await sessionClient(first.base, first.token);
  const registered = await client.post('/api/v1/projects', { name: 'Clean release fixture', path: fixtureRoot });
  const projectId = registered.body?.project?.id;
  if (registered.response.status !== 200 || !projectId) throw new Error('first launch project registration failed');
  checks.push({ id: 'first_launch', passed: true, detail: `project ${projectId}` });
  const firstExit = await stopServer(first, client);
  checks.push({ id: 'clean_shutdown', passed: firstExit === 0, detail: `exit ${firstExit}` });

  const second = await startServer();
  const restartedClient = await sessionClient(second.base, second.token);
  const projects = await restartedClient.get('/api/v1/projects');
  if (projects.response.status !== 200 || !projects.body.projects?.some(project => project.id === projectId)) {
    throw new Error('restart did not preserve registered project history');
  }
  checks.push({ id: 'restart_history', passed: true, detail: `project ${projectId} reopened` });
  const app = await fetch(`${second.base}/app.html`).then(response => response.text());
  if (!app.includes('/app.js')) throw new Error('packaged application page did not load');
  checks.push({ id: 'packaged_ui', passed: true, detail: 'app shell served after restart' });
  const secondExit = await stopServer(second, restartedClient);
  checks.push({ id: 'second_shutdown', passed: secondExit === 0, detail: `exit ${secondExit}` });

  await run(process.execPath, ['tools/e2e-acceptance.mjs', '--runs=2'], installRoot, 1800000);
  const installedCertificationDir = path.join(installRoot, '.jc', 'certification');
  const installedReceipts = (await fs.readdir(installedCertificationDir))
    .filter(name => name.startsWith('CERT-STAGE10-') && name.endsWith('.json'))
    .sort();
  const installedReceiptName = installedReceipts.at(-1);
  if (!installedReceiptName) throw new Error('installed acceptance receipt was not produced');
  const installedAcceptance = JSON.parse(await fs.readFile(path.join(installedCertificationDir, installedReceiptName), 'utf8'));
  if (installedAcceptance.runs !== 2 || installedAcceptance.results?.length !== 20) {
    throw new Error('installed acceptance receipt does not contain two complete fixture runs');
  }
  checks.push({ id: 'installed_acceptance_matrix', passed: true, detail: `${installedAcceptance.results.length} fixture runs · ${installedReceiptName}` });

  const receipt = {
    schemaVersion: 1,
    passed: checks.every(check => check.passed),
    environment: 'isolated temporary payload under the current Windows user',
    cleanWindowsUserAccount: false,
    limitation: 'A separately provisioned clean Windows user account was not created by this automated verifier.',
    releaseRoot,
    installedAcceptance: { receipt: installedReceiptName, runs: installedAcceptance.runs, results: installedAcceptance.results },
    checks,
    recordedAt: new Date().toISOString()
  };
  const certificationDir = path.join(root, '.jc', 'certification');
  await fs.mkdir(certificationDir, { recursive: true });
  const receiptPath = path.join(certificationDir, `CERT-STAGE12-ISOLATED-${Date.now()}-${randomBytes(4).toString('hex')}.json`);
  await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
  if (!receipt.passed) process.exitCode = 1;
} finally {
  await fs.rm(isolatedRoot, { recursive: true, force: true }).catch(() => {});
}

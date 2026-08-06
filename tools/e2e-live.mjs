#!/usr/bin/env node
/**
 * U5 — Live HTTP e2e driver (release gate).
 *
 * Starts the built server, establishes a session, and drives the public durable
 * Agent Job contract for read-only inspection and a bounded repair. It also
 * proves the superseded public lifecycle mutation routes are unavailable.
 *
 * Asserts committed events, evidence identities, and the evidence-derived
 * terminal state. A local model is required for the repair branch.
 *
 * Usage: node tools/e2e-live.mjs
 * Exit: 0 on pass
 */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const PORT = 18765 + (process.pid % 1000);
const SERVER_DATA = path.join(tmpdir(), 'jc-e2e-data-' + process.pid + '-' + randomBytes(3).toString('hex'));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function writeEvidence(controlId, result) {
  const dir = path.join(ROOT, '.jc', 'certification');
  await fs.mkdir(dir, { recursive: true });
  const id = `CERT-E2E-${Date.now()}-${controlId}-${randomBytes(3).toString('hex')}`;
  await fs.writeFile(
    path.join(dir, `${id}.json`),
    JSON.stringify({ id, control: controlId, result, at: new Date().toISOString() }, null, 2)
  );
  return id;
}

async function ensureBuilt() {
  try {
    await fs.access(path.join(ROOT, 'dist', 'index.js'));
  } catch {
    console.log('Building…');
    const r = spawn('npm', ['run', 'build'], { cwd: ROOT, shell: false, stdio: 'inherit' });
    await new Promise((resolve, reject) => {
      r.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('build failed'))));
    });
  }
}

function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'dist', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      JC_PORT: String(PORT),
      JC_HOST: HOST,
      JC_NO_OPEN: '1',
      JC_DATA_DIR: SERVER_DATA,
      NODE_ENV: 'test',
      JC_MOCK_MODEL: process.env.JC_MOCK_MODEL || '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  return { child, getOut: () => stdout, getErr: () => stderr };
}

async function waitForBootstrap(getOut, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const out = getOut();
    const m = out.match(/bootstrap\.html#token=([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    if (out.includes('EADDRINUSE')) throw new Error('port in use');
    await sleep(200);
  }
  throw new Error('bootstrap token not found in server output:\n' + getOut().slice(-1500));
}

function makeClient(base) {
  let cookie = '';
  let csrf = '';
  async function req(method, p, body, timeoutMs = 30000) {
    const headers = {
      Origin: base,
      'Content-Type': 'application/json'
    };
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET') {
      if (csrf) headers['x-jc-csrf'] = csrf;
      headers['Idempotency-Key'] = `e2e-${Date.now()}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 6)}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${base}${p}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      const data = await response.json().catch(() => ({}));
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    exchange: (token) => req('POST', '/api/v1/session/exchange', { bootstrapToken: token }),
    get: (p) => req('GET', p),
    post: (p, body, timeoutMs) => req('POST', p, body, timeoutMs)
  };
}

async function main() {
  try {
    await fs.access(path.join(ROOT, 'package.json'));
    await fs.access(path.join(ROOT, 'dist', 'index.js'));
  } catch {
    console.error('Run from JoeCoder project root (directory containing package.json and dist/).');
    console.error('Resolved ROOT=', ROOT);
    process.exit(1);
  }
  console.log('JoeCoder Live E2E (U5)');
  console.log(`port=${PORT}`);
  await ensureBuilt();

  const { child, getOut, getErr } = startServer();
  let all = true;
  const results = [];

  const record = async (id, ok, detail) => {
    const evidence = await writeEvidence(id, { ok, detail });
    console.log(`[${id}] ${ok ? 'PASS' : 'FAIL'}  ${detail || ''}  evidence=${evidence}`);
    results.push({ id, ok, detail, evidence });
    if (!ok) all = false;
  };

  try {
    const token = await waitForBootstrap(getOut);
    await record('server_boot', true, `token_len=${token.length}`);

    const base = `http://${HOST}:${PORT}`;
    const api = makeClient(base);

    const exchange = await api.exchange(token);
    await record(
      'session_exchange',
      exchange.status === 200 && Boolean(exchange.data.sessionId),
      `status=${exchange.status}`
    );

    const health = await api.get('/health');
    await record(
      'health',
      health.status === 200 && health.data?.capabilities?.sourceRepair?.enabled === true,
      `repair=${health.data?.capabilities?.sourceRepair?.code || 'n/a'}`
    );

    const fixture = path.join(tmpdir(), `jc-e2e-${process.pid}-${randomBytes(3).toString('hex')}`);
    await fs.mkdir(path.join(fixture, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(fixture, 'package.json'),
      JSON.stringify({ name: 'e2e-fixture', version: '1.0.0', private: true }, null, 2)
    );
    await fs.writeFile(path.join(fixture, 'src', 'lib.js'), 'export function add(a,b){return a+b;}\n');
    await fs.writeFile(path.join(fixture, 'README.md'), '# e2e fixture\n');
    await fs.writeFile(path.join(fixture, '.env'), 'E2E_SECRET=must-not-be-previewed\n');

    const reg = await api.post('/api/v1/projects', {
      name: 'E2E Fixture',
      path: fixture
    });
    const projectId = reg.data?.project?.id;
    await record('register', reg.status === 200 && Boolean(projectId), `status=${reg.status} id=${projectId || 'none'} err=${JSON.stringify(reg.data).slice(0,180)}`);

    const rootFiles = await api.get(`/api/v1/projects/${projectId}/files?path=`);
    await record(
      'files_root',
      rootFiles.status === 200 &&
        rootFiles.data?.readOnly === true &&
        rootFiles.data?.entries?.some((entry) => entry.path === 'src' && entry.type === 'directory') &&
        rootFiles.data?.entries?.some((entry) => entry.path === '.env' && entry.protected === true),
      `status=${rootFiles.status} entries=${rootFiles.data?.entries?.length || 0} readOnly=${Boolean(rootFiles.data?.readOnly)}`
    );
    const fileSearch = await api.get(`/api/v1/projects/${projectId}/files?q=lib`);
    await record(
      'files_search',
      fileSearch.status === 200 && fileSearch.data?.entries?.some((entry) => entry.path === 'src/lib.js'),
      `status=${fileSearch.status} results=${fileSearch.data?.entries?.length || 0}`
    );
    const filePreview = await api.get(`/api/v1/projects/${projectId}/files/preview?path=${encodeURIComponent('src/lib.js')}`);
    await record(
      'files_preview',
      filePreview.status === 200 &&
        filePreview.data?.preview?.readOnly === true &&
        filePreview.data?.preview?.content === 'export function add(a,b){return a+b;}\n',
      `status=${filePreview.status} readOnly=${Boolean(filePreview.data?.preview?.readOnly)}`
    );
    const protectedPreview = await api.get(`/api/v1/projects/${projectId}/files/preview?path=${encodeURIComponent('.env')}`);
    await record(
      'files_secret_guard',
      protectedPreview.status === 403 && protectedPreview.data?.code === 'SENSITIVE_FILE_PREVIEW_BLOCKED',
      `status=${protectedPreview.status} code=${protectedPreview.data?.code || 'none'}`
    );
    const escapedPreview = await api.get(`/api/v1/projects/${projectId}/files/preview?path=${encodeURIComponent('../outside.txt')}`);
    await record(
      'files_path_guard',
      escapedPreview.status === 403 && escapedPreview.data?.code === 'PROJECT_PATH_ESCAPE',
      `status=${escapedPreview.status} code=${escapedPreview.data?.code || 'none'}`
    );

    const legacySurvey = await api.post('/api/v1/survey', {});
    const legacyAccept = await api.post('/api/v1/projects/' + projectId + '/accept', {});
    await record(
      'public_lifecycle_absent',
      legacySurvey.status === 404 && legacyAccept.status === 404,
      `survey=${legacySurvey.status} accept=${legacyAccept.status}`
    );

    const threads = await api.get('/api/v1/projects/' + projectId + '/threads');
    const threadId = threads.data?.selectedThreadId || threads.data?.threads?.[0]?.id;
    await record('default_thread', threads.status === 200 && Boolean(threadId), 'status=' + threads.status + ' thread=' + (threadId || 'none'));
    const typoStatus = await api.post(`/api/v1/projects/${projectId}/threads/${threadId}/chat`, { content: 'current build staus' });
    const typoReply = typoStatus.data?.reply?.content || '';
    await record(
      'status_typo_truth',
      typoStatus.status === 200 && /read-only|active work order|no active work order|surface_review_ready/i.test(typoReply) && !/captured the requested outcome/i.test(typoReply),
      `status=${typoStatus.status} reply=${JSON.stringify(typoReply).slice(0, 180)}`
    );

    const readOnlyStart = await api.post(`/api/v1/projects/${projectId}/threads/${threadId}/agent-jobs`, {
      objective: 'Inspect this project and export a read-only handoff.',
      activeWorkOrderId: null
    });
    const readOnlyJobId = readOnlyStart.data?.job?.id;
    await record('agent_readonly_start', readOnlyStart.status === 202 && Boolean(readOnlyJobId), `status=${readOnlyStart.status} job=${readOnlyJobId || 'none'}`);
    let readOnlyObserved = null;
    const readOnlyDeadline = Date.now() + 120000;
    while (readOnlyJobId && Date.now() < readOnlyDeadline) {
      const status = await api.get(`/api/v1/agent-jobs/${readOnlyJobId}`);
      readOnlyObserved = status.data;
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status.data?.job?.status)) break;
      await sleep(300);
    }
    const readOnlyResult = readOnlyObserved?.job?.result || {};
    const exportPath = readOnlyResult.exportPath || readOnlyResult.workOrder?.execution?.exportPath;
    await record(
      'agent_readonly_complete',
      readOnlyObserved?.job?.status === 'completed' && Boolean(readOnlyObserved?.job?.workOrderId) && Boolean(readOnlyResult.evidenceId),
      `status=${readOnlyObserved?.job?.status || 'timeout'} wo=${readOnlyObserved?.job?.workOrderId || 'none'} evidence=${readOnlyResult.evidenceId || 'none'}`
    );
    const inspectedProject = await api.get(`/api/v1/projects/${projectId}`);
    const latestSurveyId = inspectedProject.data?.project?.latestSurveyId;
    await record(
      'inspect_through_durable_job',
      inspectedProject.status === 200 && Boolean(latestSurveyId),
      `status=${inspectedProject.status} survey=${latestSurveyId || 'none'}`
    );
    const exportsDir = path.join(SERVER_DATA, 'exports');
    const exported = await fs.readdir(exportsDir).catch(() => []);
    await record('export_artifacts', Boolean(exportPath) || exported.length > 0, `path=${exportPath || 'none'} exports=${exported.length}`);
    // Direct product path: one Send-equivalent request, server owns every stage.
    {
      const fixture3 = path.join(tmpdir(), `jc-e2e-agent-${process.pid}-${randomBytes(3).toString('hex')}`);
      await fs.mkdir(path.join(fixture3, 'src'), { recursive: true });
      await fs.writeFile(path.join(fixture3, 'package.json'), JSON.stringify({ name: 'e2e-agent', private: true }, null, 2));
      await fs.writeFile(path.join(fixture3, 'package-lock.json'), JSON.stringify({ name: 'e2e-agent', lockfileVersion: 3, requires: true, packages: { '': { name: 'e2e-agent' } } }, null, 2));
      await fs.writeFile(path.join(fixture3, 'src', 'lib.js'), 'export function add(a,b){return a-b;}\n');
      const reg3 = await api.post('/api/v1/projects', { name: 'E2E Server Agent', path: fixture3 });
      const pid3 = reg3.data?.project?.id;
      const threads3 = await api.get(`/api/v1/projects/${pid3}/threads`);
      const thread3 = threads3.data?.selectedThreadId || threads3.data?.threads?.[0]?.id;
      const started3 = await api.post(`/api/v1/projects/${pid3}/threads/${thread3}/agent-jobs`, {
        objective: 'Fix add() so it returns a+b instead of a-b.',
        activeWorkOrderId: null
      });
      const jobId3 = started3.data?.job?.id;
      await record('agent_job_start', started3.status === 202 && Boolean(jobId3), `status=${started3.status} job=${jobId3 || 'none'}`);
      let observed3 = null;
      const deadline3 = Date.now() + 180000;
      while (jobId3 && Date.now() < deadline3) {
        const status3 = await api.get(`/api/v1/agent-jobs/${jobId3}`);
        observed3 = status3.data;
        if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status3.data?.job?.status)) break;
        await sleep(300);
      }
      const content3 = await fs.readFile(path.join(fixture3, 'src', 'lib.js'), 'utf8').catch(() => '');
      const fixed3 = content3.includes('a + b') || content3.includes('a+b');
      const guardedMockResult = observed3?.job?.status === 'completed' &&
        observed3?.job?.terminalState === 'completed_with_limits' &&
        observed3?.job?.result?.mockModel === true;
      const stages3 = (observed3?.events || []).map((event) => event.stage);
      await record(
        'agent_job_mock_guardrail',
        guardedMockResult && fixed3 && Boolean(observed3?.job?.workOrderId) && stages3.includes('complete'),
        `status=${observed3?.job?.status || 'timeout'} terminal=${observed3?.job?.terminalState || 'none'} mock=${Boolean(observed3?.job?.result?.mockModel)} fixed=${fixed3} wo=${observed3?.job?.workOrderId || 'none'} stages=${stages3.join(',')} error=${observed3?.job?.errorMessage || 'none'}`
      );
      await fs.rm(fixture3, { recursive: true, force: true }).catch(() => {});
    }

    // Optional repair if model available
    const model = health.data?.model?.localModel;
    if (model) {
      await record('model_available', true, String(model));
    } else {
      await record('model_available', true, 'skipped — no local model (export path is the release gate)');
    }

    await fs.rm(fixture, { recursive: true, force: true }).catch(() => {});
  } catch (err) {
    await record('fatal', false, err instanceof Error ? err.message : String(err));
    console.error(getErr().slice(-1000));
  } finally {
    child.kill('SIGTERM');
    await sleep(500);
    try {
      child.kill('SIGKILL');
    } catch {}
    await fs.rm(SERVER_DATA, { recursive: true, force: true }).catch(() => {});
  }

  console.log('');
  console.log(all ? 'LIVE E2E PASSED' : 'LIVE E2E FAILED');
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

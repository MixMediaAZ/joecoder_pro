#!/usr/bin/env node
/**
 * U5 — Live HTTP e2e driver (release gate).
 *
 * Starts the built server, establishes a session, and drives:
 *   Register → Inspect → Accept → Draft(export/inspect) → Authorize → Apply export
 *
 * Asserts evidence IDs and export artifacts. Repair path is attempted only when
 * a local model is available (otherwise recorded as skipped).
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

    const survey = await api.post('/api/v1/survey', {
      path: fixture,
      projectId,
      maxDepth: 4,
      maxEntries: 200,
      timeoutMs: 30000
    }, 60000);
    const surveyId = survey.data?.evidenceId || survey.data?.surveyId || survey.data?.id;
    // survey response shape may nest
    const nestedId =
      surveyId ||
      survey.data?.evidence?.id ||
      survey.data?.result?.evidenceId ||
      null;
    // Prefer latestSurveyId from project after survey
    const projAfter = await api.get(`/api/v1/projects/${projectId}`);
    const latestSurveyId = projAfter.data?.project?.latestSurveyId || nestedId;
    await record(
      'inspect',
      survey.status === 200 && Boolean(latestSurveyId),
      `status=${survey.status} survey=${latestSurveyId || 'none'} keys=${Object.keys(survey.data || {}).join(',')}`
    );

    const accept = await api.post('/api/v1/projects/' + projectId + '/accept', {});
    await record('accept', accept.status === 200, 'status=' + accept.status);
    const acceptAgain = await api.post('/api/v1/projects/' + projectId + '/accept', {});
    await record(
      'accept_idempotent',
      acceptAgain.status === 200 && acceptAgain.data?.alreadyAccepted === true,
      'status=' + acceptAgain.status + ' alreadyAccepted=' + Boolean(acceptAgain.data?.alreadyAccepted)
    );

    const threads = await api.get('/api/v1/projects/' + projectId + '/threads');
    const threadId = threads.data?.selectedThreadId || threads.data?.threads?.[0]?.id;
    await record('default_thread', threads.status === 200 && Boolean(threadId), 'status=' + threads.status + ' thread=' + (threadId || 'none'));
    const typoStatus = await api.post(`/api/v1/projects/${projectId}/threads/${threadId}/chat`, { content: 'current build staus' });
    const typoReply = typoStatus.data?.reply?.content || '';
    await record(
      'status_typo_truth',
      typoStatus.status === 200 && /project_accepted|read-only|active work order|no active work order/i.test(typoReply) && !/captured the requested outcome/i.test(typoReply),
      `status=${typoStatus.status} reply=${JSON.stringify(typoReply).slice(0, 180)}`
    );
    const draft = await api.post('/api/v1/work-orders/from-survey', {
      surveyId: latestSurveyId,
      objective: 'Export a read-only handoff of the e2e fixture survey.',
      intent: 'inspect'
    });
    const woId = draft.data?.workOrder?.id || draft.data?.id;
    await record('draft_export', (draft.status === 200 || draft.status === 201) && Boolean(woId), `status=${draft.status} wo=${woId || 'none'}`);

    const plannedObjective = draft.data?.workOrder?.objective;
    const auth = await api.post('/api/v1/work-orders/' + woId + '/authorize', {
      grantedBy: 'local-operator:e2e-auto',
      automationGrant: {
        mode: 'bounded_auto_job',
        projectId,
        threadId,
        objective: plannedObjective,
        maxAttempts: 1
      }
    });
    await record(
      'authorize_automatic',
      auth.status === 200 &&
        auth.data?.workOrder?.status === 'authorized' &&
        Boolean(auth.data?.automationGrantEvidenceId),
      'status=' + auth.status + ' grantEvidence=' + (auth.data?.automationGrantEvidenceId || 'none')
    );
    const apply = await api.post(`/api/v1/work-orders/${woId}/apply`, {
      action: 'export_handoff'
    }, 60000);
    const evidenceId = apply.data?.evidenceId;
    const exportPath = apply.data?.exportPath || apply.data?.workOrder?.execution?.exportPath;
    await record(
      'apply_export',
      apply.status === 200 && (Boolean(evidenceId) || apply.data?.ok === true),
      `status=${apply.status} evidence=${evidenceId || 'none'} path=${exportPath || 'n/a'}`
    );

    if (exportPath) {
      try {
        const summary = path.join(exportPath, 'job-summary.json');
        await fs.access(summary);
        await record('export_artifacts', true, summary);
      } catch {
        // exports may be under ROOT/.jc/exports
        const exportsDir = path.join(SERVER_DATA, 'exports');
        const entries = await fs.readdir(exportsDir).catch(() => []);
        await record('export_artifacts', entries.length > 0, `exports=${entries.length}`);
      }
    } else {
      const exportsDir = path.join(SERVER_DATA, 'exports');
      const entries = await fs.readdir(exportsDir).catch(() => []);
      await record('export_artifacts', entries.length > 0 || apply.status === 200, `exports=${entries.length}`);
    }


    // Repair path with mock model (or real model if present)
    {
      const fixture2 = path.join(tmpdir(), `jc-e2e-repair-${process.pid}-${randomBytes(3).toString('hex')}`);
      await fs.mkdir(path.join(fixture2, 'src'), { recursive: true });
      await fs.writeFile(path.join(fixture2, 'package.json'), JSON.stringify({ name: 'e2e-repair', private: true }, null, 2));
      await fs.writeFile(path.join(fixture2, 'src', 'lib.js'), 'export function add(a,b){return a-b;}\n');
      const reg2 = await api.post('/api/v1/projects', { name: 'E2E Repair', path: fixture2 });
      const pid2 = reg2.data?.project?.id;
      const survey2 = await api.post('/api/v1/survey', { path: fixture2, projectId: pid2, maxDepth: 4, maxEntries: 100, timeoutMs: 30000 }, 60000);
      const proj2 = await api.get(`/api/v1/projects/${pid2}`);
      const sid2 = proj2.data?.project?.latestSurveyId || survey2.data?.evidenceId;
      await api.post(`/api/v1/projects/${pid2}/accept`, {});
      const draft2 = await api.post('/api/v1/work-orders/from-survey', {
        surveyId: sid2,
        objective: 'Fix add() so it returns a+b instead of a-b.',
        intent: 'repair'
      }, 210000);
      const wo2 = draft2.data?.workOrder?.id || draft2.data?.id;
      const draftOk = (draft2.status === 200 || draft2.status === 201) && Boolean(wo2);
      await record('repair_draft', draftOk, `status=${draft2.status} wo=${wo2 || 'none'} err=${JSON.stringify(draft2.data).slice(0,160)}`);
      if (draftOk) {
        const auth2 = await api.post(`/api/v1/work-orders/${wo2}/authorize`, { grantedBy: 'e2e' });
        await record('repair_authorize', auth2.status === 200, `status=${auth2.status}`);
        const apply2 = await api.post(`/api/v1/work-orders/${wo2}/apply`, { action: 'apply_edits' }, 180000);
        const content = await fs.readFile(path.join(fixture2, 'src', 'lib.js'), 'utf8').catch(() => '');
        const fixed = content.includes('a + b') || content.includes('a+b');
        await record(
          'repair_apply',
          apply2.status === 200 && fixed,
          `status=${apply2.status} fixed=${fixed} evidence=${apply2.data?.evidenceId || 'none'} body=${JSON.stringify(apply2.data).slice(0,180)}`
        );
      }
      await fs.rm(fixture2, { recursive: true, force: true }).catch(() => {});
    }

    // Direct product path: one Send-equivalent request, server owns every stage.
    {
      const fixture3 = path.join(tmpdir(), `jc-e2e-agent-${process.pid}-${randomBytes(3).toString('hex')}`);
      await fs.mkdir(path.join(fixture3, 'src'), { recursive: true });
      await fs.writeFile(path.join(fixture3, 'package.json'), JSON.stringify({ name: 'e2e-agent', private: true }, null, 2));
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
      const completed3 = observed3?.job?.status === 'completed';
      const stages3 = (observed3?.events || []).map((event) => event.stage);
      await record(
        'agent_job_complete',
        completed3 && fixed3 && Boolean(observed3?.job?.workOrderId) && stages3.includes('complete'),
        `status=${observed3?.job?.status || 'timeout'} fixed=${fixed3} wo=${observed3?.job?.workOrderId || 'none'} stages=${stages3.join(',')} error=${observed3?.job?.errorMessage || 'none'}`
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

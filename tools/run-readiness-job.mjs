import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const family = process.argv[2];
const definitions = {
  repair: ['InspectorCode 1.1', 'Make InspectorCode run locally end to end so a user can upload a ZIP project, analyze its real files, see useful results, and still find that project after a restart, with safe and honest failure handling.'],
  refactor: ['Forgetastic Pro 1', 'Refactor Forgetastic so its CLI and Control Panel use one durable persistence path for JSON state and JSONL events, preventing partial or divergent records while preserving the operator workflow and existing results.'],
  greenfield: [null, 'Build a polished local Workboard where I can create, edit, filter, complete, and delete work items, with validation and durable storage so my data survives a restart.']
};
if (!definitions[family]) throw new Error('Usage: node tools/run-readiness-job.mjs repair|refactor|greenfield');
const model = process.env.JC_OLLAMA_MODEL || 'qwen2.5-coder:14b';
const timeoutMs = Number(process.env.JC_READINESS_JOB_TIMEOUT_MS || 600_000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 2_700_000) throw new Error('Invalid job timeout (10000–2700000 ms).');
const run = path.join(root, '.jc', 'readiness', `${family}-${Date.now()}`);
const target = path.join(run, 'target');
const data = path.join(run, 'runtime');
await fs.mkdir(target, { recursive: true });
const excluded = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.jc', '.venv', 'venv', '__pycache__', 'logs', '.oracle-data']);
const [sourceName, objective] = definitions[family];
if (sourceName) {
  const source = path.resolve(root, '..', '..', sourceName);
  await fs.cp(source, target, { recursive: true, dereference: false, filter: async file => {
    const name = path.basename(file);
    return !excluded.has(name) && !/^\.env(?:\.|$)/.test(name) && !(await fs.lstat(file)).isSymbolicLink();
  }});
}
async function inventory(directory) {
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(file);
        files.push({ path: path.relative(directory, file).replaceAll('\\', '/'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  await walk(directory);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
const before = await inventory(target);
await fs.writeFile(path.join(run, 'before.json'), JSON.stringify(before, null, 2));
const record = {
  proofLevel: 'diagnostic-real-model', qualificationPassed: false,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
  runtimeFiles: await inventory(path.join(root, 'dist')),
  family, model, target, objective, timeoutMs, startedAt: new Date().toISOString(),
  machine: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramBytes: os.totalmem(), node: process.version },
  timings: {}, observations: []
};
const tags = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) }).then(r => r.json());
record.modelIdentity = tags.models?.find(m => m.name === model);
if (!record.modelIdentity) throw new Error(`Requested local model is not installed: ${model}`);
const child = spawn(process.execPath, [path.join(root, 'dist/index.js')], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, JC_DATA_DIR: data, JC_PORT: '0', JC_HOST: '127.0.0.1', JC_NO_OPEN: '1', JC_MOCK_MODEL: '0', JC_OLLAMA_MODEL: model, NODE_ENV: 'test' }
});
let logs = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + String(chunk)).slice(-2_000_000); });
let spawnError;
child.once('error', error => { spawnError = error; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let base, cookie = '', csrf = '', jobId;
async function request(method, route, body) {
  const headers = { Origin: base, 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (method !== 'GET') { headers['Idempotency-Key'] = randomUUID(); if (csrf) headers['x-jc-csrf'] = csrf; }
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const result = await response.json();
  if (result.csrfToken) csrf = result.csrfToken;
  if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status} ${JSON.stringify(result)}`);
  return result;
}
const started = performance.now();
try {
  let launch;
  const startDeadline = Date.now() + 45_000;
  while (!(launch = logs.match(/(http:\/\/127\.0\.0\.1:\d+)\/bootstrap\.html#token=([a-zA-Z0-9_-]+)/))) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || Date.now() > startDeadline) throw new Error('Server startup failed or timed out.');
    await sleep(100);
  }
  base = launch[1];
  record.timings.startupMs = Math.round(performance.now() - started);
  await request('POST', '/api/v1/session/exchange', { bootstrapToken: launch[2] });
  record.health = await request('GET', '/health');
  if (record.health.model?.mockModel) throw new Error('Mock model is forbidden.');
  const project = await request('POST', '/api/v1/projects', { name: `Readiness ${family}`, path: target });
  const projectId = project.project.id;
  const threads = await request('GET', `/api/v1/projects/${projectId}/threads`);
  const threadId = threads.selectedThreadId || threads.threads[0].id;
  const submittedAt = performance.now();
  const submitted = await request('POST', `/api/v1/projects/${projectId}/threads/${threadId}/agent-jobs`, { objective, mode: 'build', activeWorkOrderId: null });
  jobId = submitted.job.id;
  record.jobId = jobId;
  record.timings.acknowledgmentMs = Math.round(performance.now() - submittedAt);
  console.log(`READINESS_RUN ${run}\nJOB ${jobId} MODEL ${model}`);
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const detail = await request('GET', `/api/v1/agent-jobs/${jobId}`);
    record.terminal = detail;
    const state = `${detail.job.status}/${detail.job.stage}/${detail.job.currentAction || ''}`;
    if (state !== last) {
      record.observations.push({ elapsedMs: Math.round(performance.now() - submittedAt), state });
      console.log(state); last = state;
      await fs.writeFile(path.join(run, 'result.json'), JSON.stringify(record, null, 2));
    }
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(detail.job.status)) break;
    await sleep(1000);
  }
  if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(record.terminal?.job?.status)) {
    record.timedOut = true;
    await request('POST', `/api/v1/agent-jobs/${jobId}/stop`, {});
    record.terminal = await request('GET', `/api/v1/agent-jobs/${jobId}`);
  }
  record.timings.totalMs = Math.round(performance.now() - started);
  record.after = await inventory(target);
  const original = new Map(before.map(f => [f.path, f.sha256]));
  record.changedPaths = record.after.filter(f => original.get(f.path) !== f.sha256).map(f => f.path);
  record.removedPaths = before.filter(f => !record.after.some(a => a.path === f.path)).map(f => f.path);
  const changedTests = [...record.changedPaths, ...record.removedPaths].filter(p => original.has(p) && /(?:^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\./i.test(p));
  record.changedExistingTests = changedTests;
  process.exitCode = !record.timedOut && record.terminal?.job?.status === 'completed' && !changedTests.length ? 0 : 1;
} catch (error) {
  record.error = error.message;
  if (jobId) await request('POST', `/api/v1/agent-jobs/${jobId}/stop`, {}).catch(() => {});
  process.exitCode = 1;
} finally {
  record.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(run, 'result.json'), JSON.stringify(record, null, 2));
  await fs.writeFile(path.join(run, 'server.log'), logs.replace(/token=[A-Za-z0-9_-]+/g, 'token=[redacted]'));
  child.kill('SIGTERM');
  for (let i = 0; child.exitCode === null && i < 30; i++) await sleep(100);
  if (child.exitCode === null) child.kill('SIGKILL');
  console.log(`RESULT ${run}: ${record.terminal?.job?.status || record.error}; independent qualification still required.`);
}

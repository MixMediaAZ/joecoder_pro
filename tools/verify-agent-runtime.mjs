import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { fixtureDefinition, fixtureNames } from './agent-benchmark-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const family = option('family', 'startup'), route = option('route', 'powerrouter');
const interruption = option('interrupt', ''), userEdit = args.includes('--user-edit');
const cancellation = option('cancel', '');
const holdsCommand = interruption === 'command' || cancellation === 'command';
const repetitions = Number(option('repeat', '1')), timeoutMs = Number(option('timeout-ms', '240000'));
if (process.platform !== 'win32') throw Error('This benchmark includes Windows launcher qualification; run on Windows.');
if (![...fixtureNames, 'all'].includes(family) || !['powerrouter', 'fallback'].includes(route)
    || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10 || !Number.isInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 600000) {
  throw Error('Usage: npm run verify:agent -- --family startup|test-repair|refactor|all --repeat 1..10 --route powerrouter|fallback --timeout-ms 240000');
}
if (!['', 'inspection', 'write', 'verification', 'command'].includes(interruption) || (userEdit && interruption !== 'verification')) throw Error('Use --interrupt inspection|write|verification|command; --user-edit requires verification.');
if (!['', 'command'].includes(cancellation) || (cancellation && (interruption || userEdit))) throw Error('Use --cancel command independently of interruption checks.');
const run = path.join(root, '.jc', 'readiness', 'agent-benchmark-' + Date.now());
await fs.mkdir(run, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
const terminal = job => ['completed', 'failed', 'cancelled', 'interrupted'].includes(job?.status);
async function inventory(dir) {
  const files = {};
  async function walk(current) {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name), rel = path.relative(dir, file).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) throw Error('Unexpected link in fixture: ' + rel);
      if (entry.isDirectory()) await walk(file);
      else files[rel] = hash(await fs.readFile(file));
    }
  }
  await walk(dir); return files;
}
async function stopTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', resolve); killer.once('close', resolve);
  });
}
async function command(commandArgs, cwd, logFile, limit = 20000) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, commandArgs, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', launchError, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void stopTree(child); }, limit);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-128000); });
    child.once('error', error => { launchError = error.message; });
    child.once('close', async exitCode => { clearTimeout(timer); await fs.writeFile(logFile, output); resolve({ exitCode, timedOut, launchError }); });
  });
}
const summary = { startedAt: new Date().toISOString(), route, interruption, cancellation, userEdit, node: process.version, modelMode: 'real', cloudBudgetUsd: 0, cases: [] };
async function candidateFingerprint() {
  return hash(JSON.stringify({ source: await inventory(path.join(root, 'src')), runtime: await inventory(path.join(root, 'dist')),
    runner: hash(await fs.readFile(fileURLToPath(import.meta.url))), fixtures: hash(await fs.readFile(path.join(root, 'tools/agent-benchmark-fixtures.mjs'))) }));
}
summary.candidateFingerprint = await candidateFingerprint();
let fallback;
const extraEnv = {};
if (route === 'fallback') {
  fallback = createServer((_req, res) => { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"ready":false}'); });
  await new Promise(resolve => fallback.listen(0, '127.0.0.1', resolve));
  // Exercise a configured but unavailable gateway without stopping the user's PowerRouter.
  extraEnv.JC_POWERROUTER_URL = 'http://127.0.0.1:' + fallback.address().port;
  extraEnv.JC_POWERROUTER_KEY = 'isolated-unavailable-gateway';
}
try {
  for (const name of family === 'all' ? fixtureNames : [family]) for (let iteration = 1; iteration <= repetitions; iteration++) {
    const definition = fixtureDefinition(name), dir = path.join(run, name + '-' + iteration);
    const target = path.join(dir, 'target'), control = path.join(dir, 'control'), oracle = path.join(dir, 'oracle.cjs');
    await fs.mkdir(target, { recursive: true }); await fs.mkdir(control);
    const commandGate = holdsCommand ? `
if (require('node:fs').existsSync(require('node:path').join(__dirname, 'hold-command'))) {
  require('node:fs').appendFileSync(require('node:path').join(__dirname, 'command-started'), 'started\\n');
  require('node:fs').writeFileSync(require('node:path').join(__dirname, 'command-pid'), String(process.pid));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120000);
  throw Error('COMMAND_GATE_TIMEOUT');
}
` : '';
    await fs.writeFile(oracle, commandGate + definition.oracle);
    for (const [file, content] of Object.entries(definition.files)) {
      await fs.writeFile(path.join(target, file), content); await fs.writeFile(path.join(control, file), definition.good[file] ?? content);
    }
    for (const [file, content] of Object.entries(definition.good)) if (!(file in definition.files)) await fs.writeFile(path.join(control, file), content);
    const record = { family: name, iteration, startedAt: new Date().toISOString(), objective: definition.objective, allowed: definition.allowed,
      before: await inventory(target), oracleHash: hash(await fs.readFile(oracle)), observations: [] };
    const persist = () => fs.writeFile(path.join(dir, 'result.json'), JSON.stringify(record, null, 2));
    const oracleRun = label => command([oracle, target], target, path.join(dir, label + '.log'));
    record.baseline = await oracleRun('before');
    record.control = await command([oracle, control], control, path.join(dir, 'control.log'));
    if (record.baseline.exitCode === 0 || record.baseline.timedOut || record.control.exitCode !== 0 || record.control.timedOut) {
      record.error = 'HARNESS_INVALID'; await persist(); throw Error('HARNESS_INVALID: ' + dir);
    }
    let child, logs = '', spawnError, base = '', cookie = '', csrf = '', jobId;
    async function request(method, endpoint, body) {
      const headers = { Origin: base, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() };
      if (cookie) headers.Cookie = cookie; if (csrf) headers['X-JC-CSRF'] = csrf;
      const response = await fetch(base + endpoint, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const data = await response.json(); if (data.csrfToken) csrf = data.csrfToken;
      if (!response.ok) throw Error(endpoint + ': HTTP ' + response.status + ' ' + JSON.stringify(data));
      return data;
    }
    async function launch(crashBoundary = '') {
      const logOffset = logs.length; spawnError = undefined; cookie = ''; csrf = '';
      child = spawn(process.execPath, [path.join(root, 'dist/index.js')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...extraEnv, JC_PORT: '0', JC_NO_OPEN: '1', JC_DATA_DIR: path.join(dir, 'runtime'), JC_MOCK_MODEL: '0',
          NODE_ENV: 'test', JC_ACCEPTANCE_CRASH_BOUNDARY: crashBoundary } });
      child.once('error', error => { spawnError = error; });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-2000000); });
      let match; const readyDeadline = Date.now() + 30000;
      while (!(match = logs.slice(logOffset).match(/(http:\/\/127\.0\.0\.1:\d+)\/bootstrap\.html#token=([\w-]+)/))) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || Date.now() > readyDeadline) throw Error('SERVER_START_FAILED'); await sleep(100);
      }
      base = match[1]; await request('POST', '/api/v1/session/exchange', { bootstrapToken: match[2] });
    }
    try {
      await launch(holdsCommand ? 'verification' : interruption);
      record.health = await request('GET', '/health');
      if (record.health.model.mockModel || (route === 'powerrouter' && !record.health.model.powerRouter.reachable)) throw Error('REQUIRED_REAL_PROVIDER_UNAVAILABLE');
      const project = await request('POST', '/api/v1/projects', { name: 'Agent benchmark ' + name, path: target });
      const threads = await request('GET', '/api/v1/projects/' + project.project.id + '/threads');
      const threadId = threads.selectedThreadId || threads.threads[0].id;
      const submitted = await request('POST', `/api/v1/projects/${project.project.id}/threads/${threadId}/agent-jobs`, { objective: definition.objective, mode: 'build', activeWorkOrderId: null, maxCloudCostUsd: 0 });
      jobId = submitted.job.id; record.jobId = jobId;
      const deadline = Date.now() + timeoutMs; let last = '';
      while (Date.now() < deadline) {
        record.detail = await request('GET', '/api/v1/agent-jobs/' + jobId);
        if (cancellation && !record.cancellation) {
          const order = record.detail.job.workOrderId ? (await request('GET', '/api/v1/work-orders/' + record.detail.job.workOrderId)).workOrder : null;
          if (order?.execution?.phase?.startsWith('verifying_')) await fs.writeFile(path.join(dir, 'hold-command'), 'armed');
          if (await fs.access(path.join(dir, 'command-pid')).then(() => true, () => false)) {
            record.cancellation = { requestedAt: Date.now(), commandPid: Number(await fs.readFile(path.join(dir, 'command-pid'), 'utf8')) };
            await request('POST', '/api/v1/agent-jobs/' + jobId + '/stop', {});
            console.log(name + '-' + iteration + ': requested stop during an active command');
          }
        }
        if (record.cancellation && !terminal(record.detail.job) && Date.now() - record.cancellation.requestedAt > 10000) throw Error('CANCELLATION_TIMEOUT');
        if (interruption && !record.recovery) {
          const order = record.detail.job.workOrderId ? (await request('GET', '/api/v1/work-orders/' + record.detail.job.workOrderId)).workOrder : null;
          const phase = order?.execution?.phase || '';
          if (interruption === 'command' && phase.startsWith('verifying_')) await fs.writeFile(path.join(dir, 'hold-command'), 'armed');
          const reached = interruption === 'inspection' ? record.detail.job.stage === 'inspect'
            : interruption === 'write' ? phase === 'committing'
            : interruption === 'command' ? await fs.access(path.join(dir, 'command-started')).then(() => true, () => false)
            : phase.startsWith('verifying_');
          if (reached) {
            record.recovery = { boundary: interruption, phase, interruptedAt: new Date().toISOString(), beforeCrash: record.detail };
            await stopTree(child);
            for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
            if (child.exitCode === null && child.signalCode === null) throw Error('OWNED_SERVER_DID_NOT_STOP');
            if (userEdit) {
              const file = definition.allowed.find(file => file in record.before);
              if (!file) throw Error('USER_EDIT_FIXTURE_REQUIRES_EXISTING_FILE');
              await fs.appendFile(path.join(target, file), file.endsWith('.bat') ? '\r\nrem later operator edit\r\n' : '\n// later operator edit\n');
              record.recovery.operatorHashes = await inventory(target);
            }
            await launch();
            record.detail = await request('GET', '/api/v1/agent-jobs/' + jobId);
            record.recovery.afterRestart = record.detail;
            record.recovery.restoredHashes = await inventory(target);
            if (record.detail.job.terminalState !== 'interrupted') throw Error('RESTART_DID_NOT_PRESERVE_INTERRUPTED_JOB');
            if (userEdit) {
              record.recovery.workOrder = (await request('GET', '/api/v1/work-orders/' + order.id)).workOrder;
              record.recovery.conflictPreserved = JSON.stringify(record.recovery.operatorHashes) === JSON.stringify(record.recovery.restoredHashes)
                && record.recovery.workOrder.execution?.phase === 'recovery_blocked';
              if (!record.recovery.conflictPreserved) throw Error('RECOVERY_OVERWROTE_USER_CHANGE_OR_DID_NOT_BLOCK');
              break;
            }
            if (JSON.stringify(record.before) !== JSON.stringify(record.recovery.restoredHashes)) throw Error('RECOVERY_DID_NOT_RESTORE_BASELINE');
            await request('POST', '/api/v1/agent-jobs/' + jobId + '/resume', {});
            console.log(name + '-' + iteration + ': resumed after ' + interruption);
            continue;
          }
        }
        const state = record.detail.job.status + '/' + record.detail.job.stage;
        if (state !== last) { record.observations.push({ at: new Date().toISOString(), state }); console.log(name + '-' + iteration + ': ' + state); last = state; }
        await persist(); if (terminal(record.detail.job)) break; await sleep((interruption && !record.recovery) || cancellation ? 25 : 500);
      }
      if (!terminal(record.detail?.job)) {
        record.timedOut = true; await request('POST', '/api/v1/agent-jobs/' + jobId + '/stop', {});
        for (let i = 0; i < 30 && !terminal(record.detail?.job); i++) { await sleep(500); record.detail = await request('GET', '/api/v1/agent-jobs/' + jobId); }
      }
      record.after = await inventory(target);
      record.changed = Object.keys(record.after).filter(file => record.before[file] !== record.after[file]);
      record.removed = Object.keys(record.before).filter(file => !(file in record.after));
      record.protectedFilesPreserved = Object.entries(record.before).every(([file, value]) => definition.allowed.includes(file) || record.after[file] === value);
      record.oraclePreserved = hash(await fs.readFile(oracle)) === record.oracleHash;
      record.sealedPaths = record.detail?.job.result?.workOrder?.scope?.exactPaths || [];
      record.scopeRespected = record.sealedPaths.length > 0 && record.sealedPaths.every(file => definition.allowed.includes(file));
      if (!holdsCommand && record.oraclePreserved && record.protectedFilesPreserved && terminal(record.detail?.job)) record.independent = await oracleRun('after');
      const result = record.detail?.job.result;
      record.passed = !record.timedOut && record.detail?.job.terminalState === 'completed' && result?.mockModel === false
        && result.provider === (route === 'powerrouter' ? 'powerrouter' : 'ollama') && record.scopeRespected
        && record.changed.length > 0 && record.changed.every(file => definition.allowed.includes(file)) && !record.removed.length
        && record.protectedFilesPreserved && record.oraclePreserved && record.independent?.exitCode === 0 && !record.independent.timedOut
        && record.detail.workflowBudget?.spentOrReservedUsd === 0;
      if (interruption && !userEdit) {
        const resultKeys = (record.detail.journal || []).filter(entry => entry.kind === 'tool_result').map(entry => entry.actionKey);
        record.passed = record.passed && !!record.recovery && record.detail.job.resumeCount === 1 && new Set(resultKeys).size === resultKeys.length;
      }
      if (userEdit) record.passed = record.recovery?.conflictPreserved === true && record.oraclePreserved && record.protectedFilesPreserved;
      if (interruption === 'command') {
        record.commandStarts = (await fs.readFile(path.join(dir, 'command-started'), 'utf8')).trim().split('\n').length;
        record.passed = record.detail.job.errorCode === 'COMMAND_OUTCOME_UNKNOWN' && record.detail.job.terminalState === 'failed_safe'
          && record.commandStarts === 1 && record.oraclePreserved && JSON.stringify(record.before) === JSON.stringify(record.after);
      }
      if (cancellation) {
        record.commandStarts = (await fs.readFile(path.join(dir, 'command-started'), 'utf8')).trim().split('\n').length;
        record.cancellation.durationMs = Date.now() - record.cancellation.requestedAt;
        let processStopped = false;
        try { process.kill(record.cancellation.commandPid, 0); } catch (error) { processStopped = error.code === 'ESRCH'; }
        record.cancellation.commandStopped = processStopped;
        record.cancellation.resultRecorded = record.detail.journal.some(entry => entry.kind === 'tool_result' && entry.payload?.cancelled === true);
        record.passed = !record.timedOut && record.detail.job.terminalState === 'cancelled'
          && record.cancellation.durationMs <= 10000 && processStopped && record.cancellation.resultRecorded
          && record.commandStarts === 1 && record.oraclePreserved && record.protectedFilesPreserved
          && JSON.stringify(record.before) === JSON.stringify(record.after)
          && record.detail.workflowBudget?.spentOrReservedUsd === 0;
      }
      if (record.passed) {
        // A second clean restart must retain terminal history without replaying tools.
        const priorState = record.detail.job.terminalState;
        const priorJournal = JSON.stringify(record.detail.journal);
        const priorResult = JSON.stringify(record.detail.job.result);
        await request('POST', '/api/v1/system/shutdown', { confirm: 'shutdown' });
        for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100);
        await stopTree(child);
        await launch();
        const retained = await request('GET', '/api/v1/agent-jobs/' + jobId);
        record.historySurvivedRestart = retained.job.terminalState === priorState
          && JSON.stringify(retained.journal) === priorJournal && JSON.stringify(retained.job.result) === priorResult;
        record.passed = record.historySurvivedRestart;
      }
    } catch (error) { record.error = error.message; record.passed = false; }
    finally {
      if (jobId && !terminal(record.detail?.job)) await request('POST', '/api/v1/agent-jobs/' + jobId + '/stop', {}).catch(() => {});
      await request('POST', '/api/v1/system/shutdown', { confirm: 'shutdown' }).catch(() => {});
      for (let i = 0; i < 50 && child?.exitCode === null; i++) await sleep(100);
      await stopTree(child);
      record.finishedAt = new Date().toISOString(); await persist();
      await fs.writeFile(path.join(dir, 'server.log'), logs.replace(/token=[\w-]+/g, 'token=[redacted]'));
      summary.cases.push({ family: name, iteration, passed: record.passed === true, result: path.relative(root, path.join(dir, 'result.json')), error: record.error || record.detail?.job.errorMessage });
      await fs.writeFile(path.join(run, 'summary.json'), JSON.stringify(summary, null, 2));
      console.log(name + '-' + iteration + ': ' + (record.passed ? 'PASS' : 'FAIL') + ' — ' + (record.error || record.detail?.job.errorMessage || dir));
    }
  }
} finally { if (fallback) await new Promise(resolve => fallback.close(resolve)); }
summary.finishedAt = new Date().toISOString();
summary.candidateUnchanged = summary.candidateFingerprint === await candidateFingerprint();
summary.passed = summary.candidateUnchanged && summary.cases.length > 0 && summary.cases.every(item => item.passed);
await fs.writeFile(path.join(run, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('Evidence: ' + run); process.exitCode = summary.passed ? 0 : 1;

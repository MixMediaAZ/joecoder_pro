import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { fixtureDefinition } from './agent-benchmark-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = path.join(root, '.jc/readiness', 'inspection-' + Date.now());
const runtime = path.join(run, 'runtime');
await fs.mkdir(run, { recursive: true });
console.log('Evidence: ' + run);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
const records = [], report = { startedAt: new Date().toISOString(), modelMode: 'real', cases: records, passed: false };
async function inventory(directory) {
  const entries = [];
  async function walk(dir) {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error('Unexpected fixture link');
      if (entry.isDirectory()) await walk(full);
      else entries.push([path.relative(directory, full), hash(await fs.readFile(full))]);
    }
  }
  await walk(directory); return entries;
}
async function stopTree(process) {
  if (!process?.pid || process.exitCode !== null || process.signalCode !== null) return;
  await new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('close', resolve); killer.once('error', resolve);
  });
}
async function baseline(target) {
  return new Promise(resolve => {
    const process = spawn(globalThis.process.execPath, ['check.cjs'], { cwd: target, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    let output = '', error;
    const timer = setTimeout(() => { error = 'BASELINE_TIMEOUT'; void stopTree(process); }, 20000);
    for (const stream of [process.stdout, process.stderr]) stream.on('data', value => output += value);
    process.once('error', value => { error = value.message; });
    process.once('close', exitCode => { clearTimeout(timer); resolve({ exitCode, error, output }); });
  });
}
let child, logs = '', base = '', cookie = '', csrf = '';
async function request(method, route, body) {
  const response = await fetch(base + route, { method, headers: {
    Origin: base, 'Content-Type': 'application/json', Cookie: cookie, 'X-JC-CSRF': csrf, 'Idempotency-Key': randomUUID()
  }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const data = await response.json(); if (data.csrfToken) csrf = data.csrfToken;
  if (!response.ok) throw Error(route + ': HTTP ' + response.status + ' ' + JSON.stringify(data));
  return data;
}
function assessReply(reply) {
  assert.match(reply, /start\.bat.*listed; contents not included/);
  assert.match(reply, /did not run the application, build or tests/);
  assert.match(reply, /check\.cjs/i);
  assert.match(reply, /oracle\.cjs/i);
  assert.match(reply, /outside|parent director|external (?:file|module|dependency)|\.\.\/oracle\.cjs/i);
  assert.match(reply, /unknown|unverified|not (?:checked|inspected|verified)|cannot (?:determine|confirm|verify)/i);
  const referenceClaims = reply.split(/(?<=[.!?])\s+|\n+/).filter(sentence => /oracle\.cjs/i.test(sentence));
  for (const claim of referenceClaims) assert.doesNotMatch(claim, /\b(?:is missing|was not found|does not exist|(?:has|found|is) a missing dependency|build blocker|broken dependency)\b/i);
  assert.doesNotMatch(reply, /\b(?:appears?|seems?)\s+(?:to be\s+)?(?:operational|functional)|\bruns?\s+without errors\b|\btests?\s+(?:(?:have|has)\s+)?passed\b/i);
  assert.doesNotMatch(reply, /\b(?:operational|functional) (?:components?|features?|systems?|applications?|parts?|builds?)\b/i);
  assert.doesNotMatch(reply, /EXTERNAL_PRIVATE_MARKER/);
}
const expectedFiles = ['check.cjs', 'package-lock.json', 'package.json', 'server.cjs', 'start.bat'];
function assessFacts(response, source, expected = expectedFiles) {
  const facts = response.inspection;
  assert.equal(facts?.version, 1);
  assert.equal(facts.source, source);
  assert.equal(facts.observedFileCount, expected.length);
  assert.deepEqual([...facts.listedFiles].sort(), [...expected].sort());
  assert.equal(facts.excerptFiles.includes('start.bat'), false);
  assert.equal(facts.runtimeChecks, 'not_run_by_inspection');
  assert.ok(facts.unverifiedReferences.some(ref => ref.sourcePath === 'check.cjs' && ref.specifier === '../oracle.cjs' && ref.scope === 'outside_project'));
  assert.ok(response.evidenceId);
  assert.ok(Number.isFinite(Date.parse(facts.capturedAt)));
}
try {
  child = spawn(process.execPath, [path.join(root, 'dist/index.js')], { cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe'],
    env: { ...process.env, JC_PORT: '0', JC_NO_OPEN: '1', JC_DATA_DIR: runtime, JC_MOCK_MODEL: '0' } });
  let startError;
  child.once('error', error => { startError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { logs = (logs + value).slice(-1000000); });
  let match; const deadline = Date.now() + 30000;
  while (!(match = logs.match(/(http:\/\/127\.0\.0\.1:\d+)\/bootstrap\.html#token=([\w-]+)/))) {
    if (startError) throw startError;
    if (child.exitCode !== null || Date.now() > deadline) throw Error('SERVER_START_FAILED');
    await sleep(100);
  }
  base = match[1]; await request('POST', '/api/v1/session/exchange', { bootstrapToken: match[2] });
  report.health = await request('GET', '/health');
  assert.equal(report.health.model.mockModel, false);
  assert.equal(report.health.model.powerRouter.reachable, true);
  for (const externalPresent of [true, false]) {
    const name = externalPresent ? 'external-present' : 'external-absent';
    const dir = path.join(run, name), target = path.join(dir, 'project');
    await fs.mkdir(target, { recursive: true });
    const definition = fixtureDefinition('startup');
    for (const [file, content] of Object.entries({ ...definition.files, ...definition.good })) await fs.writeFile(path.join(target, file), content);
    if (externalPresent) await fs.writeFile(path.join(dir, 'oracle.cjs'), '// EXTERNAL_PRIVATE_MARKER\n' + definition.oracle);
    const record = { name, before: await inventory(dir), baseline: await baseline(target), responses: [] };
    records.push(record);
    assert.equal(record.baseline.error, undefined);
    assert.equal(record.baseline.exitCode, externalPresent ? 0 : 1);
    const project = (await request('POST', '/api/v1/projects', { name, path: target })).project;
    const threads = await request('GET', '/api/v1/projects/' + project.id + '/threads');
    const threadId = threads.selectedThreadId || threads.threads[0].id;
    record.projectId = project.id; record.threadId = threadId;
    const threadRoute = `/api/v1/projects/${project.id}/threads/${threadId}/chat`;
    const content = 'Inspect this build read-only and summarize its current condition.';
    for (const [routeName, route] of [['thread-fresh', threadRoute], ['legacy-fresh', `/api/v1/projects/${project.id}/chat`]]) {
      const response = await request('POST', route, { content, mode: 'ask' });
      record.responses.push({ route: routeName, replyId: response.reply.id, reply: response.reply.content, facts: response.inspection, evidenceId: response.evidenceId });
      assessReply(response.reply.content); assessFacts(response, 'fresh_read');
      console.log(name + ': ' + routeName + ' PASS');
    }
    const submitted = await request('POST', `/api/v1/projects/${project.id}/threads/${threadId}/agent-jobs`, { objective: content, mode: 'build', activeWorkOrderId: null, maxCloudCostUsd: 0 });
    const jobDeadline = Date.now() + 120000;
    do {
      record.job = await request('GET', '/api/v1/agent-jobs/' + submitted.job.id);
      if (['completed','failed','cancelled','interrupted'].includes(record.job.job.status)) break;
      await sleep(250);
    } while (Date.now() < jobDeadline);
    assert.equal(record.job.job.terminalState, 'completed');
    assert.equal(record.job.job.intent, 'inspect');
    const messages = await request('GET', threadRoute);
    const jobReply = messages.messages.filter(message => message.role === 'assistant').at(-1);
    record.responses.push({ route: 'inspection-job', replyId: jobReply.id, reply: jobReply.content }); assessReply(jobReply.content);
    // Explicit "read" requests refresh files even when a survey exists. Ask about
    // the recorded survey here, and verify the evidence ID actually used below.
    record.surveyId = (await request('GET', `/api/v1/projects/${project.id}`)).project.latestSurveyId;
    assert.ok(record.surveyId);
    const recorded = await request('POST', threadRoute, { content: 'Summarize the condition shown by the recorded project survey.', mode: 'ask' });
    record.recordedReplyId = recorded.reply.id;
    record.responses.push({ route: 'thread-recorded', replyId: recorded.reply.id, reply: recorded.reply.content, facts: recorded.inspection, evidenceId: recorded.evidenceId });
    assessReply(recorded.reply.content); assessFacts(recorded, 'recorded_survey');
    assert.match(recorded.reply.content, /files have not been refreshed/);
    record.after = await inventory(dir); assert.deepEqual(record.after, record.before);
    assert.equal(record.job.job.maxCloudCostUsd, 0);
    assert.equal(record.job.workflowBudget, null, 'Inspection must not allocate a model workflow budget');
    record.passed = true; console.log(name + ': job, recorded survey and source preservation PASS');
  }
  // Summaries deliberately use observations, not model prose. Verify the ordinary
  // Ask route separately so deterministic receipts cannot hide a broken provider.
  const probeCase = records[0];
  const modelResponse = await request('POST', `/api/v1/projects/${probeCase.projectId}/threads/${probeCase.threadId}/chat`, {
    content: 'Explain how server.cjs chooses its port and what check.cjs imports from ../oracle.cjs.', mode: 'ask'
  });
  report.modelProbe = { replyId: modelResponse.reply.id, reply: modelResponse.reply.content };
  assert.equal(modelResponse.inspection, undefined);
  assert.match(modelResponse.reply.content, /server\.cjs/i);
  assert.match(modelResponse.reply.content, /check\.cjs/i);
  assert.match(modelResponse.reply.content, /oracle\.cjs/i);
  assert.doesNotMatch(modelResponse.reply.content, /EXTERNAL_PRIVATE_MARKER/);
  // A deliberate runner-owned addition distinguishes a current read from an old
  // survey. Neither request may edit the resulting fixture or its external file.
  const driftDir = path.join(run, probeCase.name);
  await fs.writeFile(path.join(driftDir, 'project', 'later-note.txt'), 'Added by the verification runner after the recorded survey.\n');
  report.freshness = { before: await inventory(driftDir), responses: [] };
  for (const [source, content] of [
    ['fresh_read', 'Summarize the current project condition.'],
    ['recorded_survey', 'Summarize the condition shown by the recorded project survey.']
  ]) {
    const response = await request('POST', `/api/v1/projects/${probeCase.projectId}/threads/${probeCase.threadId}/chat`, { content, mode: 'ask' });
    assessFacts(response, source, source === 'fresh_read' ? [...expectedFiles, 'later-note.txt'] : expectedFiles);
    assessReply(response.reply.content);
    if (source === 'recorded_survey') assert.equal(response.evidenceId, probeCase.surveyId);
    report.freshness.responses.push({ replyId: response.reply.id, facts: response.inspection, evidenceId: response.evidenceId, reply: response.reply.content });
  }
  report.freshness.after = await inventory(driftDir);
  assert.deepEqual(report.freshness.after, report.freshness.before);
  const events = (await fs.readFile(path.join(runtime, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  report.chatEvents = events.filter(event => event.type === 'chat.responded').map(event => event.payload);
  for (const record of records) {
    assert.equal(report.chatEvents.find(event => event.assistantMessageId === record.recordedReplyId)?.evidenceSurveyId, record.surveyId);
    for (const response of record.responses) {
      const event = report.chatEvents.find(event => event.assistantMessageId === response.replyId);
      assert.equal(event?.responseSource, 'inspection_evidence');
      assert.equal(event?.modelProvider, null);
    }
  }
  for (const response of report.freshness.responses) {
    const event = report.chatEvents.find(event => event.assistantMessageId === response.replyId);
    assert.equal(event?.responseSource, 'inspection_evidence');
    assert.equal(event?.modelProvider, null);
  }
  const probeEvent = report.chatEvents.find(event => event.assistantMessageId === report.modelProbe.replyId);
  assert.equal(probeEvent?.responseSource, 'model');
  assert.ok(probeEvent?.modelProvider?.startsWith('powerrouter/'), 'Require an accepted PowerRouter answer to the separate code question');
  report.modelProbe.provider = probeEvent.modelProvider;
  report.passed = records.length === 2 && records.every(record => record.passed);
  if (process.argv.includes('--hold') && report.passed) {
    // Optional bounded browser verification window; release by creating run/release.
    const state = JSON.parse(await fs.readFile(path.join(runtime, 'server-runtime.json'), 'utf8'));
    const response = await fetch(base + '/api/v1/launcher/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JC-Launcher-Secret': state.launcherSecret }, body: '{}' });
    console.log('Browser: ' + (await response.json()).bootstrapUrl);
    await fs.writeFile(path.join(run, 'result.json'), JSON.stringify(report, null, 2));
    const holdDeadline = Date.now() + 180000;
    while (Date.now() < holdDeadline && child.exitCode === null && !(await fs.access(path.join(run, 'release')).then(() => true, () => false))) await sleep(250);
  }
} catch (error) { report.error = error.stack || error.message; report.passed = false; }
finally {
  if (child) {
    await request('POST', '/api/v1/system/shutdown', { confirm: 'shutdown' }).catch(() => {});
    for (let i=0; i<50 && child.exitCode === null; i++) await sleep(100);
    await stopTree(child);
  }
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(run, 'result.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(run, 'server.log'), logs.replace(/token=[\w-]+/g, 'token=[redacted]'));
}
console.log((report.passed ? 'PASS' : 'FAIL') + ': ' + (report.error || run));
process.exitCode = report.passed ? 0 : 1;

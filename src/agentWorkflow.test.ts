import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeDatabase, closeDatabase, upsertProject, ensureProjectThread, createAgentJob, requestAgentJobStop, appendAgentJobJournal, listAgentJobJournal, updateAgentJob, getAgentJob } from './database/database.js';
import { withAgentJob, budgetedModelCall, reserveToolAction, workflowBudget, checkWorkflow } from './agentWorkflowBudget.js';
import { investigateProject } from './agentInvestigation.js';
import { applyEdits, bindEditsToReadFiles, snapshotScopedFiles, rollbackToSnapshot } from './mutation.js';
import { projectProcessEnvironment } from './processPolicy.js';
import { runBoundedProcess } from './boundedProcess.js';
import { listJobChanges, readJobChange } from './jobChanges.js';
import { saveOperatorFile } from './operatorFiles.js';
import { runVerification } from './verification.js';
import { runAgentRuntimeStep } from './agentRuntime.js';
import { executeGovernedTool } from './governedTools.js';
import type { GovernedToolContext } from './governedToolTypes.js';
import type { WorkOrder } from './types.js';
import type { Project } from './types.js';

async function fixture(t: import('node:test').TestContext, cloudBudget = 0) {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'jc-workflow-'));
  t.after(async () => { closeDatabase(); assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith('jc-workflow-')); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  await initializeDatabase(path.join(root, 'state'));
  const project: Project = { id: 'proj-workflow-project', name: 'Workflow', path: root, createdAt: Date.now(),
    workflowStage: 'surface_review_ready', buildCondition: 'unknown', executionMode: 'auto',
    permissions: { readFiles: true, writeFiles: true, installDeps: false, runApp: true, runTests: true, gitCommit: false, gitPush: false } };
  upsertProject(project);
  const thread = ensureProjectThread(project.id, project.name);
  const job = createAgentJob({ projectId: project.id, threadId: thread.id, objective: 'Fix the helper.', maxCloudCostUsd: cloudBudget });
  return { root, project, job };
}

test('job budget survives restart and counts uncertain model calls conservatively', async t => {
  const { root, job } = await fixture(t, 1);
  await withAgentJob(job.id, async () => {
    await budgetedModelCall({ provider: 'deepseek', reserveUsd: 0.4, run: async () => ({ cost: 0.1 }), actualCost: result => result.cost });
    await assert.rejects(budgetedModelCall({ provider: 'replicate', reserveUsd: 0.5, run: async () => { throw new Error('connection lost'); } }), /connection lost/);
    const before = workflowBudget()!;
    assert.equal(before.modelTurns, 2);
    assert.ok(Math.abs(before.spentOrReservedUsd - 0.6) < 1e-9);
    closeDatabase(); await initializeDatabase(path.join(root, 'state'));
    assert.deepEqual(workflowBudget(), before);
    let dispatched = false;
    await assert.rejects(budgetedModelCall({ provider: 'deepseek', reserveUsd: 0.5, run: async () => { dispatched = true; } }), /remaining job cloud budget/);
    assert.equal(dispatched, false);
  });
});

test('tool limits and Stop remain enforced across phases', async t => {
  const { job } = await fixture(t);
  await withAgentJob(job.id, async () => {
    for (let i = 0; i < 40; i++) reserveToolAction();
    assert.throws(() => reserveToolAction(), /40 permitted/);
    requestAgentJobStop(job.id);
    assert.throws(() => checkWorkflow(), /Stop/);
  });
});

test('investigation reads real files, rejects mutation requests and reuses durable results', async t => {
  const { root, project, job } = await fixture(t);
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'helper.ts'), 'export const answer = 41;\n');
  let calls = 0;
  const responses = [
    { tool: 'files.delete', input: { path: 'src/helper.ts' }, reason: 'invalid' },
    { tool: 'files.search', input: { query: 'answer', path: 'src' }, reason: 'Find the helper' },
    { tool: 'files.read', input: { path: 'src/helper.ts' }, reason: 'Read its implementation' },
    { done: true, summary: 'The helper returns 41.' }
  ];
  const options = { projectId: project.id, projectRoot: root, objective: 'Fix the helper.', phase: 'test',
    provider: { available: true, provider: 'ollama' as const, model: 'fixture', reason: 'test' }, initialContext: 'Look in src.', maxSteps: 5,
    generate: async (request: { prompt: string }) => {
      const response = responses[calls++];
      if (calls === 4) assert.match(request.prompt, /answer = 41/);
      return { text: JSON.stringify(response), provider: 'ollama' as const, model: 'test-control', durationMs: 1 };
    } };
  const result = await withAgentJob(job.id, () => investigateProject(options));
  assert.match(result.context, /answer = 41/);
  assert.equal(result.limited, false);
  assert.equal(result.evidenceIds.length, 2);
  const callsBeforeReplay = calls;
  const replay = await withAgentJob(job.id, () => investigateProject(options));
  assert.match(replay.context, /answer = 41/);
  assert.equal(calls, callsBeforeReplay);
  assert.equal(await fs.readFile(path.join(root, 'src', 'helper.ts'), 'utf8'), 'export const answer = 41;\n');
  assert.equal(listAgentJobJournal(job.id).filter(row => row.kind === 'tool_result').length, 2);
});

test('model edits preserve BOM/CRLF and reject changes made since the read', async t => {
  const { root } = await fixture(t);
  const original = '\uFEFFexport const value = 1;\r\n';
  await fs.writeFile(path.join(root, 'source.ts'), original);
  const files = [{ relPath: 'source.ts', exists: true, content: original, truncated: false }];
  const edits = bindEditsToReadFiles([{ relPath: 'source.ts', content: 'export const value = 2;\n' }], files);
  assert.equal(edits[0]?.content, '\uFEFFexport const value = 2;\r\n');
  await fs.writeFile(path.join(root, 'source.ts'), 'user change\n');
  await assert.rejects(applyEdits(root, edits, { scopeRelPaths: ['source.ts'], maxFiles: 1 }), /EDIT_VERSION_CONFLICT/);
  assert.equal(await fs.readFile(path.join(root, 'source.ts'), 'utf8'), 'user change\n');
});

test('rollback never replaces a later user edit', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'source.ts'), 'before\n');
  const snapshots = path.join(root, 'snapshots');
  const snapshot = await snapshotScopedFiles(root, ['source.ts'], snapshots);
  const applied = await applyEdits(root, [{ relPath: 'source.ts', content: 'job output\n' }], { scopeRelPaths: ['source.ts'], maxFiles: 1 });
  await fs.writeFile(path.join(root, 'source.ts'), 'later user edit\n');
  const result = await rollbackToSnapshot(snapshots, snapshot, { expectedCurrentHashes: { 'source.ts': applied.applied[0]!.newHash } });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0]!.reason, /RESTORE_CONFLICT/);
  assert.equal(await fs.readFile(path.join(root, 'source.ts'), 'utf8'), 'later user edit\n');
});

test('real commands do not inherit provider secrets and report output limits', async t => {
  const { root } = await fixture(t);
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-private-value-1234';
  try {
    const result = await runBoundedProcess(process.execPath,
      ['-e', "console.log(process.env.DEEPSEEK_API_KEY || 'absent');console.log('x'.repeat(1000));"],
      { cwd: root, timeoutMs: 5000, env: projectProcessEnvironment(), maxOutputCharacters: 200 });
    assert.equal(result.exitCode, 0);
    assert.equal(result.outputTruncated, true);
    assert.doesNotMatch(result.stdout, /test-private-value/);
    const check = await runBoundedProcess(process.execPath, ['-e', "console.log(process.env.DEEPSEEK_API_KEY || 'absent')"],
      { cwd: root, timeoutMs: 5000, env: projectProcessEnvironment() });
    assert.equal(check.stdout.trim(), 'absent');
  } finally { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous; }
});

test('Stop cancels an active owned command and records its real result', async t => {
  const { root, job } = await fixture(t);
  await withAgentJob(job.id, async () => {
    const timer = setTimeout(() => requestAgentJobStop(job.id), 500);
    const result = await runBoundedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
      { cwd: root, timeoutMs: 10000, env: projectProcessEnvironment() });
    clearTimeout(timer);
    assert.equal(result.cancelled, true);
    assert.ok(result.durationMs < 7000);
    assert.ok(listAgentJobJournal(job.id).some(entry => entry.kind === 'tool_result' && (entry.payload as any).cancelled));
  });
});

test('job review uses pre-job bytes and locked restore refuses later changes', async t => {
  const { root, job } = await fixture(t);
  const original = '\uFEFFuser uncommitted work\r\n';
  await fs.writeFile(path.join(root, 'source.ts'), original);
  const snapshots = path.join(root, 'snapshots');
  const snapshot = await snapshotScopedFiles(root, ['source.ts', 'new.ts'], snapshots);
  const applied = await applyEdits(root, [{ relPath: 'source.ts', content: 'agent output\n' }, { relPath: 'new.ts', content: 'created\n' }],
    { scopeRelPaths: ['source.ts', 'new.ts'], maxFiles: 2 });
  const workOrder = { id: 'JC20-review', execution: { snapshotId: snapshot.snapshotId } } as WorkOrder;
  const finished = { ...job, workOrderId: workOrder.id, status: 'completed' as const, result: applied };
  assert.equal((await listJobChanges(finished, workOrder, root, snapshots)).files.length, 2);
  const review = await readJobChange(finished, workOrder, root, snapshots, 'source.ts');
  assert.match(review.diff, /user uncommitted work/);
  assert.match(review.diff, /agent output/);
  assert.equal(review.canRestore, process.platform === 'win32');
  assert.equal((await readJobChange(finished, workOrder, root, snapshots, 'new.ts')).canRestore, false);
  await assert.rejects(readJobChange(finished, workOrder, root, snapshots, '../outside.ts'), /reviewable/);
  await assert.rejects(readJobChange(finished, { ...workOrder, id: 'wrong' }, root, snapshots, 'source.ts'), /no reviewable/);
  await fs.writeFile(path.join(root, 'source.ts'), 'later user content');
  assert.equal((await readJobChange(finished, workOrder, root, snapshots, 'source.ts')).canRestore, false);
  const save = { root, projectId: job.projectId, relative: 'source.ts', storage: path.join(root, 'receipts'),
    sessionId: 'workflow-test', expectedSha256: review.currentSha256, ...review.restore };
  if (process.platform === 'win32') {
    await assert.rejects(saveOperatorFile(save), /file changed/);
    await fs.writeFile(path.join(root, 'source.ts'), 'agent output\n');
    await saveOperatorFile(save);
    assert.equal(await fs.readFile(path.join(root, 'source.ts'), 'utf8'), original);
    assert.equal((await readJobChange(finished, workOrder, root, snapshots, 'source.ts')).canRestore, false);
  }
});

test('write intent survives a mid-batch failure and rollback recognizes prior job versions', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'a.ts'), 'baseline');
  const snapshot = await snapshotScopedFiles(root, ['a.ts', 'b.ts'], path.join(root, 'snapshots'));
  let intents: Record<string, string> = {};
  await assert.rejects(applyEdits(root, [{ relPath: 'a.ts', content: 'first' }, { relPath: 'b.ts', content: 'second' }], {
    scopeRelPaths: ['a.ts', 'b.ts'], maxFiles: 2,
    onPrepared: async hashes => { intents = hashes; await fs.writeFile(path.join(root, 'intent.json'), JSON.stringify(hashes)); },
    beforeWrite: (_rel, index) => { assert.ok(intents['a.ts']); if (index === 1) throw new Error('injected disk failure'); }
  }), /injected disk failure/);
  assert.equal(await fs.readFile(path.join(root, 'a.ts'), 'utf8'), 'baseline');
  await fs.writeFile(path.join(root, 'a.ts'), 'first');
  const durable = JSON.parse(await fs.readFile(path.join(root, 'intent.json'), 'utf8'));
  const rolled = await rollbackToSnapshot(path.join(root, 'snapshots'), snapshot, {
    expectedCurrentHashes: Object.fromEntries(Object.entries(durable).map(([file, digest]) => [file, [String(digest)]]))
  });
  assert.equal(rolled.failures.length, 0);
  assert.equal(await fs.readFile(path.join(root, 'a.ts'), 'utf8'), 'baseline');
});

test('verification detects a real project script rewriting source', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'source.js'), 'original');
  await fs.writeFile(path.join(root, 'check.cjs'), "require('node:fs').writeFileSync('source.js','unexpected')");
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node check.cjs' } }));
  await assert.rejects(runVerification(root, { timeoutMs: 10000 }), /SOURCE_CHECK_SIDE_EFFECT.*source.js/);
});

test('future checkpoint versions are preserved rather than restarted', async t => {
  const { job } = await fixture(t);
  updateAgentJob(job.id, { runtimeState: { schemaVersion: 999, completedActions: ['capture_objective'] } });
  let dispatched = false;
  await assert.rejects(runAgentRuntimeStep(job.id, { execute: async () => { dispatched = true; return {}; } }),
    /AGENT_RUNTIME_VERSION_UNSUPPORTED/);
  assert.equal(dispatched, false);
  assert.equal(getAgentJob(job.id)?.runtimeState.schemaVersion, 999);
});


test('restart never replays a command with an uncertain outcome', async t => {
  const { root, job } = await fixture(t);
  appendAgentJobJournal({ jobId: job.id, kind: 'tool_request', stage: 'verify', actionKey: 'command-interrupted',
    payload: { command: process.execPath, args: ['check.js'], cwd: root } });
  closeDatabase(); await initializeDatabase(path.join(root, 'state'));
  let dispatched = false;
  const result = await runAgentRuntimeStep(job.id, { execute: async () => { dispatched = true; return {}; } });
  assert.equal(dispatched, false);
  assert.equal(result.job.errorCode, 'COMMAND_OUTCOME_UNKNOWN');
  assert.equal(result.job.terminalState, 'failed_safe');
});

function commandContext(root: string): GovernedToolContext {
  return { projectId: 'proj-workflow-project', jobId: 'command-test', workOrderId: null, projectRoot: root,
    snapshotsRoot: path.join(root, '.snapshots'), artifactsRoot: path.join(root, '.artifacts'),
    authority: { mode: 'mutating', exactPaths: [], operations: ['run_tests'], maxFiles: 0, maxDurationMs: 10000, maxOutputBytes: 20000 },
    recordEvidence: async () => ({ id: 'command-evidence' }) };
}

test('governed commands run nested packages and report failures with complete receipts', async t => {
  const { root } = await fixture(t);
  await fs.mkdir(path.join(root, 'nested package'));
  await fs.writeFile(path.join(root, 'nested package', 'check.cjs'), 'console.log("nested command");process.exitCode=2;');
  await fs.writeFile(path.join(root, 'nested package', 'package.json'), JSON.stringify({ scripts: { test: 'node check.cjs' } }));
  const context = commandContext(root);
  const result = await executeGovernedTool({ name: 'project.run_check', input: { check: 'test', packagePath: 'nested package' } }, context);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (!result.ok) return;
  const receipt = result.summary as any;
  assert.equal(receipt.passed, false);
  assert.equal(receipt.exitCode, 2);
  assert.equal(receipt.cancelled, false);
  assert.equal(receipt.outputTruncated, false);
  assert.ok(receipt.durationMs >= 0);
  assert.match(receipt.stdout, /nested command/);
  assert.equal(receipt.cwd, undefined); // cwd is recorded in the command profile journal, not fabricated here.
  const escape = await executeGovernedTool({ name: 'project.run_check', input: { check: 'test', packagePath: '../outside' } }, context);
  assert.equal(escape.ok, false);
  const denied = await executeGovernedTool({ name: 'project.run_check', input: { check: 'test', packagePath: 'nested package' } },
    { ...context, authority: { ...context.authority, mode: 'read_only' } });
  assert.equal(denied.ok, false);
});

test('governed checks reject success when a script changes source', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'source.js'), 'original');
  await fs.writeFile(path.join(root, 'check.cjs'), "require('node:fs').writeFileSync('source.js','unexpected')");
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node check.cjs' } }));
  const result = await executeGovernedTool({ name: 'project.run_check', input: { check: 'test' } }, commandContext(root));
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (!result.ok) return;
  assert.equal((result.summary as any).passed, false);
  assert.equal((result.summary as any).code, 'SOURCE_CHECK_SIDE_EFFECT');
  assert.deepEqual((result.summary as any).changedSources, ['source.js']);
});

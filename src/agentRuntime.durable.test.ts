import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  appendAgentJobJournal,
  closeDatabase,
  createAgentJob,
  ensureProjectThread,
  getActiveAgentJob,
  getAgentJob,
  getAgentJobCheckpoint,
  initializeDatabase,
  interruptRunningAgentJobs,
  listActiveReadOnlyAgentJobs,
  listAgentJobJournal,
  listAgentJobEvents,
  resumeInterruptedAgentJob,
  upsertProject
} from './database/database.js';
import {
  AGENT_ACTION_CATALOG,
  runAgentRuntimeStep,
  type AgentRuntimeAction,
  type AgentRuntimeDriver
} from './agentRuntime.js';
import type { Project } from './types.js';

function fixtureProject(root: string): Project {
  return {
    id: 'proj-agent-runtime',
    name: 'Agent Runtime Fixture',
    path: root,
    createdAt: Date.now(),
    workflowStage: 'surface_review_ready',
    buildCondition: 'partly_working',
    executionMode: 'auto',
    revision: 1,
    permissions: {
      readFiles: true,
      writeFiles: true,
      installDeps: false,
      runApp: true,
      runTests: true,
      gitCommit: false,
      gitPush: false
    }
  };
}

function deterministicDriver(calls: Map<AgentRuntimeAction, number>): AgentRuntimeDriver {
  return {
    async execute({ action }) {
      calls.set(action, (calls.get(action) || 0) + 1);
      switch (action) {
        case 'capture_objective':
          return {
            statePatch: { objectiveRecorded: true },
            journals: [{ kind: 'decision', payload: { objectiveAccepted: true } }]
          };
        case 'establish_evidence':
          return { statePatch: { evidenceReady: true, surveyEvidenceId: 'EVC-runtime-test' }, evidenceId: 'EVC-runtime-test' };
        case 'produce_plan':
          return {
            statePatch: { planRevision: 1, workOrderId: 'JC20-M2-999', budgets: { maxFiles: 3 }, plan: { objective: 'Repair the fixture.', scope: { exactPaths: ['src/fix.ts'], operations: ['edit_files'] } } },
            jobPatch: { workOrderId: null, intent: 'repair' },
            journals: [
              { kind: 'plan_revision', payload: { revision: 1, files: ['src/fix.ts'] } },
              { kind: 'budget', payload: { maxFiles: 3, maxAttempts: 2 } }
            ]
          };
        case 'seal_authorization':
          return {
            statePatch: { authorizationSealed: true },
            journals: [{ kind: 'decision', payload: { authorization: 'sealed' } }]
          };
        case 'execute_change':
          return { statePatch: { executionResult: { changed: ['src/fix.ts'], evidenceId: 'EVC-runtime-verified' } }, evidenceId: 'EVC-runtime-verified' };
        case 'evaluate_verification':
          return {
            statePatch: {
              verification: { passed: true },
              requestedTerminalState: 'completed',
              requestedTerminalReason: 'Runtime fixture passed.'
            },
            journals: [{ kind: 'verification', payload: { passed: true } }]
          };
        case 'finalize':
          return { terminalState: 'completed', terminalReason: 'Runtime fixture passed.' };
      }
    }
  };
}

test('durable runtime resumes after every transition without repeating an action', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-agent-runtime-'));
  try {
    await initializeDatabase(root);
    const project = fixtureProject(root);
    upsertProject(project);
    const thread = ensureProjectThread(project.id, project.name);
    const job = createAgentJob({ projectId: project.id, threadId: thread.id, objective: 'Repair the fixture.' });
    const calls = new Map<AgentRuntimeAction, number>();
    const driver = deterministicDriver(calls);

    for (let index = 0; index < AGENT_ACTION_CATALOG.length; index += 1) {
      const step = await runAgentRuntimeStep(job.id, driver);
      assert.equal(step.action, AGENT_ACTION_CATALOG[index]);
      assert.equal(step.recoveredResult, false);
      if (step.terminal) break;

      closeDatabase();
      await initializeDatabase(root);
      assert.equal(interruptRunningAgentJobs(), 1);
      const interrupted = getAgentJob(job.id)!;
      assert.equal(interrupted.status, 'interrupted');
      assert.equal(interrupted.terminalState, 'interrupted');
      const resumed = resumeInterruptedAgentJob(job.id);
      assert.equal(resumed.status, 'queued');
      assert.equal(resumed.terminalState, null);
    }

    const completed = getAgentJob(job.id)!;
    assert.equal(completed.status, 'completed');
    assert.equal(completed.terminalState, 'completed');
    assert.equal(completed.message, 'Runtime fixture passed.');
    assert.equal(completed.stateVersion, AGENT_ACTION_CATALOG.length);
    assert.deepEqual(completed.runtimeState.completedActions, [...AGENT_ACTION_CATALOG]);
    for (const action of AGENT_ACTION_CATALOG) assert.equal(calls.get(action), 1, `${action} repeated`);

    const checkpoint = getAgentJobCheckpoint(job.id)!;
    assert.equal(checkpoint.stateVersion, AGENT_ACTION_CATALOG.length);
    assert.match(checkpoint.lastCompletedAction || '', /finalize/);
    const journal = listAgentJobJournal(job.id);
    const kinds = new Set(journal.map((entry) => entry.kind));
    for (const kind of [
      'turn', 'tool_request', 'tool_result', 'plan_revision', 'budget',
      'checkpoint', 'verification', 'terminal', 'decision'
    ]) assert.ok(kinds.has(kind as never), `journal is missing ${kind}`);
    assert.equal(new Set(journal.map((entry) => entry.ordinal)).size, journal.length);
    const events = listAgentJobEvents(job.id);
    assert.ok(events.some(event => (event.payload as { category?: string }).category === 'Found'));
    assert.ok(events.some(event => (event.payload as { category?: string }).category === 'Changed'));
    assert.ok(events.some(event => (event.payload as { category?: string }).category === 'Checked'));
    const authorization = events.find(event => event.what.startsWith('Automatic authorization:'));
    assert.match(authorization?.meaning || '', /only in 1 named file/);
    const completion = events.find(event => /completed/i.test(event.what));
    assert.equal((completion?.payload as { evidenceId?: string }).evidenceId, 'EVC-runtime-verified');
  } finally {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('persisted tool result completes its checkpoint without invoking the driver again', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-agent-recovery-'));
  try {
    await initializeDatabase(root);
    const project = fixtureProject(root);
    upsertProject(project);
    const thread = ensureProjectThread(project.id, project.name);
    const job = createAgentJob({ projectId: project.id, threadId: thread.id, objective: 'Recover the fixture.' });
    const actionKey = `${job.id}-capture_objective-r0-a0`;
    appendAgentJobJournal({
      jobId: job.id,
      kind: 'tool_result',
      stage: 'understand',
      actionKey,
      payload: { statePatch: { objectiveRecorded: true } }
    });
    const step = await runAgentRuntimeStep(job.id, {
      async execute() {
        throw new Error('driver must not run for a persisted result');
      }
    });
    assert.equal(step.recoveredResult, true);
    assert.equal(step.terminal, false);
    assert.deepEqual(getAgentJob(job.id)?.runtimeState.completedActions, ['capture_objective']);
    assert.equal(getAgentJobCheckpoint(job.id)?.stateVersion, 1);
  } finally {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('one mutating job is enforced while read-only jobs remain concurrent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-agent-concurrency-'));
  try {
    await initializeDatabase(root);
    const project = fixtureProject(root);
    upsertProject(project);
    const thread = ensureProjectThread(project.id, project.name);
    const mutating = createAgentJob({
      projectId: project.id,
      threadId: thread.id,
      objective: 'Mutate once.',
      mode: 'mutating'
    });
    assert.throws(() => createAgentJob({
      projectId: project.id,
      threadId: thread.id,
      objective: 'Compete.',
      mode: 'mutating'
    }), /UNIQUE constraint failed/);
    createAgentJob({ projectId: project.id, threadId: thread.id, objective: 'Read one.', mode: 'read_only' });
    createAgentJob({ projectId: project.id, threadId: thread.id, objective: 'Read two.', mode: 'read_only' });
    assert.equal(getActiveAgentJob(project.id)?.id, mutating.id);
    assert.equal(listActiveReadOnlyAgentJobs(project.id).length, 2);
  } finally {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  }
});


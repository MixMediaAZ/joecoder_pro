import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { ChatMessage } from '../chat.js';
import type { Project, WorkOrder } from '../types.js';
import {
  backupDatabase,
  closeDatabase,
  ensureProjectThread,
  createAgentJob,
  getActiveAgentJob,
  getAgentJob,
  appendAgentJobEvent,
  listAgentJobEvents,
  updateAgentJob,
  interruptRunningAgentJobs,
  databaseCounts,
  getDatabaseStatus,
  getProjectBrain,
  initializeDatabase,
  listModelPresets,
  loadThreadConversation,
  replaceThreadConversation,
  saveProjectBrain,
  upsertProject,
  upsertWorkOrder,
  verifyDatabase
} from './database.js';
import { importLegacyData } from './importLegacy.js';
import { DATABASE_SCHEMA_VERSION, REQUIRED_TABLES } from './schema.js';

function project(): Project {
  return {
    id: 'proj-db-test',
    name: 'Database Test',
    path: 'C:\\db-test',
    createdAt: Date.now(),
    workflowStage: 'surface_review_ready',
    buildCondition: 'unknown',
    executionMode: 'checkpoint',
    permissions: {
      readFiles: true,
      writeFiles: false,
      installDeps: false,
      runApp: false,
      runTests: false,
      gitCommit: false,
      gitPush: false
    },
    latestSurveyId: 'EVC-1700000000000-aabbccdd'
  };
}

function workOrder(id: string, status: WorkOrder['status']): WorkOrder {
  const now = new Date().toISOString();
  return {
    id,
    planVersion: '20.0',
    status,
    intent: 'export',
    objective: 'Create a database test handoff',
    scope: {
      exactPaths: ['C:\\db-test'],
      operations: ['export_handoff'],
      network: ['loopback only'],
      providers: []
    },
    dependsOn: [],
    dependencyCompletionState: 'none_required',
    acceptance: [
      { id: `AC-${id}-01`, criterion: 'Database test evidence is verified', mandatory: true }
    ],
    budgets: {
      maxFiles: 10,
      maxDurationMs: 10_000,
      maxAttempts: 1,
      maxCloudCostUsd: 0
    },
    authorization: {
      required: true,
      granted: status !== 'draft',
      grantedAt: status !== 'draft' ? now : null,
      grantedBy: status !== 'draft' ? 'database-test' : null
    },
    evidenceIds: ['EVC-1700000000000-aabbccdd'],
    linkedSurveyId: 'EVC-1700000000000-aabbccdd',
    createdAt: now,
    updatedAt: now
  };
}

test('SQLite foundation migrates, constrains, imports, backs up, and reopens', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-sqlite-'));
  try {
    await fs.mkdir(path.join(root, 'evidence'));
    await fs.mkdir(path.join(root, 'conversations'));
    const p = project();
    const first = workOrder('JC20-M2-901', 'authorized');
    const projects = new Map([[p.id, p]]);
    const workOrders = new Map([[first.id, first]]);

    const evidenceId = p.latestSurveyId!;
    const evidence = {
      type: 'survey.result',
      projectId: p.id,
      generatedAt: new Date().toISOString(),
      requestedPath: p.path
    };
    await fs.writeFile(
      path.join(root, 'evidence', `${evidenceId}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`
    );
    await fs.writeFile(
      path.join(root, 'evidence', 'EVC-1700000000001-aabbccdd.json'),
      JSON.stringify({ type: 'legacy.without.timestamp', projectId: p.id })
    );
    const conversation: ChatMessage[] = [{
      id: 'msg-database-test',
      role: 'assistant',
      content: 'Database migration test',
      createdAt: new Date().toISOString()
    }];
    await fs.writeFile(
      path.join(root, 'conversations', `${p.id}.json`),
      JSON.stringify(conversation)
    );
    const legacyPayload = { projectId: p.id, what: 'legacy event' };
    const legacyHash = createHash('sha256')
      .update(`1:test.event:${JSON.stringify(legacyPayload)}`)
      .digest('hex');
    await fs.writeFile(
      path.join(root, 'events.jsonl'),
      `${JSON.stringify({ ts: 1, type: 'test.event', payload: legacyPayload, hash: legacyHash })}\n`
    );

    const initialized = await initializeDatabase(root);
    assert.equal(initialized.available, true);
    assert.equal(initialized.schemaVersion, DATABASE_SCHEMA_VERSION);
    assert.equal(initialized.tableCount, REQUIRED_TABLES.length);
    assert.equal(initialized.integrity, 'ok');

    const imported = await importLegacyData({ dataDirectory: root, projects, workOrders });
    assert.deepEqual(imported, {
      projects: 1,
      workOrders: 1,
      evidence: 2,
      events: 1,
      conversationMessages: 1
    });
    const counts = databaseCounts();
    assert.equal(counts.projects, 1);
    assert.equal(counts.work_orders, 1);
    assert.equal(counts.evidence_records, 2);
    assert.equal(counts.event_log, 1);
    assert.equal(counts.conversation_messages, 1);
    assert.equal(counts.authorization_grants, 1);

    const competing = workOrder('JC20-M2-902', 'authorized');
    assert.throws(
      () => upsertWorkOrder(competing, p.id),
      /UNIQUE constraint failed: work_orders\.project_id/
    );
    first.status = 'completed';
    first.updatedAt = new Date().toISOString();
    upsertWorkOrder(first, p.id);
    upsertWorkOrder(competing, p.id);
    assert.equal(databaseCounts().work_orders, 2);

    const invalid = { ...p, id: 'proj-invalid', workflowStage: 'invented' } as unknown as Project;
    assert.throws(() => upsertProject(invalid), /CHECK constraint failed/);
    assert.equal(databaseCounts().projects, 1);

    const thread = ensureProjectThread(p.id, p.name);
    assert.equal(thread.title, 'Database Test workspace');
    const agentJob = createAgentJob({ projectId: p.id, threadId: thread.id, objective: 'Fix the durable loop' });
    appendAgentJobEvent({
      jobId: agentJob.id, stage: 'understand', kind: 'progress', what: 'Started',
      meaning: 'Durable', next: 'Continue', payload: { test: true }
    });
    updateAgentJob(agentJob.id, { status: 'running', stage: 'inspect', startedAt: Date.now() });
    assert.equal(getActiveAgentJob(p.id)?.id, agentJob.id);
    assert.equal(listAgentJobEvents(agentJob.id).length, 1);
    assert.equal(interruptRunningAgentJobs(), 1);
    assert.equal(getAgentJob(agentJob.id)?.status, 'interrupted');
    assert.equal(loadThreadConversation(thread.id)[0]?.content, 'Database migration test');
    assert.ok(listModelPresets().some((preset) => preset.id === 'preset-auto'));
    const emptyBrain = getProjectBrain(p.id);
    assert.equal(emptyBrain.guidancePresetId, 'brain-preset-exceptional-builder');
    const savedBrain = saveProjectBrain(p.id, {
      ...emptyBrain,
      guidancePresetId: 'brain-preset-safe-refactor',
      purpose: 'Test durable project memory',
      evidenceIds: [evidenceId],
      freshnessAt: Date.now()
    });
    assert.equal(savedBrain.guidancePresetId, 'brain-preset-safe-refactor');
    assert.equal(savedBrain.purpose, 'Test durable project memory');
    assert.deepEqual(savedBrain.evidenceIds, [evidenceId]);
    const verification = verifyDatabase();
    assert.equal(verification.ok, true);
    assert.equal(verification.quickCheck, 'ok');
    assert.equal(verification.foreignKeyViolations, 0);

    const backupPath = path.join(root, 'backups', 'joecoder-test.sqlite3');
    const backup = await backupDatabase(backupPath);
    assert.ok(backup.sizeBytes > 0);
    assert.match(backup.sha256, /^[a-f0-9]{64}$/);
    const restored = new DatabaseSync(backupPath);
    try {
      const quick = restored.prepare('PRAGMA quick_check').get();
      assert.equal(quick?.quick_check, 'ok');
      assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM projects').get()?.count, 1);
    } finally {
      restored.close();
    }

    closeDatabase();
    const reopened = await initializeDatabase(root);
    assert.equal(reopened.available, true);
    assert.equal(verifyDatabase().ok, true);
    assert.equal(databaseCounts().schema_migrations, DATABASE_SCHEMA_VERSION);
    assert.equal(getDatabaseStatus().schemaVersion, DATABASE_SCHEMA_VERSION);
    assert.equal(getProjectBrain(p.id).guidancePresetId, 'brain-preset-safe-refactor');
  } finally {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  }
});

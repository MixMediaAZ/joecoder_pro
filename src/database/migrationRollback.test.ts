import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyDatabaseMigrations } from './database.js';
import { DATABASE_SCHEMA_VERSION } from './schema.js';

test('failed durable-runtime migration rolls back atomically, preserves evidence-chain data, and retries cleanly', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-migration-rollback-'));
  const location = path.join(root, 'joecoder.sqlite3');
  const db = new DatabaseSync(location);
  try {
    assert.throws(() => applyDatabaseMigrations(db, version => {
      if (version === 6) throw new Error('INJECTED_MIGRATION_FAILURE');
    }), /INJECTED_MIGRATION_FAILURE/);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 5);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM schema_migrations').get()?.count, 5);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type='table' AND name='agent_job_memory'").get()?.count, 0);

    const payload = JSON.stringify({ projectId: null, what: 'preserve migration evidence' });
    const eventHash = createHash('sha256').update(`1:test.migration:${payload}`).digest('hex');
    db.prepare(`INSERT INTO event_log(event_hash,previous_hash,project_id,work_order_id,event_type,occurred_at,payload_json,integrity_state)
      VALUES(?,NULL,NULL,NULL,'test.migration',1,?,'verified_chain')`).run(eventHash, payload);

    assert.throws(() => applyDatabaseMigrations(db, version => {
      if (version === 6) throw new Error('INJECTED_MIGRATION_FAILURE_AGAIN');
    }), /INJECTED_MIGRATION_FAILURE_AGAIN/);
    assert.equal(db.prepare('SELECT event_hash FROM event_log WHERE sequence=1').get()?.event_hash, eventHash);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 5);

    applyDatabaseMigrations(db);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, DATABASE_SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT event_hash FROM event_log WHERE sequence=1').get()?.event_hash, eventHash);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type='table' AND name='agent_job_memory'").get()?.count, 1);
    assert.equal(db.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

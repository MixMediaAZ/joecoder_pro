import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  closeDatabase,
  completeIdempotencyUse,
  getIdempotencyRecord,
  initializeDatabase,
  recordIdempotencyUse,
  recordSessionCreated
} from './database/database.js';

test('completed consequential response replays across a fresh browser session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-idempotency-replay-'));
  try {
    await initializeDatabase(root);
    const now = Date.now();
    for (const id of ['sess-original', 'sess-after-restart']) {
      recordSessionCreated({ id, createdAt: now, lastSeenAt: now, expiresAt: now + 60_000 });
    }
    const key = 'job-deadbeef-capture-objective-r0-a0-conversation';
    recordIdempotencyUse({
      sessionId: 'sess-original',
      key,
      method: 'POST',
      routePath: '/api/v1/test',
      requestHash: 'a'.repeat(64),
      createdAt: now,
      expiresAt: now + 60_000
    });
    completeIdempotencyUse({
      sessionId: 'sess-original',
      key,
      responseStatus: 200,
      response: { ok: true, durable: true }
    });

    const replay = getIdempotencyRecord('sess-after-restart', key)!;
    assert.equal(replay.sessionId, 'sess-original');
    assert.equal(replay.responseStatus, 200);
    assert.deepEqual(replay.response, { ok: true, durable: true });
    assert.ok(replay.completedAt);
    assert.throws(() => recordIdempotencyUse({
      sessionId: 'sess-after-restart',
      key,
      method: 'POST',
      routePath: '/api/v1/test',
      requestHash: 'a'.repeat(64),
      createdAt: now + 1,
      expiresAt: now + 60_000
    }), /UNIQUE constraint failed/);
  } finally {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  }
});


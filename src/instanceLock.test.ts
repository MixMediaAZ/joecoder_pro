import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireInstanceLock, releaseInstanceLock } from './instanceLock.js';

test('instance lock rejects a competing live process and recovers a stale lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-instance-lock-'));
  try {
    await acquireInstanceLock(root);
    await assert.rejects(acquireInstanceLock(root), /JOECODER_ALREADY_RUNNING/);
    await releaseInstanceLock();

    await fs.writeFile(path.join(root, 'server.lock'), JSON.stringify({
      pid: 2147483646,
      nonce: 'stale',
      startedAt: new Date(0).toISOString()
    }));
    await acquireInstanceLock(root);
    const current = JSON.parse(await fs.readFile(path.join(root, 'server.lock'), 'utf8'));
    assert.equal(current.pid, process.pid);
    await releaseInstanceLock();
    await assert.rejects(fs.access(path.join(root, 'server.lock')), /ENOENT/);
  } finally {
    await releaseInstanceLock().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});

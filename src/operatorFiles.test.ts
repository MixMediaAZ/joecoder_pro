import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readOperatorFile, saveOperatorFile, readOperatorRecovery } from './operatorFiles.js';

test('operator editor locks saves, detects stale versions, preserves bytes and guards recovery', { skip: process.platform !== 'win32' }, async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-operator-files-'));
  const root = path.join(sandbox, 'project-é');
  const storage = path.join(sandbox, 'receipts');
  await fs.mkdir(root);
  const file = path.join(root, 'source.txt');
  const original = '\ufefffirst line\r\nsecond line\r\n';
  await fs.writeFile(file, original);
  const base = { root, storage, projectId: 'proj-test', relative: 'source.txt', sessionId: 'test-session' };
  try {
    const opened = await readOperatorFile(root, 'source.txt');
    assert.equal(opened.lineEnding, 'crlf');
    assert.equal(opened.content, '\ufefffirst line\nsecond line\n');
    const saved = await saveOperatorFile({ ...base, expectedSha256: opened.sha256, lineEnding: opened.lineEnding, content: '\ufeffedited\n' });
    assert.ok(saved.recoveryId);
    assert.equal(await fs.readFile(file, 'utf8'), '\ufeffedited\r\n');
    await assert.rejects(saveOperatorFile({ ...base, expectedSha256: opened.sha256, lineEnding: 'lf', content: 'stale' }), /file changed/);
    const recovery = await readOperatorRecovery(storage, saved.recoveryId!, base.projectId, root, base.relative);
    await assert.rejects(readOperatorRecovery(storage, saved.recoveryId!, 'proj-other', root, base.relative), /does not belong/);
    await fs.writeFile(file, 'external change');
    await assert.rejects(saveOperatorFile({ ...base, ...recovery }), /file changed/);
    assert.equal(await fs.readFile(file, 'utf8'), 'external change');
    await fs.writeFile(file, '\ufeffedited\r\n');
    await saveOperatorFile({ ...base, ...recovery });
    assert.equal(await fs.readFile(file, 'utf8'), original);
    const writer = await fs.open(file, 'r+');
    try {
      await assert.rejects(saveOperatorFile({ ...base, expectedSha256: opened.sha256, lineEnding: 'crlf', content: 'must not replace' }), /Save did not complete/);
    } finally { await writer.close(); }
    assert.equal(await fs.readFile(file, 'utf8'), original);
    const racers = await Promise.allSettled(['writer one', 'writer two'].map(content => saveOperatorFile({ ...base, expectedSha256: opened.sha256, lineEnding: 'crlf', content })));
    assert.equal(racers.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(['writer one', 'writer two'].includes(await fs.readFile(file, 'utf8')));
    await fs.writeFile(path.join(storage, saved.recoveryId!, 'before.bin'), 'corrupted');
    await assert.rejects(readOperatorRecovery(storage, saved.recoveryId!, base.projectId, root, base.relative), /integrity/);
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('operator editor rejects unsafe paths, hardlinks, binary, encoding and oversized files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-editor-paths-'));
  try {
    await fs.writeFile(path.join(root, 'safe.txt'), 'safe');
    await fs.writeFile(path.join(root, '.env'), 'PRIVATE_VALUE');
    await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    await fs.writeFile(path.join(root, 'encoding.txt'), Buffer.from([255, 254, 32]));
    await fs.writeFile(path.join(root, 'large.txt'), Buffer.alloc(262145, 'x'));
    await fs.writeFile(path.join(root, 'mixed.txt'), 'a\r\nb\n');
    await fs.mkdir(path.join(root, 'real-folder'));
    await fs.writeFile(path.join(root, 'real-folder', 'source.txt'), 'linked source');
    await fs.symlink(path.join(root, 'real-folder'), path.join(root, 'linked-folder'), process.platform === 'win32' ? 'junction' : 'dir');
    await fs.link(path.join(root, 'safe.txt'), path.join(root, 'alias.txt'));
    for (const relative of ['.env', '../escape', 'safe.txt:stream', '.git/config', 'binary.bin', 'encoding.txt', 'large.txt', 'mixed.txt', 'alias.txt', 'safe.txt', 'linked-folder/source.txt']) {
      await assert.rejects(readOperatorFile(root, relative), Error, relative);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

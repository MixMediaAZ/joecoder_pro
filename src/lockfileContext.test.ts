import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { modelEditableScopedFiles, readScopedFiles } from './repair.js';

test('newly generated small lockfiles never enter correction model context', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-lock-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"example"}');
  const scope = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json'];
  assert.deepEqual(modelEditableScopedFiles(await readScopedFiles(root, scope)).map(f => f.relPath), ['package.json']);
  await fs.writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
  const afterInstall = await readScopedFiles(root, scope);
  assert.equal(afterInstall.find(f => f.relPath === 'package-lock.json')?.serverManaged, true);
  assert.deepEqual(modelEditableScopedFiles(afterInstall).map(f => f.relPath), ['package.json']);
  assert.deepEqual(modelEditableScopedFiles([{relPath: 'package-lock.json', exists: true, content: '{}', truncated: false}]), []);
});

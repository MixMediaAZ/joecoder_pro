import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { listProjectChanges, readProjectDiff, reviewablePath } from './projectChanges.js';

test('diff review rejects traversal, secrets and Git pathspecs', () => {
  for (const input of ['../outside', '/absolute', 'D:\\outside', '.env', 'keys/private.pem', '.git/config', 'node_modules/pkg/index.js', ':(glob)**', 'src/../secret']) {
    assert.equal(reviewablePath(input), false, input);
  }
  assert.equal(reviewablePath('src/components/Button.tsx'), true);
});

test('real Git review includes tracked and untracked text without modifying project bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-diff-review-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
  try {
    git('init');
    await fs.writeFile(path.join(root, 'code.txt'), 'before\n');
    git('add', 'code.txt');
    git('-c', 'user.name=Verification', '-c', 'user.email=verify@example.invalid', 'commit', '-m', 'Baseline');
    await fs.writeFile(path.join(root, 'code.txt'), 'after\n');
    await fs.writeFile(path.join(root, 'new.txt'), 'new content\n');
    await fs.writeFile(path.join(root, '.env'), 'DO_NOT_RETURN=secret\n');
    const before = git('status', '--porcelain').toString();
    const listing = await listProjectChanges(root);
    assert.deepEqual(listing.files.map(file => file.path).sort(), ['code.txt', 'new.txt']);
    const diff = await readProjectDiff(root, 'code.txt');
    assert.match(diff.diff, /-before/); assert.match(diff.diff, /\+after/);
    assert.match(diff.currentSha256, /^[a-f0-9]{64}$/);
    assert.equal(diff.readOnly, true);
    assert.match((await readProjectDiff(root, 'new.txt')).diff, /\+new content/);
    await assert.rejects(readProjectDiff(root, '.env'), /not available/);
    await assert.rejects(readProjectDiff(root, '../outside'), /not available/);
    assert.equal(await fs.readFile(path.join(root, 'code.txt'), 'utf8'), 'after\n');
    assert.equal(git('status', '--porcelain').toString(), before);
  } finally {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('jc-diff-review-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyEdits, rollbackToSnapshot, snapshotScopedFiles } from './mutation.js';
import { runVerification, verificationProofLevel } from './verification.js';

test('Stage 10 manifest permanently covers every required isolated fixture class', async () => {
  const manifest = JSON.parse(await fs.readFile('acceptance-fixtures/manifest.json', 'utf8')) as { fixtures: Array<{ id: string; proof: string }> };
  const expected = [
    'typescript-visual', 'node-api-database', 'python-unit-integration', 'static-responsive-accessible',
    'ambiguous-multifile', 'missing-dependencies-or-runner', 'windows-spaces-long-path',
    'interrupt-every-stage', 'prompt-injection-four-surfaces', 'scope-secret-budget-loop'
  ];
  assert.deepEqual(manifest.fixtures.map(item => item.id), expected);
  assert.ok(manifest.fixtures.every(item => item.proof.trim().length > 10));
});

test('Python fixture repairs and verifies across a long Windows path', async () => {
  const nested = 'a-very-long-nested-project-name-that-keeps-windows-path-handling-honest';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'JoeCoder acceptance with spaces-'));
  const project = path.join(root, nested, nested);
  const snapshots = path.join(root, 'snapshots');
  const broken = 'def add(a, b):\n    return a - b\n';
  const fixed = 'def add(a, b):\n    return a + b\n';
  try {
    await fs.mkdir(path.join(project, 'tests'), { recursive: true });
    await fs.writeFile(path.join(project, 'requirements.txt'), '# no external dependencies\n');
    await fs.writeFile(path.join(project, 'calc.py'), broken);
    await fs.writeFile(path.join(project, 'untouched.txt'), 'must remain byte-identical\n');
    await fs.writeFile(path.join(project, 'tests', 'test_unit.py'), 'from calc import add\n\ndef test_add(): assert add(2, 3) == 5\n');
    await fs.writeFile(path.join(project, 'tests', 'test_integration.py'), 'from calc import add\n\ndef test_composed(): assert add(add(1, 2), 3) == 6\n');
    const untouchedHash = createHash('sha256').update(await fs.readFile(path.join(project, 'untouched.txt'))).digest('hex');
    const before = await runVerification(project, { editedRelPaths: ['calc.py'], timeoutMs: 30_000 });
    assert.equal(before.status, 'failed');
    const snapshot = await snapshotScopedFiles(project, ['calc.py'], snapshots);
    const applied = await applyEdits(project, [{ relPath: 'calc.py', content: fixed }], {
      scopeRelPaths: ['calc.py'], maxFiles: 1, maxChangedLines: 4
    });
    assert.deepEqual(applied.applied.map(item => item.relPath), ['calc.py']);
    const after = await runVerification(project, { editedRelPaths: ['calc.py'], timeoutMs: 30_000 });
    assert.equal(after.status, 'passed', JSON.stringify(after, null, 2));
    assert.equal(verificationProofLevel(after), 'runtime');
    assert.ok(after.items.some(item => item.script === 'test' && item.passed));
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(project, 'untouched.txt'))).digest('hex'), untouchedHash);
    const restored = await rollbackToSnapshot(snapshots, snapshot);
    assert.deepEqual(restored.failures, []);
    assert.equal(await fs.readFile(path.join(project, 'calc.py'), 'utf8'), broken);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

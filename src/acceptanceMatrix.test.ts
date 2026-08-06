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

test('Node API and database fixture begins broken, repairs one bounded file, verifies, preserves collateral files, and rolls back', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-node-api-db-'));
  const project = path.join(root, 'project');
  const snapshots = path.join(root, 'snapshots');
  try {
    await fs.mkdir(path.join(project, 'src'), { recursive: true });
    await fs.mkdir(path.join(project, 'test'), { recursive: true });
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'api-db', type: 'module', scripts: { test: 'node --test' } }));
    await fs.writeFile(path.join(project, 'src', 'db.mjs'), "export function migrate(db){db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL)')}\n");
    const broken = "export function createUser(db,name){return db.prepare('INSERT INTO users(fullname) VALUES(?)').run(name)}\n";
    const fixed = "export function createUser(db,name){return db.prepare('INSERT INTO users(name) VALUES(?)').run(name)}\n";
    await fs.writeFile(path.join(project, 'src', 'api.mjs'), broken);
    await fs.writeFile(path.join(project, 'untouched.txt'), 'preserve me\n');
    await fs.writeFile(path.join(project, 'test', 'api.test.mjs'), [
      "import test from 'node:test'; import assert from 'node:assert/strict'; import { DatabaseSync } from 'node:sqlite';",
      "import { migrate } from '../src/db.mjs'; import { createUser } from '../src/api.mjs';",
      "test('migration and API',()=>{const db=new DatabaseSync(':memory:');migrate(db);createUser(db,'David');assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,1);db.close()})"
    ].join('\n'));
    const untouched = createHash('sha256').update(await fs.readFile(path.join(project, 'untouched.txt'))).digest('hex');
    assert.equal((await runVerification(project, { editedRelPaths: ['src/api.mjs'], timeoutMs: 30_000 })).status, 'failed');
    const snapshot = await snapshotScopedFiles(project, ['src/api.mjs'], snapshots);
    await applyEdits(project, [{ relPath: 'src/api.mjs', content: fixed }], { scopeRelPaths: ['src/api.mjs'], maxFiles: 1, maxChangedLines: 2 });
    const verified = await runVerification(project, { editedRelPaths: ['src/api.mjs'], timeoutMs: 30_000 });
    assert.equal(verified.status, 'passed', JSON.stringify(verified, null, 2));
    assert.equal(verificationProofLevel(verified), 'runtime');
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(project, 'untouched.txt'))).digest('hex'), untouched);
    assert.deepEqual((await rollbackToSnapshot(snapshots, snapshot)).failures, []);
    assert.equal(await fs.readFile(path.join(project, 'src', 'api.mjs'), 'utf8'), broken);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Ambiguous multi-file fixture requires two evidence-driven correction cycles before success', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-multifile-corrections-'));
  const snapshots = path.join(root, 'snapshots');
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.mkdir(path.join(root, 'test'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'multi', type: 'module', scripts: { test: 'node --test' } }));
    await fs.writeFile(path.join(root, 'src', 'math.mjs'), 'export const add=(a,b)=>a-b;\n');
    await fs.writeFile(path.join(root, 'src', 'label.mjs'), "export const label=n=>'Total: '+(n+1);\n");
    await fs.writeFile(path.join(root, 'test', 'app.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import{add}from'../src/math.mjs';import{label}from'../src/label.mjs';test('composed',()=>assert.equal(label(add(2,3)),'Total: 5'));\n");
    await fs.writeFile(path.join(root, 'untouched.txt'), 'never edit\n');
    const untouched = createHash('sha256').update(await fs.readFile(path.join(root, 'untouched.txt'))).digest('hex');
    const snapshot = await snapshotScopedFiles(root, ['src/math.mjs', 'src/label.mjs'], snapshots);
    assert.equal((await runVerification(root, { editedRelPaths: ['src/math.mjs', 'src/label.mjs'] })).status, 'failed');
    await applyEdits(root, [{ relPath: 'src/math.mjs', content: 'export const add=(a,b)=>a+b;\n' }], { scopeRelPaths: ['src/math.mjs', 'src/label.mjs'], maxFiles: 2 });
    const firstCorrection = await runVerification(root, { editedRelPaths: ['src/math.mjs', 'src/label.mjs'] });
    assert.equal(firstCorrection.status, 'failed');
    await applyEdits(root, [{ relPath: 'src/label.mjs', content: "export const label=n=>'Total: '+n;\n" }], { scopeRelPaths: ['src/math.mjs', 'src/label.mjs'], maxFiles: 2 });
    const secondCorrection = await runVerification(root, { editedRelPaths: ['src/math.mjs', 'src/label.mjs'] });
    assert.equal(secondCorrection.status, 'passed', JSON.stringify(secondCorrection, null, 2));
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(root, 'untouched.txt'))).digest('hex'), untouched);
    assert.deepEqual((await rollbackToSnapshot(snapshots, snapshot)).failures, []);
    assert.equal(await fs.readFile(path.join(root, 'src', 'math.mjs'), 'utf8'), 'export const add=(a,b)=>a-b;\n');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
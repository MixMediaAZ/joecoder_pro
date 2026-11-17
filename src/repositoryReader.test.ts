import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { listAgentFiles, readAgentFile, searchAgentFiles } from './repositoryReader.js';

async function fixture(t: import('node:test').TestContext) {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'jc-agent-reader-'));
  t.after(async () => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('jc-agent-reader-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test('reads and finds source beyond UI preview with a whole-file version', async t => {
  const root = await fixture(t);
  const content = 'ordinary source line\n'.repeat(18000) + 'export const hiddenBug = 42;\n';
  await fs.writeFile(path.join(root, 'large.ts'), content);
  const result = await readAgentFile(root, { path: 'large.ts', startLine: 18001 });
  assert.match(result.content, /hiddenBug/);
  assert.equal(result.sha256, createHash('sha256').update(content).digest('hex'));
  assert.equal(result.startLine, 18001);
  const search = await searchAgentFiles(root, { query: 'hiddenBug' });
  assert.equal(search.results[0]?.line, 18001);
  assert.equal(search.coverage, 'complete_for_searchable_files');
});

test('directory and search pagination reach nested files and reject changed cursors', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'nested'));
  for (let i = 0; i < 1010; i++) await fs.writeFile(path.join(root, 'nested', String(i).padStart(4, '0') + '.ts'), i === 1009 ? 'needle\nneedle\nneedle\n' : '');
  let cursor: string | undefined;
  let count = 0;
  do {
    const page = await listAgentFiles(root, { path: 'nested', cursor, limit: 200 });
    count += page.entries.length; cursor = page.nextCursor || undefined;
  } while (cursor);
  assert.equal(count, 1010);
  let next: string | undefined;
  const matches: number[] = [];
  let firstMatchCursor: string | undefined;
  do {
    const page = await searchAgentFiles(root, { query: 'needle', maxResults: 1, cursor: next });
    matches.push(...page.results.map(item => item.line));
    if (page.results.length && page.nextCursor) firstMatchCursor = page.nextCursor;
    next = page.nextCursor || undefined;
  } while (next);
  assert.deepEqual(matches, [1, 2, 3]);
  await fs.appendFile(path.join(root, 'nested', '1009.ts'), 'changed\n');
  await assert.rejects(searchAgentFiles(root, { query: 'needle', maxResults: 1, cursor: firstMatchCursor }), /changed/i);
});

test('sensitive and generated files stay excluded; binary failures report limited coverage', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, '.env'), 'secret needle');
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules', 'package.js'), 'needle');
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(root, 'source.ts'), 'needle');
  const result = await searchAgentFiles(root, { query: 'needle' });
  assert.deepEqual(result.results.map(item => item.path), ['source.ts']);
  assert.equal(result.coverage, 'limited');
  assert.ok(result.skipped.some(item => item.reason === 'BINARY_FILE_PREVIEW_BLOCKED'));
  await assert.rejects(readAgentFile(root, { path: '.env' }), /Sensitive/);
  await assert.rejects(readAgentFile(root, { path: '../outside' }), { code: 'INVALID_PROJECT_PATH' });
  await assert.rejects(readAgentFile(root, { path: 'source.ts:secret' }), /ordinary/);
});

test('range continuation detects changed files and supports Unicode paths', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'café.ts'), 'one\ntwo\nthree\n');
  const first = await readAgentFile(root, { path: 'café.ts', endLine: 1 });
  assert.equal(first.nextStartLine, 2);
  assert.equal((await readAgentFile(root, { path: 'café.ts', startLine: 2, expectedSha256: first.sha256 })).content, 'two\nthree');
  await fs.writeFile(path.join(root, 'café.ts'), 'changed\n');
  await assert.rejects(readAgentFile(root, { path: 'café.ts', startLine: 2, expectedSha256: first.sha256 }), /changed/);
});

test('oversized lines and files are explicit limits and cancellation is honored', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'long.ts'), 'a'.repeat(1024 * 1024 + 1));
  const search = await searchAgentFiles(root, { query: 'needle' });
  assert.equal(search.coverage, 'limited');
  assert.equal(search.skipped[0]?.reason, 'LINE_SCAN_LIMIT');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readAgentFile(root, { path: 'long.ts' }, controller.signal), /abort/i);
});

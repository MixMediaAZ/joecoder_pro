import assert from 'node:assert/strict';
import test from 'node:test';
import { manifestCompanionContext } from './correctionContext.js';

test('manifest correction sees actual scoped runtime and checks without inventing framework context', () => {
  const files = [
    { relPath: 'package.json', content: '{"main":"src/serve.js"}' },
    { relPath: 'src/serve.js', content: 'import http from "node:http";' },
    { relPath: 'test/storage.test.js', content: 'import test from "node:test";' },
    { relPath: 'unrelated.txt', content: 'not relevant' }
  ].map(file => ({ ...file, exists: true, truncated: false }));
  const context = manifestCompanionContext(files, ['package.json']);
  assert.match(context, /READ-ONLY CONTEXT: src\/serve.js/);
  assert.match(context, /node:test/);
  assert.doesNotMatch(context, /unrelated.txt/);
  assert.equal(manifestCompanionContext(files, ['src/serve.js']), '');
  assert.ok(manifestCompanionContext(files.map(file => ({ ...file, content: file.content.repeat(3000) })), ['package.json']).length < 26000);
});

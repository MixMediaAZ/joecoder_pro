import assert from 'node:assert/strict';
import test from 'node:test';
import { manifestCompanionContext, moduleResolutionContext, compactCorrectionPrompt } from './correctionContext.js';

test('missing relative module diagnosis identifies existing CJS and MJS extensions without inventing dependencies', () => {
  const files = [
    { relPath: 'src/one.cjs', content: 'require("./shared")' },
    { relPath: 'src/two.cjs', content: 'require("./shared")' },
    { relPath: 'src/shared.cjs', content: 'exports.value = 1;' }
  ].map(file => ({ ...file, exists: true, truncated: false }));
  const hints = moduleResolutionContext(files, "Error: Cannot find module './shared'");
  assert.match(hints, /src\/one.cjs/); assert.match(hints, /src\/two.cjs/);
  assert.match(hints, /existing module is src\/shared.cjs/);
  assert.equal(moduleResolutionContext(files, "Error: Cannot find module 'external-package'"), '');
  assert.equal(moduleResolutionContext(files.slice(0, 2), "Cannot find module './shared'"), '');
  assert.equal(moduleResolutionContext(files, 'TypeError: different problem'), '');
});

test('small correction prompt includes current bytes, objective and failure; large or partial source keeps the full path', () => {
  const files = [{ relPath: 'src/main.cjs', content: 'exports.result = 1;', exists: true, truncated: false }];
  const prompt = compactCorrectionPrompt('Return two.', files, 'AssertionError: 1 !== 2');
  assert.match(prompt!, /Return two/); assert.match(prompt!, /AssertionError: 1 !== 2/);
  assert.match(prompt!, /exports.result = 1/); assert.match(prompt!, /only these paths/);
  assert.equal(compactCorrectionPrompt('Return two.', [{ ...files[0]!, truncated: true }], 'failure'), null);
  assert.equal(compactCorrectionPrompt('Return two.', [{ ...files[0]!, content: 'x'.repeat(20000) }], 'failure'), null);
});

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
  const compact = compactCorrectionPrompt('Fix the missing test command.', [files[0]!], 'Cannot find module test/index.js', context)!;
  assert.match(compact, /READ-ONLY CONTEXT: test\/storage.test.js/);
  assert.match(compact, /not permission to edit these paths/);
  assert.doesNotMatch(compact, /===FILE: test\/storage.test.js===/);
  assert.ok(manifestCompanionContext(files.map(file => ({ ...file, content: file.content.repeat(3000) })), ['package.json']).length < 26000);
});

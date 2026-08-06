import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { interactiveVisualCheck } from '../../../lib/browser-fixture.mjs';

test('one click and visual reference', async () => {
  const [page, style, app, reference] = await Promise.all([
    fs.readFile(new URL('../src/index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/style.css', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('./reference.html', import.meta.url), 'utf8')
  ]);
  const actual = page.replace('<link rel="stylesheet" href="/style.css">', `<style>${style}</style>`)
    .replace('<script type="module" src="/app.js"></script>', `<script>${app}</script>`);
  const result = await interactiveVisualCheck(actual, reference);
  assert.equal(result.interaction?.after?.text, 'Add one');
  assert.equal(result.bodyHasExpectedCount, true, 'one click must produce Count: 1 in the real browser');
  assert.ok(result.mismatchRatio <= 0.0001, 'visual mismatch ratio ' + result.mismatchRatio + ' exceeds 0.0001');
  assert.deepEqual(result.networkFailures, []);
});

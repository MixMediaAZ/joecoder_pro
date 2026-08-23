import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifestTool = fs.readFileSync('tools/receipts-manifest.mjs', 'utf8');

test('receipt custody includes pre-sealed real-project criteria and excludes drafts', () => {
  assert.match(manifestTool, /SEALED-CRITERIA-/);
  assert.match(manifestTool, /\^\(\?:CERT-\|SEALED-CRITERIA-/);
  assert.equal(manifestTool.includes('DRAFT-CRITERIA-'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { correctionFormat } from './correctionFormat.js';

test('a rejected exact patch changes subsequent correction format without supplying an answer', () => {
  const parser = correctionFormat((text: string) => {
    if (text.includes('===PATCH:')) throw new Error('EDIT_PATCH_REJECTED: SEARCH text was not found');
    return text;
  });
  assert.equal(parser.hint(), '');
  assert.throws(() => parser.parse('===PATCH: package.json==='), /EDIT_PATCH_REJECTED/);
  assert.match(parser.hint(), /complete/);
  assert.throws(() => parser.parse('===PATCH: package.json==='), /EDIT_COMPLETE_FILE_REQUIRED/);
  const authored = '===FILE: package.json===\n{"name":"fixed"}\n===END FILE===';
  assert.equal(parser.parse(authored), authored);
});

test('unrelated validation failures preserve patch capability', () => {
  const parser = correctionFormat(() => { throw new Error('EDIT_SCOPE_VIOLATION'); });
  assert.throws(() => parser.parse('content'), /EDIT_SCOPE_VIOLATION/);
  assert.equal(parser.hint(), '');
});

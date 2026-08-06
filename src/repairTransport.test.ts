import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEditBlocks, parsePlanResponse, requireEffectiveEdits } from './repair.js';

const fence = String.fromCharCode(96).repeat(3);
const planJson = '{"schemaVersion":1,"files":["src/x.js"],"approach":"fix","risks":[]}';

test('strict plan parser accepts only a whole JSON transport fence', () => {
  assert.deepEqual(parsePlanResponse(`${fence}json\n${planJson}\n${fence}`).files, ['src/x.js']);
  assert.deepEqual(parsePlanResponse(`~~~json\n${planJson}\n~~~`).files, ['src/x.js']);
  assert.throws(() => parsePlanResponse(`preamble\n${fence}json\n${planJson}\n${fence}`), /PLAN_PARSE_FAILED/);
  assert.throws(() => parsePlanResponse(`${fence}javascript\n${planJson}\n${fence}`), /PLAN_PARSE_FAILED/);
  assert.throws(() => parsePlanResponse(`${fence}json\n${planJson}\n${fence}\nclaim passed`), /PLAN_PARSE_FAILED/);
});

test('strict edit parser accepts a whole text fence and rejects any outside claim', () => {
  const blocks = '===FILE: src/app.js===\nconst x = 2;\n===END FILE===';
  assert.equal(parseEditBlocks(`${fence}text\n${blocks}\n${fence}`)[0]?.content, 'const x = 2;\n');
  assert.equal(parseEditBlocks(`~~~plaintext\n${blocks}\n~~~`)[0]?.relPath, 'src/app.js');
  assert.throws(() => parseEditBlocks(`prose\n${blocks}`), /content outside/);
  assert.throws(() => parseEditBlocks(`${blocks}\nclaim: tests passed`), /content outside/);
  assert.throws(() => parseEditBlocks(`${fence}javascript\n${blocks}\n${fence}`), /STRUCTURED_TRANSPORT_REJECTED/);
});
test('effective edit guard rejects byte-identical corrections and keeps only real changes', () => {
  const files = [
    { relPath: 'src/a.js', exists: true, content: 'const a = 1;\n', truncated: false },
    { relPath: 'src/b.js', exists: true, content: 'const b = 1;\n', truncated: false }
  ];
  assert.throws(
    () => requireEffectiveEdits([{ relPath: 'src/a.js', content: 'const a = 1;\n' }], files),
    /EDIT_NO_PROGRESS/
  );
  assert.deepEqual(requireEffectiveEdits([
    { relPath: 'src/a.js', content: 'const a = 1;\n' },
    { relPath: 'src/b.js', content: 'const b = 2;\n' }
  ], files), [{ relPath: 'src/b.js', content: 'const b = 2;\n' }]);
});
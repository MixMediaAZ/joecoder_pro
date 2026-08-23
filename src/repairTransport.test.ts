import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEditsPrompt, parseEditBlocks, parsePlanResponse, requireEffectiveEdits, requireEvidenceTargetEdits } from './repair.js';

const fence = String.fromCharCode(96).repeat(3);
const planJson = '{"schemaVersion":1,"files":["src/x.js"],"approach":"fix","risks":[]}';

test('strict plan parser accepts only a whole JSON transport fence', () => {
  assert.deepEqual(parsePlanResponse(`${fence}json\n${planJson}\n${fence}`).files, ['src/x.js']);
  assert.deepEqual(parsePlanResponse(`~~~json\n${planJson}\n~~~`).files, ['src/x.js']);
  assert.throws(() => parsePlanResponse(`preamble\n${fence}json\n${planJson}\n${fence}`), /PLAN_PARSE_FAILED/);
  assert.throws(() => parsePlanResponse(`${fence}javascript\n${planJson}\n${fence}`), /PLAN_PARSE_FAILED/);
  assert.throws(() => parsePlanResponse(`${fence}json\n${planJson}\n${fence}\nclaim passed`), /PLAN_PARSE_FAILED/);
});

test('strict edit parser accepts a whole text fence and ignores pure narration outside blocks', () => {
  const blocks = '===FILE: src/app.js===\nconst x = 2;\n===END FILE===';
  assert.equal(parseEditBlocks(`${fence}text\n${blocks}\n${fence}`)[0]?.content, 'const x = 2;\n');
  assert.equal(parseEditBlocks(`~~~plaintext\n${blocks}\n~~~`)[0]?.relPath, 'src/app.js');
  // G2u: local models wrap valid blocks with thinking/narration — ignore marker-free residue.
  assert.equal(parseEditBlocks(`prose\n${blocks}`)[0]?.content, 'const x = 2;\n');
  assert.equal(parseEditBlocks(`${blocks}\nclaim: tests passed`)[0]?.relPath, 'src/app.js');
  // Incomplete markers in residue still fail closed.
  assert.throws(
    () => parseEditBlocks(`${blocks}\n===FILE: src/extra.js===\nconst y = 1;`),
    /incomplete or malformed file blocks/
  );
});

test('a language-labelled transport fence is unwrapped, and its payload is still validated', () => {
  // Regression: the edit transport accepted only text/plaintext, so a model editing Dart files
  // wrapped its block list in ```dart and the job died with STRUCTURED_TRANSPORT_REJECTED after
  // both attempts. The label describes the envelope; it never validated anything.
  const dartBlocks = '===FILE: lib/main.dart===\nvoid main() {}\n===END FILE===';
  assert.equal(parseEditBlocks(`${fence}dart\n${dartBlocks}\n${fence}`)[0]?.relPath, 'lib/main.dart');
  assert.equal(parseEditBlocks(`${fence}typescript\n${blocksFor('src/a.ts')}\n${fence}`)[0]?.relPath, 'src/a.ts');
  assert.equal(parseEditBlocks(`~~~python\n${blocksFor('app/main.py')}\n~~~`)[0]?.relPath, 'app/main.py');

  // The protections that actually matter are unchanged. A fence carrying real source instead of
  // file blocks still fails, and now fails with the accurate reason.
  assert.throws(() => parseEditBlocks(`${fence}dart\nvoid main() { print('hi'); }\n${fence}`), /EDIT_PARSE_FAILED/);
  // G2u: marker-free narration beside well-formed blocks is ignored; incomplete markers are not.
  assert.equal(
    parseEditBlocks(`${fence}dart\n${dartBlocks}\nclaim: all tests passed\n${fence}`)[0]?.relPath,
    'lib/main.dart'
  );
  assert.throws(
    () => parseEditBlocks(`${fence}dart\n${dartBlocks}\n===FILE: lib/extra.dart===\nvoid x() {}\n${fence}`),
    /incomplete or malformed file blocks/
  );
});

function blocksFor(relPath: string): string {
  return `===FILE: ${relPath}===\nconst value = 1;\n===END FILE===`;
}
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
test('an edit response that misses any sealed evidence target is rejected before any write', () => {
  // Observed in replay against the live model: with the root manifest and a stale nested one both
  // in scope, the model "fixed" the nested bystander and left the recorded cause untouched. Had
  // that parsed live, the job would have written a useless change and claimed limited success.
  const edits = [{ relPath: 'baby_daw_pro/pubspec.yaml', content: 'name: inner\n' }];
  assert.throws(
    () => requireEvidenceTargetEdits(edits, ['pubspec.yaml']),
    /EDIT_MISSES_EVIDENCE_TARGET.*missing: pubspec\.yaml/
  );

  // Touching the sole evidence target passes; extra files alongside are fine.
  const good = [
    { relPath: 'pubspec.yaml', content: 'file_selector: ^1.1.0\n' },
    { relPath: 'baby_daw_pro/pubspec.yaml', content: 'name: inner\n' }
  ];
  assert.equal(requireEvidenceTargetEdits(good, ['pubspec.yaml']), good);

  // v3 J1: every sealed evidence target must be touched — one of two is not enough.
  assert.throws(
    () => requireEvidenceTargetEdits(
      [{ relPath: 'package.json', content: '{"name":"app"}\n' }],
      ['package.json', 'postcss.config.js']
    ),
    /missing: postcss\.config\.js/
  );
  assert.equal(
    requireEvidenceTargetEdits([
      { relPath: 'package.json', content: '{"name":"app"}\n' },
      { relPath: 'postcss.config.js', content: 'export default {};\n' }
    ], ['package.json', 'postcss.config.js']).length,
    2
  );

  // Path normalisation: backslashes and leading ./ do not defeat the check.
  assert.equal(
    requireEvidenceTargetEdits([{ relPath: String.raw`.\pubspec.yaml`, content: 'x\n' }], ['pubspec.yaml']).length,
    1
  );

  // No targets recorded -> no constraint imposed.
  assert.equal(requireEvidenceTargetEdits(edits, []), edits);
});

test('the edits prompt carries a mandate line for evidence targets', () => {
  const files = [
    { relPath: 'pubspec.yaml', exists: true, content: 'file_selector: ^3.0.0\n', truncated: false },
    { relPath: 'baby_daw_pro/pubspec.yaml', exists: true, content: 'name: inner\n', truncated: false }
  ];
  const withTargets = buildEditsPrompt('fix installs', 'approach', files, ['pubspec.yaml']);
  assert.match(withTargets, /RECORDED EVIDENCE identifies the file\(s\) that must be corrected: pubspec\.yaml\./);
  assert.match(withTargets, /MUST include a corrected block for each/);

  const without = buildEditsPrompt('fix installs', 'approach', files);
  assert.equal(without.includes('RECORDED EVIDENCE'), false);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadCanonicalLaws } from './laws.js';

test('runtime loads the intact ratified registry through amendment 1.3.3', async () => {
  const bundle = await loadCanonicalLaws(path.resolve('.'));
  assert.equal(bundle.version, '1.3.3');
  assert.equal(bundle.canonicalVersion, '1.3.1');
  assert.equal(bundle.amendmentVersion, '1.3.3');
  assert.equal(bundle.laws.length, 48);
  assert.equal(new Set(bundle.laws.map((law) => law.id)).size, 48);
  assert.equal(bundle.sourceHash, 'a6281838e3503b8b4bb6362c0f80dddd656499ff10428adc28705b01cda12242');
  assert.deepEqual(bundle.statusSummary, { enforced: 27, partial: 21, missing: 0 });
  assert.ok(bundle.laws.some((law) => law.id === 'JC-TRUTH-001'));
  assert.ok(bundle.laws.some((law) => law.id === 'JC-DELIV-004'));
  assert.ok(bundle.laws.every((law) => !law.id.startsWith('JC-KER-')));
});

test('every canonical law has one honest and structurally backed implementation verdict', async () => {
  const root = path.resolve('.');
  const bundle = await loadCanonicalLaws(root);
  for (const law of bundle.laws) {
    assert.ok(law.requirement.length > 0, `${law.id} has a requirement`);
    assert.ok(law.failureBehavior.length > 0, `${law.id} has fail-closed behavior`);
    assert.ok(law.sources.length > 0, `${law.id} retains source provenance`);
    const mapping = law.implementation;
    assert.equal(mapping.id, law.id);
    if (mapping.status === 'enforced') assert.equal(mapping.gap, null, `${law.id} enforced has no declared gap`);
    else { assert.ok((mapping.gap ?? '').length > 12, `${law.id} exposes its ratified boundary`); assert.match(mapping.limitationId || '', /^LIM-/); }
    for (const relative of [...mapping.modules, ...mapping.tests]) {
      assert.ok(fs.existsSync(path.join(root, relative)), `${law.id} mapped path exists: ${relative}`);
    }
  }
});

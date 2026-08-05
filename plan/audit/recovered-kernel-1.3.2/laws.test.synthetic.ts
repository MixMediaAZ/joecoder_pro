import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadCanonicalLaws } from './laws.js';

test('runtime loads the complete recovered canonical law registry', async () => {
  const bundle = await loadCanonicalLaws(path.resolve('.'));
  assert.equal(bundle.version, '1.3.2');
  assert.equal(bundle.laws.length, 51);
  assert.equal(new Set(bundle.laws.map((law) => law.id)).size, 51);
  assert.match(bundle.sourceHash, /^[a-f0-9]{64}$/);
  assert.ok(bundle.laws.some((law) => law.id === 'JC-COMMS-003'));
});

test('every runtime law has executable enforcement and verification surfaces', async () => {
  const bundle = await loadCanonicalLaws(path.resolve('.'));
  for (const law of bundle.laws) {
    assert.ok(law.requirement.length > 0, `${law.id} has a requirement`);
    assert.ok(law.enforcement.length > 0, `${law.id} has enforcement`);
    assert.ok(law.verification.length > 0, `${law.id} has verification`);
  }
});

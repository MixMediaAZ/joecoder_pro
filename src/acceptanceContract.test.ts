import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { AcceptanceManifestSchema } from './acceptanceContract.js';

const requiredIds = [
  'typescript-visual', 'node-api-database', 'python-unit-integration', 'static-responsive-accessible',
  'ambiguous-multifile', 'missing-dependencies-or-runner', 'windows-spaces-long-path',
  'interrupt-every-stage', 'prompt-injection-four-surfaces', 'scope-secret-budget-loop'
];

test('Stage 10 manifest is an executable assertion contract rather than prose coverage', async () => {
  const raw = JSON.parse(await fs.readFile('acceptance-fixtures/manifest.json', 'utf8'));
  const manifest = AcceptanceManifestSchema.parse(raw);
  assert.deepEqual(manifest.fixtures.map((fixture) => fixture.id), requiredIds);
  for (const fixture of manifest.fixtures) {
    assert.equal(fixture.startsBroken, true);
    assert.equal(fixture.oneUserRequest, true);
    assert.equal(fixture.evidenceInvestigation, true);
    assert.equal(fixture.assertions.evidenceIntegrity, true);
    assert.equal(fixture.assertions.restartRecovery, true);
    assert.ok(fixture.assertions.untouchedPaths.length > 0);
    assert.ok(fixture.assertions.checks.length > 0);
  }
});

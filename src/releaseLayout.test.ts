import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const builder = fs.readFileSync('tools/build-release.mjs', 'utf8');
const liveGate = fs.readFileSync('tools/e2e-live.mjs', 'utf8');
const gateRunner = fs.readFileSync('tools/run-release-gates.mjs', 'utf8');

test('signed release contains everything required by its launcher and self-verification', () => {
  for (const required of [
    "'src'", "'dist'", "'public'", "'schemas'", "'tools'", "'acceptance-fixtures'",
    "'tsconfig.json'", "'package.json'", "'package-lock.json'", "'start.bat'",
    "'SUPPORTED_CAPABILITIES.md'", "'plan'"
  ]) assert.ok(builder.includes(required), `release includes ${required}`);
  assert.equal(builder.includes("'archive'"), false, 'superseded architecture is not shipped');
});

test('release is verified before metadata receipt is written', () => {
  const verification = builder.indexOf('await verifyReleaseBundle(payloadRoot, envelope');
  const receiptWrite = builder.indexOf("fs.writeFile(path.join(releaseRoot, 'RELEASE-RECEIPT.md')");
  assert.ok(verification > 0 && receiptWrite > verification);
});

test('release signing is preceded by a current manifested gate receipt', () => {
  const gateValidation = builder.indexOf('validateReleaseGateReceipt');
  const payloadCreation = builder.indexOf('await fs.mkdir(payloadRoot');
  assert.ok(gateValidation > 0 && payloadCreation > gateValidation);
  assert.match(builder, /RELEASE_GATE_RECEIPT_REQUIRED/);
  assert.match(builder, /RELEASE_GATE_RECEIPT_NOT_MANIFESTED/);
});

test('release E2E is real-model by default and fails closed before project mutation', () => {
  assert.match(liveGate, /process\.env\.JC_MOCK_MODEL === '1' \? 'mock' : 'real'/);
  const missingModel = liveGate.indexOf("throw new Error('REAL_MODEL_REQUIRED')");
  const fixtureCreation = liveGate.indexOf("const fixture = path.join(tmpdir()");
  assert.ok(missingModel > 0 && fixtureCreation > missingModel);
  assert.match(gateRunner, /JC_MOCK_MODEL: '0'/);
});

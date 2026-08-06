import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const builder = fs.readFileSync('tools/build-release.mjs', 'utf8');

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

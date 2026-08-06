import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createReleaseBundle,
  createSigningIdentity,
  inventoryNpmDependencies,
  signEnvelope,
  SupplyChainError,
  verifyDependencyAdmission,
  verifyEnvelope,
  verifyReleaseBundle
} from './supplyChain.js';

async function dependencyFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-supply-chain-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.3', dependencies: { safe: '1.0.0' } }));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({
    name: 'fixture', version: '1.2.3', lockfileVersion: 3, packages: {
      '': { name: 'fixture', version: '1.2.3', dependencies: { safe: '1.0.0' } },
      'node_modules/safe': {
        version: '1.0.0', resolved: 'https://registry.npmjs.org/safe/-/safe-1.0.0.tgz',
        integrity: 'sha512-YWJjZA==', license: 'MIT'
      }
    }
  }));
  return root;
}

test('dependency admission pins inventory, registry provenance, integrity, and trusted signature', async () => {
  const root = await dependencyFixture();
  try {
    const identity = createSigningIdentity();
    const inventory = await inventoryNpmDependencies(root);
    const admission = signEnvelope(inventory, identity.privateKeyPem);
    assert.equal((await verifyDependencyAdmission(root, admission, { trustedKeyId: identity.keyId })).components.length, 1);
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.4', dependencies: { safe: '1.0.0' } }));
    await assert.rejects(verifyDependencyAdmission(root, admission, { trustedKeyId: identity.keyId }), /DEPENDENCY_ADMISSION_MISMATCH/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('dependency policy fails closed for missing, malformed, unpinned, unavailable, and timed-out metadata', async () => {
  const root = await dependencyFixture();
  try {
    const inventory = await inventoryNpmDependencies(root);
    assert.throws(() => verifyEnvelope(signEnvelope(inventory), 'a'.repeat(64)), /SIGNATURE_REQUIRED/);
    await fs.writeFile(path.join(root, 'package-lock.json'), '{');
    await assert.rejects(inventoryNpmDependencies(root), /SUPPLY_CHAIN_DATA_MALFORMED/);
    await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
      'node_modules/bad': { version: '1.0.0', resolved: 'http://untrusted.invalid/bad.tgz', integrity: 'none' }
    } }));
    await assert.rejects(inventoryNpmDependencies(root), /DEPENDENCY_PROVENANCE_REJECTED/);
    await assert.rejects(inventoryNpmDependencies(path.join(root, 'missing')), /DEPENDENCY_METADATA_REQUIRED/);
    await assert.rejects(inventoryNpmDependencies(root, 0), /SUPPLY_CHAIN_TIMEOUT_INVALID/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('release bundle includes SBOM, licenses, provenance and checksums; tampering or wrong identity is rejected', async () => {
  const root = await dependencyFixture();
  const release = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-release-'));
  try {
    await fs.mkdir(path.join(release, 'dist'));
    await fs.writeFile(path.join(release, 'dist', 'index.js'), 'export const release = true;\n');
    await fs.writeFile(path.join(release, 'README.md'), '# Release\n');
    const identity = createSigningIdentity();
    const other = createSigningIdentity();
    const bundle = await createReleaseBundle(release, await inventoryNpmDependencies(root), {
      sourceCommit: '0123456789abcdef', builder: 'joecoder-release/1', tests: ['unit:passed', 'e2e:passed'], limitations: []
    });
    const signed = signEnvelope(bundle, identity.privateKeyPem);
    const verified = await verifyReleaseBundle(release, signed, { trustedKeyId: identity.keyId });
    assert.equal((verified.sbom as { bomFormat?: string }).bomFormat, 'CycloneDX');
    assert.equal(verified.files.length, 2);
    await assert.rejects(verifyReleaseBundle(release, signed, { trustedKeyId: other.keyId }), /SIGNATURE_IDENTITY_REJECTED/);
    const tamperedEnvelope = structuredClone(signed);
    tamperedEnvelope.payload.subject.version = '9.9.9';
    await assert.rejects(verifyReleaseBundle(release, tamperedEnvelope, { trustedKeyId: identity.keyId }), /SIGNATURE_VERIFICATION_FAILED/);
    await fs.writeFile(path.join(release, 'dist', 'index.js'), 'tampered\n');
    await assert.rejects(verifyReleaseBundle(release, signed, { trustedKeyId: identity.keyId }), /RELEASE_CHECKSUM_MISMATCH/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(release, { recursive: true, force: true });
  }
});

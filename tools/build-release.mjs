import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createReleaseBundle,
  inventoryNpmDependencies,
  loadOrCreateSigningIdentity,
  signEnvelope,
  verifyEnvelope,
  verifyReleaseBundle
} from '../dist/supplyChain.js';
import { REQUIRED_RELEASE_GATE_COMMANDS, validateReleaseGateReceipt } from '../dist/releaseGate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
if (dirty) throw new Error('RELEASE_TRACKED_WORKTREE_NOT_CLEAN');
const gateReceiptPath = path.resolve(process.env.JC_RELEASE_GATE_RECEIPT || '');
const certificationRoot = path.join(root, '.jc', 'certification');
if (!process.env.JC_RELEASE_GATE_RECEIPT || path.dirname(gateReceiptPath) !== certificationRoot || !path.basename(gateReceiptPath).startsWith('CERT-STEP2-RELEASE-GATES-')) {
  throw new Error('RELEASE_GATE_RECEIPT_REQUIRED');
}
const baseline = JSON.parse(await fs.readFile(path.join(root, 'plan', 'current-baseline.json'), 'utf8'));
const manifestEnvelope = JSON.parse(await fs.readFile(path.join(certificationRoot, 'RECEIPTS-MANIFEST.json'), 'utf8'));
const manifest = verifyEnvelope(manifestEnvelope, baseline.receiptManifest.keyId);
const gateBytes = await fs.readFile(gateReceiptPath);
const gateEntry = manifest.entries?.find(entry => entry.name === path.basename(gateReceiptPath));
const gateHash = createHash('sha256').update(gateBytes).digest('hex');
if (!gateEntry || gateEntry.sha256 !== gateHash) throw new Error('RELEASE_GATE_RECEIPT_NOT_MANIFESTED');
const gateFailures = validateReleaseGateReceipt(JSON.parse(gateBytes.toString('utf8')), sourceCommit);
if (gateFailures.length) throw new Error(`RELEASE_GATE_RECEIPT_INVALID: ${gateFailures.join(',')}`);
const releaseId = `joecoder-${JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version}-${Date.now()}`;
const releaseRoot = path.join(root, '.jc', 'releases', releaseId);
const payloadRoot = path.join(releaseRoot, 'payload');
const signingRoot = path.join(root, '.jc', 'signing');
const include = [
  'src', 'dist', 'public', 'frontend/out', 'schemas', 'tools', 'acceptance-fixtures', 'tsconfig.json', 'package.json', 'package-lock.json', 'start.bat',
  'README.md', 'README_RUN.md', 'WORKFLOW_GUIDE.md', 'CAPABILITY_CERTIFICATION.md', 'SUPPORTED_CAPABILITIES.md',
  'plan'
];

await fs.mkdir(payloadRoot, { recursive: true });
for (const relative of include) {
  const source = path.join(root, relative);
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) throw new Error(`RELEASE_REQUIRED_FILE_MISSING: ${relative}`);
  await fs.cp(source, path.join(payloadRoot, relative), { recursive: stat.isDirectory(), errorOnExist: true, force: false });
}

const inventory = await inventoryNpmDependencies(root);
const frontendInventory = await inventoryNpmDependencies(path.join(root, 'frontend'));
const metadataRoot = path.join(payloadRoot, 'frontend', 'build-metadata');
await fs.mkdir(metadataRoot, { recursive: true });
for (const name of ['package.json', 'package-lock.json']) {
  await fs.copyFile(path.join(root, 'frontend', name), path.join(metadataRoot, name));
}
await fs.writeFile(path.join(metadataRoot, 'dependency-inventory.json'), JSON.stringify(frontendInventory, null, 2) + '\n');
const combinedInventory = {
  ...inventory,
  components: [...new Map([...inventory.components, ...frontendInventory.components]
    .map(component => [`${component.name}@${component.version}:${component.integrity}`, component])).values()]
};
const governance = JSON.parse(await fs.readFile(path.join(root, 'plan', 'amendment-1.3.3', 'RATIFIED_LIMITATIONS.json'), 'utf8'));
if (!Array.isArray(governance.limitations) || governance.limitations.length === 0) {
  throw new Error('RELEASE_RATIFIED_LIMITATIONS_MISSING');
}
const verifiedLimitations = governance.limitations.map(item => {
  if (typeof item.id !== 'string' || typeof item.lawId !== 'string' || typeof item.boundary !== 'string' ||
      !item.id || !item.lawId || !item.boundary) {
    throw new Error('RELEASE_RATIFIED_LIMITATION_MALFORMED');
  }
  return [item.id, '/', item.lawId + ':', item.boundary].join(' ');
});
const identity = await loadOrCreateSigningIdentity(signingRoot);
const bundle = await createReleaseBundle(payloadRoot, combinedInventory, {
  sourceCommit,
  builder: `joecoder-release/1 node/${process.version} ${process.platform}/${process.arch}`,
  tests: [...REQUIRED_RELEASE_GATE_COMMANDS],
  limitations: verifiedLimitations
});
const envelope = signEnvelope(bundle, identity.privateKeyPem);
await verifyReleaseBundle(payloadRoot, envelope, { trustedKeyId: identity.keyId });

const lines = bundle.files.map(file => `${file.sha256}  payload/${file.path}`).join('\n') + '\n';
await Promise.all([
  fs.writeFile(path.join(releaseRoot, 'SBOM.cdx.json'), JSON.stringify(bundle.sbom, null, 2) + '\n'),
  fs.writeFile(path.join(releaseRoot, 'LICENSES.json'), JSON.stringify(bundle.licenses, null, 2) + '\n'),
  fs.writeFile(path.join(releaseRoot, 'PROVENANCE.json'), JSON.stringify(bundle.provenance, null, 2) + '\n'),
  fs.writeFile(path.join(releaseRoot, 'SHA256SUMS'), lines),
  fs.writeFile(path.join(releaseRoot, 'RELEASE-ATTESTATION.json'), JSON.stringify(envelope, null, 2) + '\n'),
  fs.writeFile(path.join(releaseRoot, 'TRUSTED-KEY-ID'), identity.keyId + '\n'),
  fs.writeFile(path.join(releaseRoot, 'RELEASE-RECEIPT.md'), [
    `# JoeCoder ${bundle.subject.version} release receipt`, '',
    `- Source commit: \`${sourceCommit}\``,
    `- Payload files: ${bundle.files.length}`,
    `- Dependencies (backend and frontend): ${combinedInventory.components.length}`,
    `- Signing identity: \`${identity.keyId}\` (machine-local Ed25519)`,
    '- Verification: signed metadata and every payload checksum passed.', '',
    '## Verified limitations', '', ...bundle.provenance.limitations.map(item => `- ${item}`), ''
  ].join('\n'))
]);

console.log(JSON.stringify({ ok: true, releaseRoot, sourceCommit, files: bundle.files.length, dependencies: inventory.components.length, keyId: identity.keyId }, null, 2));

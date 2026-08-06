import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createReleaseBundle,
  inventoryNpmDependencies,
  loadOrCreateSigningIdentity,
  signEnvelope,
  verifyReleaseBundle
} from '../dist/supplyChain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseId = `joecoder-${JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version}-${Date.now()}`;
const releaseRoot = path.join(root, '.jc', 'releases', releaseId);
const payloadRoot = path.join(releaseRoot, 'payload');
const signingRoot = path.join(root, '.jc', 'signing');
const include = [
  'dist', 'public', 'schemas', 'package.json', 'package-lock.json', 'start.bat',
  'README.md', 'README_RUN.md', 'WORKFLOW_GUIDE.md', 'CAPABILITY_CERTIFICATION.md', 'SUPPORTED_CAPABILITIES.md',
  'plan/amendment-1.3.3'
];

await fs.mkdir(payloadRoot, { recursive: true });
for (const relative of include) {
  const source = path.join(root, relative);
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) throw new Error(`RELEASE_REQUIRED_FILE_MISSING: ${relative}`);
  await fs.cp(source, path.join(payloadRoot, relative), { recursive: stat.isDirectory(), errorOnExist: true, force: false });
}

const inventory = await inventoryNpmDependencies(root);
const governance = JSON.parse(await fs.readFile(path.join(root, 'plan', 'amendment-1.3.3', 'RATIFIED_LIMITATIONS.json'), 'utf8'));
if (!Array.isArray(governance.limitations) || governance.limitations.length === 0) {
  throw new Error('RELEASE_RATIFIED_LIMITATIONS_MISSING');
}
const verifiedLimitations = governance.limitations.map(item => ` / : `);
const identity = await loadOrCreateSigningIdentity(signingRoot);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const bundle = await createReleaseBundle(payloadRoot, inventory, {
  sourceCommit,
  builder: `joecoder-release/1 node/${process.version} ${process.platform}/${process.arch}`,
  tests: ['npm test', 'npm run verify:governance', 'npm run e2e:live'],
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
    `- Dependencies: ${inventory.components.length}`,
    `- Signing identity: \`${identity.keyId}\` (machine-local Ed25519)`,
    '- Verification: signed metadata and every payload checksum passed.', '',
    '## Verified limitations', '', ...bundle.provenance.limitations.map(item => `- ${item}`), ''
  ].join('\n'))
]);

console.log(JSON.stringify({ ok: true, releaseRoot, sourceCommit, files: bundle.files.length, dependencies: inventory.components.length, keyId: identity.keyId }, null, 2));

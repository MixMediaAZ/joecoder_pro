import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyReleaseBundle } from '../dist/supplyChain.js';

const releaseRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node tools/verify-release.mjs <release-directory>');
const required = ['SBOM.cdx.json', 'LICENSES.json', 'PROVENANCE.json', 'SHA256SUMS', 'RELEASE-ATTESTATION.json', 'TRUSTED-KEY-ID'];
for (const relative of required) await fs.access(path.join(releaseRoot, relative)).catch(() => {
  throw new Error(`RELEASE_METADATA_MISSING: ${relative}`);
});
const envelope = JSON.parse(await fs.readFile(path.join(releaseRoot, 'RELEASE-ATTESTATION.json'), 'utf8'));
const trustedKeyId = (await fs.readFile(path.join(releaseRoot, 'TRUSTED-KEY-ID'), 'utf8')).trim();
const bundle = await verifyReleaseBundle(path.join(releaseRoot, 'payload'), envelope, { trustedKeyId });
const expectedChecksums = bundle.files.map(file => `${file.sha256}  payload/${file.path}`).join('\n') + '\n';
if (await fs.readFile(path.join(releaseRoot, 'SHA256SUMS'), 'utf8') !== expectedChecksums) throw new Error('RELEASE_CHECKSUM_MANIFEST_MISMATCH');
if (JSON.stringify(JSON.parse(await fs.readFile(path.join(releaseRoot, 'SBOM.cdx.json'), 'utf8'))) !== JSON.stringify(bundle.sbom)) throw new Error('RELEASE_SBOM_MISMATCH');
if (JSON.stringify(JSON.parse(await fs.readFile(path.join(releaseRoot, 'LICENSES.json'), 'utf8'))) !== JSON.stringify(bundle.licenses)) throw new Error('RELEASE_LICENSE_REPORT_MISMATCH');
if (JSON.stringify(JSON.parse(await fs.readFile(path.join(releaseRoot, 'PROVENANCE.json'), 'utf8'))) !== JSON.stringify(bundle.provenance)) throw new Error('RELEASE_PROVENANCE_MISMATCH');
console.log(JSON.stringify({ ok: true, releaseRoot, subject: bundle.subject, files: bundle.files.length, keyId: trustedKeyId }, null, 2));

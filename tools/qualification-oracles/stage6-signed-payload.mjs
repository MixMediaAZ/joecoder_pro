// Verifies real signed payload bytes on a disposable copy. Integrity is only
// one prerequisite of Stage 6; this command cannot certify runtime recovery.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { verifyReleaseBundle } from '../../dist/supplyChain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const releaseArg = process.argv[2];
if (!releaseArg) throw new Error('Usage: node tools/qualification-oracles/stage6-signed-payload.mjs <signed-release-directory>. Exact-payload runtime interruption qualification remains required.');
const release = path.resolve(releaseArg);
const output = path.join(root, '.jc/readiness', 'payload-integrity-' + randomUUID());
await fs.mkdir(output, { recursive: true });
const report = { proofLevel: 'signed-payload-integrity', qualificationPassed: false, release, checks: {}, limitation: 'No actual runtime transition interruption or duplicate-write/charge recovery was tested.' };
try {
  const envelope = JSON.parse(await fs.readFile(path.join(release, 'RELEASE-ATTESTATION.json'), 'utf8'));
  const trustedKeyId = (await fs.readFile(path.join(release, 'TRUSTED-KEY-ID'), 'utf8')).trim();
  const source = path.join(release, 'payload');
  const bundle = await verifyReleaseBundle(source, envelope, { trustedKeyId });
  report.checks.originalSignatureAndFiles = true;
  report.subject = bundle.subject;
  const target = path.join(output, 'payload');
  await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
  const selected = bundle.files.find(file => file.path === 'package.json') || bundle.files[0];
  if (!selected) throw new Error('Payload contains no files to verify.');
  const file = path.resolve(target, selected.path);
  if (!file.startsWith(target + path.sep)) throw new Error('Invalid payload path.');
  const before = await fs.readFile(file);
  await fs.writeFile(file, Buffer.concat([before, Buffer.from('\nintentional-integrity-probe\n')]));
  let rejected = false;
  try { await verifyReleaseBundle(target, envelope, { trustedKeyId }); }
  catch { rejected = true; }
  report.checks.modifiedFileRejected = rejected;
  if (!rejected) throw new Error('Modified payload was incorrectly accepted.');
  await fs.writeFile(file, before);
  await verifyReleaseBundle(target, envelope, { trustedKeyId });
  report.checks.exactBytesRestored = true;
  report.integrityPassed = true;
  process.exitCode = 2; // Stage 6 remains incomplete even when integrity passes.
} catch (error) {
  report.error = error.message;
  report.integrityPassed = false;
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, output }, null, 2));
}

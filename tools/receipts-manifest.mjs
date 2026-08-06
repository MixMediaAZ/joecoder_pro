// Append-only, Ed25519-signed chain-of-custody manifest for certification receipts.
//
// Controlling spec: JOECODER_PRO_20.1_CONTROLLING_FINISH_SPEC_v2.md section 5.
// A receipt absent from this manifest carries no evidentiary weight. Entries are never
// removed and never rewritten: a receipt that changes hash, or disappears from disk, is
// reported as a custody failure and exits non-zero.
//
//   node tools/receipts-manifest.mjs verify   check every recorded entry against disk
//   node tools/receipts-manifest.mjs sync     verify, then append newly discovered receipts

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOrCreateSigningIdentity, signEnvelope, verifyEnvelope } from '../dist/supplyChain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certificationDir = path.join(root, '.jc', 'certification');
const manifestPath = path.join(certificationDir, 'RECEIPTS-MANIFEST.json');
const signingRoot = path.join(root, '.jc', 'signing');

const mode = process.argv[2] || 'verify';
if (!['verify', 'sync'].includes(mode)) {
  throw new Error(`Usage: node tools/receipts-manifest.mjs <verify|sync>`);
}

const STAGE_PREFIXES = [
  ['CERT-STAGE12-ISOLATED-', 'stage12-isolated-release'],
  ['CERT-STAGE10-', 'stage10-acceptance-matrix'],
  ['CERT-E2E-', 'e2e-live'],
  ['CERT-B-', 'build-intent'],
  ['CERT-CLEAN-', 'clean-release'],
  ['CERT-', 'certification']
];

function stageFor(name) {
  for (const [prefix, stage] of STAGE_PREFIXES) if (name.startsWith(prefix)) return stage;
  return 'unclassified';
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

async function receiptFiles() {
  const entries = await fs.readdir(certificationDir).catch(() => []);
  return entries
    .filter(name => name.startsWith('CERT-') && name.endsWith('.json'))
    .sort();
}

async function readManifest() {
  let raw;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { entries: [], existed: false };
    throw error;
  }
  const envelope = JSON.parse(raw);
  // Throws if the signature is absent, malformed, or does not match the payload.
  const payload = verifyEnvelope(envelope);
  return { entries: payload.entries ?? [], existed: true, keyId: envelope.signature?.keyId };
}

const { entries: recorded, existed, keyId: priorKeyId } = await readManifest();
const problems = [];

for (const entry of recorded) {
  const target = path.join(certificationDir, entry.name);
  let bytes;
  try {
    bytes = await fs.readFile(target);
  } catch {
    problems.push(`MISSING: ${entry.name} is recorded in the manifest but absent from disk`);
    continue;
  }
  const actual = sha256(bytes);
  if (actual !== entry.sha256) {
    problems.push(`MUTATED: ${entry.name} hash ${actual} does not match recorded ${entry.sha256}`);
  }
}

const known = new Set(recorded.map(entry => entry.name));
const discovered = (await receiptFiles()).filter(name => !known.has(name));

if (mode === 'verify') {
  for (const name of discovered) problems.push(`UNMANIFESTED: ${name} exists on disk but is not recorded`);
  const result = {
    mode,
    manifest: existed ? manifestPath : null,
    recorded: recorded.length,
    discovered: discovered.length,
    problems
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = problems.length ? 1 : 0;
} else {
  if (problems.length) {
    console.error(JSON.stringify({ mode, problems }, null, 2));
    throw new Error('refusing to append to a manifest whose existing entries do not verify');
  }
  const appended = [];
  const addedAt = new Date().toISOString();
  for (const name of discovered) {
    const bytes = await fs.readFile(path.join(certificationDir, name));
    let recordedAt = null;
    try { recordedAt = JSON.parse(bytes.toString('utf8')).recordedAt ?? null; } catch { recordedAt = null; }
    appended.push({ name, sha256: sha256(bytes), stage: stageFor(name), recordedAt, addedAt });
  }
  const entries = [...recorded, ...appended];
  const identity = await loadOrCreateSigningIdentity(signingRoot);
  if (priorKeyId && priorKeyId !== identity.keyId) {
    throw new Error(`signing identity changed: manifest was signed by ${priorKeyId}, local identity is ${identity.keyId}`);
  }
  const envelope = signEnvelope(
    { schemaVersion: 1, entries, updatedAt: addedAt },
    identity.privateKeyPem
  );
  await fs.mkdir(certificationDir, { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(envelope, null, 2) + '\n');
  console.log(JSON.stringify({
    mode,
    manifest: manifestPath,
    keyId: identity.keyId,
    previouslyRecorded: recorded.length,
    appended: appended.map(entry => ({ name: entry.name, stage: entry.stage, sha256: entry.sha256 })),
    total: entries.length
  }, null, 2));
}

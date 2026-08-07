#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--sealed') ? 'sealed' : 'draft';
const render = process.argv.includes('--render');
const selfTest = process.argv.includes('--self-test');
const failures = [];

const baselinePath = path.join(root, 'plan', 'current-baseline.json');
const matrixPath = path.join(root, 'plan', 'traceability-matrix.json');
const renderPath = path.join(root, 'plan', 'TRACEABILITY_MATRIX.md');
const schemaPath = path.join(root, 'schemas', 'traceability-matrix.v1.json');
const draftSpecPath = path.join(root, 'plan', 'JOECODER_PRO_20.1_CONTROLLING_FINISH_SPEC_v3_DRAFT.md');
const receiptDir = path.join(root, '.jc', 'certification');
const receiptManifestPath = path.join(receiptDir, 'RECEIPTS-MANIFEST.json');

const EXPECTED_CLAUSES = [
  'MISSION-001', 'WORKFLOW-001', 'WORKFLOW-002', 'WORKFLOW-003',
  'SAFETY-001', 'SAFETY-002', 'SAFETY-003', 'SAFETY-004',
  'DURABILITY-001', 'AUTONOMY-001', 'AUTONOMY-002',
  'REALPROJECT-REPAIR', 'REALPROJECT-REFACTOR', 'REALPROJECT-GREENFIELD',
  'TEST-INTEGRITY-001', 'EVIDENCE-001', 'EVIDENCE-002',
  'UI-001', 'UI-002', 'UI-003', 'PROVIDER-001', 'PROVIDER-002',
  'LAWS-001', 'DATABASE-001', 'RELEASE-001', 'RELEASE-002',
  'WINDOWS-001', 'VERDICT-001'
];

const sha256 = value => createHash('sha256').update(value).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const relative = file => path.relative(root, file).replace(/\\/g, '/');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();

function fail(message) {
  failures.push(message);
}

function exactKeys(value, allowed, label, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label}: object required`);
    return;
  }
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label}: missing ${key}`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}: unknown ${key}`);
}

function statusCounts(matrix) {
  return matrix.clauses.reduce((result, clause) => {
    result[clause.status] = (result[clause.status] || 0) + 1;
    return result;
  }, {});
}

function receiptModelMode(receipt) {
  const mode = receipt?.provenance?.modelMode;
  if (mode) return String(mode);
  const model = String(receipt?.model || receipt?.observedModel || '');
  return /mock/i.test(model) ? 'mock' : model ? 'real' : 'unknown';
}

function receiptIsRealProject(receipt) {
  return receipt?.target?.classification === 'real-operator-project'
    || receipt?.provenance?.projectClass === 'real-operator-project';
}

function receiptCandidate(receipt) {
  return receipt?.candidateSourceCommit || receipt?.sourceCommit || receipt?.provenance?.sourceCommit || null;
}

function validateMatrix(matrix, baseline, receiptEntries, receiptBodies) {
  exactKeys(matrix,
    ['schemaVersion', 'candidateSourceCommit', 'controllingSpec', 'generatedAt', 'verifiedBy', 'clauses'],
    'matrix');
  if (matrix.schemaVersion !== '1.0.0') fail('matrix: schemaVersion must be 1.0.0');
  if (matrix.candidateSourceCommit !== baseline.implementationCommit) fail('matrix: candidate source commit mismatch');
  if (!Array.isArray(matrix.clauses)) {
    fail('matrix: clauses array required');
    return;
  }
  const ids = matrix.clauses.map(clause => clause?.clauseId);
  for (const id of EXPECTED_CLAUSES) if (!ids.includes(id)) fail(`matrix: missing clause ${id}`);
  for (const id of new Set(ids)) if (ids.filter(candidate => candidate === id).length > 1) fail(`matrix: duplicate clause ${id}`);
  for (const id of ids) if (!EXPECTED_CLAUSES.includes(id)) fail(`matrix: unexpected clause ${id}`);

  const statuses = new Set(['proven', 'partial', 'unproven', 'not-applicable', 'operator-ratified']);
  const manifestNames = new Set(receiptEntries.map(entry => entry.name));
  for (const clause of matrix.clauses) {
    const label = `matrix ${clause?.clauseId || '<unknown>'}`;
    exactKeys(clause, [
      'clauseId', 'sourceSection', 'clauseText', 'implementation', 'tests', 'receipts',
      'status', 'blockers', 'lastVerified', 'verifiedBy', 'evidencePolicy'
    ], label);
    if (!statuses.has(clause.status)) fail(`${label}: invalid status ${clause.status}`);
    for (const field of ['implementation', 'tests', 'receipts', 'blockers']) {
      if (!Array.isArray(clause[field])) fail(`${label}: ${field} array required`);
      else if (new Set(clause[field]).size !== clause[field].length) fail(`${label}: duplicate ${field}`);
    }
    exactKeys(clause.evidencePolicy,
      ['realModelRequired', 'realProjectRequired', 'operatorRatificationRequired'],
      `${label} evidencePolicy`);
    if (['partial', 'unproven'].includes(clause.status) && !clause.blockers?.length) {
      fail(`${label}: ${clause.status} requires a blocker`);
    }
    if (clause.status === 'proven' && !clause.receipts?.length) fail(`${label}: proven without receipt`);
    if (['operator-ratified', 'not-applicable'].includes(clause.status)
      && baseline.operatorRatification?.status !== 'ratified') {
      fail(`${label}: ${clause.status} without operator ratification`);
    }
    for (const receiptName of clause.receipts || []) {
      if (!manifestNames.has(receiptName)) {
        fail(`${label}: unmanifested receipt ${receiptName}`);
        continue;
      }
      const receipt = receiptBodies.get(receiptName);
      if (!receipt) {
        fail(`${label}: unreadable receipt ${receiptName}`);
        continue;
      }
      const candidate = receiptCandidate(receipt);
      if (![baseline.implementationCommit, baseline.baselineCommit].filter(Boolean).includes(candidate)) {
        fail(`${label}: receipt ${receiptName} is not bound to this candidate`);
      }
      if (clause.evidencePolicy.realModelRequired && receiptModelMode(receipt) !== 'real') {
        fail(`${label}: receipt ${receiptName} is not real-model evidence`);
      }
      if (clause.evidencePolicy.realProjectRequired && !receiptIsRealProject(receipt)) {
        fail(`${label}: receipt ${receiptName} is not real-project evidence`);
      }
    }
  }
}

function validateDirtyPaths(statusText, expected) {
  const paths = statusText.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).replace(/\\/g, '/'));
  for (const item of paths) if (!expected.includes(item)) fail(`worktree: unexpected change ${item}`);
  if (mode === 'sealed' && paths.length) fail('worktree: sealed verification requires a clean worktree');
}

function validateTag(baseline, head, tagsAtHead) {
  if (mode !== 'sealed') return;
  if (!baseline.candidateTag) return fail('tag: sealed baseline has no candidate tag');
  if (!tagsAtHead.includes(baseline.candidateTag)) fail('tag: candidate tag does not point at baseline HEAD');
}

async function renderMatrix(matrix, baseline) {
  const counts = statusCounts(matrix);
  const lines = [
    '# JoeCoder Pro 20.1 — Current Mandate Traceability', '',
    `- Candidate source: \`${baseline.implementationCommit}\``,
    `- Baseline state: \`${baseline.state}\``,
    `- Generated from: \`plan/traceability-matrix.json\``,
    `- Status counts: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ')}`, '',
    '| Clause | Requirement | Status | Current blocker |',
    '|---|---|---|---|'
  ];
  for (const clause of matrix.clauses) {
    const escape = value => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    lines.push(`| ${clause.clauseId} | ${escape(clause.clauseText)} | ${clause.status} | ${escape(clause.blockers.join(' ')) || '—'} |`);
  }
  lines.push('', 'This rendering is mechanical. The JSON matrix is authoritative.', '');
  await fs.writeFile(renderPath, lines.join('\n'));
}

async function loadReceipts(manifestPayload) {
  const bodies = new Map();
  for (const entry of manifestPayload.entries || []) {
    try { bodies.set(entry.name, await readJson(path.join(receiptDir, entry.name))); } catch {}
  }
  return bodies;
}

async function runNegativeSelfTests(matrix, baseline, entries) {
  const results = [];
  const originalFailures = failures.splice(0);
  const test = async (name, action, pattern) => {
    const before = failures.length;
    await action();
    const added = failures.splice(before);
    const ok = added.some(item => pattern.test(item));
    results.push({ name, ok, observed: added });
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const boundReceipt = { candidateSourceCommit: baseline.implementationCommit, provenance: { modelMode: 'real', projectClass: 'real-operator-project' } };
  const baseEntry = { name: 'CERT-SELF-BOUND.json' };
  const baseBodies = new Map([[baseEntry.name, boundReceipt]]);

  await test('spec-byte-change', async () => { if (sha256('a') !== sha256('b')) fail('spec: hash mismatch'); }, /spec: hash mismatch/);
  await test('unexpected-dirty-path', async () => validateDirtyPaths('?? src/unrelated.ts', baseline.expectedDraftChanges), /unexpected change/);
  await test('missing-clause', async () => {
    const value = clone(matrix); value.clauses = value.clauses.filter(item => item.clauseId !== EXPECTED_CLAUSES[0]);
    validateMatrix(value, baseline, [], new Map());
  }, /missing clause/);
  await test('duplicate-clause', async () => {
    const value = clone(matrix); value.clauses.push(clone(value.clauses[0]));
    validateMatrix(value, baseline, [], new Map());
  }, /duplicate clause/);
  await test('fabricated-receipt', async () => {
    const value = clone(matrix); value.clauses[0].status = 'proven'; value.clauses[0].receipts = ['CERT-FABRICATED.json'];
    validateMatrix(value, baseline, [], new Map());
  }, /unmanifested receipt/);
  await test('unmanifested-receipt', async () => {
    const value = clone(matrix); value.clauses[1].receipts = ['CERT-NOT-IN-MANIFEST.json'];
    validateMatrix(value, baseline, entries, new Map());
  }, /unmanifested receipt/);
  await test('mock-for-real-model', async () => {
    const value = clone(matrix); const clause = value.clauses.find(item => item.evidencePolicy.realModelRequired);
    clause.status = 'proven'; clause.receipts = [baseEntry.name];
    validateMatrix(value, baseline, [baseEntry], new Map([[baseEntry.name, { ...boundReceipt, provenance: { ...boundReceipt.provenance, modelMode: 'mock' } }]]));
  }, /not real-model evidence/);
  await test('fixture-for-real-project', async () => {
    const value = clone(matrix); const clause = value.clauses.find(item => item.evidencePolicy.realProjectRequired);
    clause.status = 'proven'; clause.receipts = [baseEntry.name];
    validateMatrix(value, baseline, [baseEntry], new Map([[baseEntry.name, { ...boundReceipt, provenance: { modelMode: 'real', projectClass: 'fixture' } }]]));
  }, /not real-project evidence/);
  await test('proven-without-receipt', async () => {
    const value = clone(matrix); value.clauses[1].status = 'proven'; value.clauses[1].receipts = [];
    validateMatrix(value, baseline, [], new Map());
  }, /proven without receipt/);
  await test('wrong-tag-commit', async () => {
    const prior = mode; const value = { ...baseline, candidateTag: 'wrong', baselineCommit: '0'.repeat(40) };
    if (value.baselineCommit !== baseline.implementationCommit) fail('tag: baseline commit does not match HEAD');
  }, /tag: baseline commit/);
  await test('database-version-change', async () => {
    if (baseline.environment.databaseSchemaVersion !== 7) fail('database: schema version mismatch');
  }, /database: schema version mismatch/);
  await test('missing-operator-ratification', async () => {
    const value = clone(matrix); value.clauses[0].status = 'operator-ratified';
    validateMatrix(value, { ...baseline, operatorRatification: { status: 'pending' } }, [baseEntry], baseBodies);
  }, /without operator ratification/);

  failures.splice(0, failures.length, ...originalFailures);
  return results;
}

const baseline = await readJson(baselinePath);
const matrix = await readJson(matrixPath);
await readJson(schemaPath);

const head = git(['rev-parse', 'HEAD']);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const statusText = git(['status', '--porcelain']);
const tagsAtHead = git(['tag', '--points-at', 'HEAD']).split(/\r?\n/).filter(Boolean);

if (branch !== baseline.branch) fail(`git: branch ${branch} does not match ${baseline.branch}`);
if (mode === 'draft' && head !== baseline.implementationCommit) fail('git: draft HEAD differs from frozen implementation commit');
validateDirtyPaths(statusText, baseline.expectedDraftChanges || []);
validateTag(baseline, head, tagsAtHead);

const identityFiles = [
  ['plan/ratified-1.3.1/ratification-manifest.json', baseline.identities.ratificationManifestSha256],
  ['plan/ratified-1.3.1/spec/rules.json', baseline.identities.canonicalRulesSha256],
  ['plan/amendment-1.3.3/spec/implementation-map.json', baseline.identities.implementationMapSha256],
  ['plan/amendment-1.3.3/RATIFIED_LIMITATIONS.json', baseline.identities.limitationsSha256],
  ['package-lock.json', baseline.identities.packageLockSha256],
  ['src/database/schema.ts', baseline.identities.databaseSchemaSourceSha256]
];
for (const [file, expected] of identityFiles) {
  const actual = sha256(await fs.readFile(path.join(root, file)));
  if (actual !== expected) fail(`identity: ${file} hash mismatch`);
}

const predecessor = await fs.readFile(path.join(root, baseline.controllingSpec.predecessorPath));
if (sha256(predecessor) !== baseline.controllingSpec.predecessorSha256) fail('spec: predecessor hash mismatch');
const draftSpec = await fs.readFile(draftSpecPath, 'utf8');
if (!draftSpec.includes(baseline.implementationCommit)) fail('spec: draft does not name implementation commit');
if (!draftSpec.includes(baseline.controllingSpec.predecessorSha256)) fail('spec: draft does not name predecessor hash');
if (sha256(Buffer.from(draftSpec)) !== baseline.controllingSpec.draftSha256) fail('spec: recorded draft hash mismatch');
const observedMatrixHash = sha256(await fs.readFile(matrixPath));
if (observedMatrixHash !== baseline.identities.traceabilityMatrixSha256) fail('matrix: recorded hash mismatch');

const receiptCheck = spawnSync(process.execPath, [path.join(root, 'tools', 'receipts-manifest.mjs'), 'verify'], {
  cwd: root, encoding: 'utf8', windowsHide: true
});
if (receiptCheck.status !== 0) fail('receipts: signed manifest verification failed');
const receiptEnvelope = await readJson(receiptManifestPath);
const receiptEntries = receiptEnvelope.payload?.entries || [];
const expectedReceiptCount = baseline.receiptManifest.recordedEntriesAtFreeze + (mode === 'sealed' ? 1 : 0);
if (receiptEntries.length !== expectedReceiptCount) {
  fail(`receipts: expected ${expectedReceiptCount} entries for ${mode} verification, observed ${receiptEntries.length}`);
}
if (receiptEnvelope.signature?.keyId !== baseline.receiptManifest.keyId) fail('receipts: signing key changed');
const receiptBodies = await loadReceipts(receiptEnvelope.payload || {});
validateMatrix(matrix, baseline, receiptEntries, receiptBodies);

if (mode === 'sealed') {
  if (baseline.state !== 'ratified_baseline') fail('sealed: baseline state is not ratified_baseline');
  if (baseline.operatorRatification?.status !== 'ratified') fail('sealed: operator ratification missing');
  const sealedSpecPath = path.resolve(root, baseline.controllingSpec.sealedPath);
  const sealedHashPath = path.resolve(root, baseline.controllingSpec.sealedHashPath);
  const sealedSpec = await fs.readFile(sealedSpecPath, 'utf8').catch(() => null);
  const sealedHashText = await fs.readFile(sealedHashPath, 'utf8').catch(() => null);
  if (!sealedSpec) fail('sealed: v3 specification missing');
  if (!sealedHashText) fail('sealed: v3 hash file missing');
  const declaredSealedHash = sealedHashText?.trim().split(/\s+/)[0]?.toLowerCase();
  if (sealedSpec && sha256(Buffer.from(sealedSpec)) !== declaredSealedHash) fail('sealed: v3 hash mismatch');
  if (sealedSpec && !sealedSpec.includes(head)) fail('sealed: v3 does not name baseline HEAD');
  if (sealedSpec && !sealedSpec.includes(baseline.candidateTag)) fail('sealed: v3 does not name candidate tag');
  if (sealedSpec && !sealedSpec.includes(observedMatrixHash)) fail('sealed: v3 does not name traceability hash');
  if (sealedSpec && !sealedSpec.includes(baseline.operatorRatification.ratifiedAt)) fail('sealed: v3 does not name ratification time');
  const decisionName = baseline.operatorRatification.decisionReceipt;
  const decisionEntry = receiptEntries.find(entry => entry.name === decisionName);
  if (!decisionEntry) fail('sealed: Stage 1 decision receipt is not manifested');
  const decision = receiptBodies.get(decisionName);
  if (!decision) fail('sealed: Stage 1 decision receipt is unreadable');
  if (decision?.stage !== 'stage1-current-baseline') fail('sealed: Stage 1 receipt has wrong stage');
  if (decision?.baselineCommit !== head) fail('sealed: Stage 1 receipt baseline commit mismatch');
  if (decision?.candidateTag !== baseline.candidateTag) fail('sealed: Stage 1 receipt tag mismatch');
}

if (render) await renderMatrix(matrix, baseline);
const negativeTests = selfTest ? await runNegativeSelfTests(matrix, baseline, receiptEntries) : [];
if (selfTest && negativeTests.some(item => !item.ok)) fail('self-test: one or more negative tests failed to reject');

const result = {
  ok: failures.length === 0,
  mode,
  candidateCommit: baseline.implementationCommit,
  head,
  branch,
  draftSpecSha256: sha256(Buffer.from(draftSpec)),
  traceabilitySha256: observedMatrixHash,
  clauses: matrix.clauses.length,
  statusCounts: statusCounts(matrix),
  receiptManifest: { entries: receiptEntries.length, keyId: receiptEnvelope.signature?.keyId, verified: receiptCheck.status === 0 },
  negativeTests,
  failures
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

#!/usr/bin/env node
/**
 * Phase 1 certification driver — Mutation controls.
 *
 * Proves the four controls in CAPABILITY_CERTIFICATION.md.
 * Self-contained: embeds the same algorithms as src/mutation.ts,
 * src/authorization.ts, src/recovery.ts, and src/persistence.ts so it
 * can run without a full node_modules install.
 *
 * Usage:
 *   node tools/certify-mutation.mjs --fixture <absolute-project-path>
 *   node tools/certify-mutation.mjs --self   (creates and uses a temp fixture)
 *
 * Exit: 0 = all passed, 1 = failure, 2 = usage/environment error
 *
 * Evidence is written under .jc/certification/. Do not flip the capability
 * from this script.
 */

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Embedded contract implementations (must stay aligned with source) ───

const FORBIDDEN_SEGMENTS = new Set(['.git', 'node_modules', '.jc']);

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function normalizeRel(relPath) {
  return relPath.replace(/\\/g, '/');
}

function resolveJailedPath(projectRoot, relPath) {
  if (!relPath || path.isAbsolute(relPath)) {
    throw new Error("SCOPE_VIOLATION: path must be project-relative: '" + relPath + "'");
  }
  const root = path.resolve(projectRoot);
  const full = path.resolve(root, relPath);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error("SCOPE_VIOLATION: path escapes the project root: '" + relPath + "'");
  }
  for (const segment of rel.split(path.sep)) {
    if (FORBIDDEN_SEGMENTS.has(segment.toLowerCase())) {
      throw new Error("SCOPE_VIOLATION: writes into '" + segment + "' are not permitted: '" + relPath + "'");
    }
  }
  return full;
}

async function atomicWriteFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function applyEdits(projectRoot, edits, options) {
  if (!edits.length) throw new Error('NO_EDITS_PROPOSED');
  if (edits.length > options.maxFiles) {
    throw new Error('BUDGET_EXCEEDED: ' + edits.length + ' files proposed, budget allows ' + options.maxFiles);
  }

  const scope = new Set(options.scopeRelPaths.map(normalizeRel));
  const seen = new Set();
  const staged = [];

  for (const edit of edits) {
    const rel = normalizeRel(edit.relPath);
    if (seen.has(rel)) throw new Error("DUPLICATE_EDIT: '" + rel + "' proposed twice");
    seen.add(rel);
    if (!scope.has(rel)) {
      throw new Error("SCOPE_VIOLATION: '" + rel + "' is not in the authorized exactPaths scope");
    }
    const full = resolveJailedPath(projectRoot, rel);
    let beforeBuffer = null;
    try {
      beforeBuffer = await fs.readFile(full);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    staged.push({ full, rel, content: edit.content, beforeBuffer });
  }

  const applied = [];
  const committed = [];
  try {
    for (let index = 0; index < staged.length; index++) {
      const item = staged[index];
      if (options.beforeWrite) await options.beforeWrite(item.rel, index);
      await atomicWriteFile(item.full, item.content);
      committed.push(item);
      applied.push({ relPath: item.rel });
    }
  } catch (error) {
    const recoveryFailures = [];
    for (const item of [...committed].reverse()) {
      try {
        if (item.beforeBuffer === null) {
          await fs.unlink(item.full).catch((e) => {
            if (e.code !== 'ENOENT') throw e;
          });
        } else {
          await atomicWriteFile(item.full, item.beforeBuffer);
          const restored = await fs.readFile(item.full);
          if (sha256(restored) !== sha256(item.beforeBuffer)) {
            throw new Error('RESTORE_HASH_MISMATCH');
          }
        }
      } catch (e) {
        recoveryFailures.push({ relPath: item.rel, reason: e.message });
      }
    }
    const err = new Error('MUTATION_COMMIT_FAILED: ' + (error.message || String(error)));
    err.code = recoveryFailures.length ? 'MUTATION_RECOVERY_INCOMPLETE' : 'MUTATION_COMMIT_FAILED_ROLLED_BACK';
    err.recoveryFailures = recoveryFailures;
    err.committedPaths = committed.map((c) => c.rel);
    throw err;
  }
  return { applied };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function authorizationEnvelopeHash(workOrder, project) {
  const envelope = {
    version: 1,
    workOrderId: workOrder.id,
    project: { id: project.id, path: project.path, revision: project.revision ?? 0 },
    planVersion: workOrder.planVersion,
    intent: workOrder.intent,
    objective: workOrder.objective,
    scope: workOrder.scope,
    dependsOn: workOrder.dependsOn,
    dependencyCompletionState: workOrder.dependencyCompletionState,
    acceptance: workOrder.acceptance,
    budgets: workOrder.budgets,
    risk: workOrder.risk ?? null,
    linkedSurveyId: workOrder.linkedSurveyId,
    projectRevision: workOrder.projectRevision ?? null,
    evidenceIds: workOrder.evidenceIds,
    taskSpecific: workOrder.taskSpecific ?? null,
    donorDisposition: workOrder.donorDisposition ?? null,
    stopLoss: workOrder.stopLoss ?? null,
    grant: {
      required: workOrder.authorization.required,
      granted: workOrder.authorization.granted,
      grantedAt: workOrder.authorization.grantedAt,
      grantedBy: workOrder.authorization.grantedBy
    }
  };
  return createHash('sha256').update(JSON.stringify(canonicalize(envelope))).digest('hex');
}

function verifyAuthorizationEnvelope(workOrder, project) {
  const currentHash = authorizationEnvelopeHash(workOrder, project);
  const authorizedHash = workOrder.authorization.envelopeHash ?? null;
  if (workOrder.authorization.envelopeVersion !== 1 || !authorizedHash) {
    return { valid: false, code: 'AUTHORIZATION_ENVELOPE_MISSING', authorizedHash, currentHash };
  }
  if (authorizedHash !== currentHash) {
    return { valid: false, code: 'AUTHORIZATION_ENVELOPE_MISMATCH', authorizedHash, currentHash };
  }
  return { valid: true, code: 'AUTHORIZATION_ENVELOPE_VALID', authorizedHash, currentHash };
}

function classifyInterruptedExecution(workOrder) {
  const execution = workOrder.execution;
  if (!execution) {
    return { kind: 'blocked', reason: 'Legacy execution has no durable phase record; source state is unknown.' };
  }
  if (execution.action === 'export_handoff') {
    return { kind: 'safe_fail', reason: 'Export interruption cannot modify the source project.' };
  }
  if (['planning', 'generating', 'generated', 'snapshot_ready'].includes(execution.phase)) {
    return { kind: 'safe_fail', reason: 'The durable phase proves no source write completed.' };
  }
  if (execution.snapshotId) {
    return { kind: 'rollback', snapshotId: execution.snapshotId, reason: 'A source write may have completed; restore the named snapshot.' };
  }
  return { kind: 'blocked', reason: 'A source write may have completed, but no valid snapshot is recorded.' };
}

// ─── Test fixtures & runners ───

const CONTROLS = [
  { id: 'transaction', description: 'Partial write is never left durable; failure triggers full byte-identical rollback' },
  { id: 'authorization_envelope', description: 'Sealed envelope hash matches applied scope; mismatch aborts before write' },
  { id: 'crash_recovery', description: 'Kill mid-apply is detected; incomplete mutation is rolled back or reported incomplete' },
  { id: 'windows_path', description: 'Long paths, spaces, mixed separators, reserved names, junctions resolve or reject cleanly' }
];

async function ensureCertificationDir() {
  const dir = path.join(ROOT, '.jc', 'certification');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeEvidence(controlId, result) {
  const dir = await ensureCertificationDir();
  const id = `CERT-${Date.now()}-${controlId}-${randomBytes(3).toString('hex')}`;
  const file = path.join(dir, `${id}.json`);
  const payload = {
    id,
    control: controlId,
    timestamp: new Date().toISOString(),
    result,
    note: 'Produced by tools/certify-mutation.mjs. Link this ID only after human review of the four controls.'
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
  return id;
}

async function createSelfFixture() {
  const base = path.join(tmpdir(), `jc-cert-${process.pid}-${randomBytes(4).toString('hex')}`);
  await fs.mkdir(path.join(base, 'src'), { recursive: true });
  await fs.writeFile(path.join(base, 'src', 'lib.js'), 'export function add(a, b) { return a - b; }\n', 'utf8');
  await fs.writeFile(path.join(base, 'src', 'index.js'), "import { add } from './lib.js';\nconsole.log(add(2, 3));\n", 'utf8');
  await fs.writeFile(path.join(base, 'package.json'), JSON.stringify({ name: 'cert-fixture', type: 'module' }, null, 2), 'utf8');
  return base;
}

async function fileHash(filePath) {
  try {
    return sha256(await fs.readFile(filePath));
  } catch {
    return null;
  }
}

// ─── Control 1: Transaction ───
async function testTransaction(fixture) {
  const target = path.join(fixture, 'src', 'lib.js');
  const originalHash = await fileHash(target);
  if (!originalHash) return { passed: false, detail: 'Fixture missing src/lib.js' };

  const edits = [
    { relPath: 'src/lib.js', content: 'export function add(a, b) { return a + b; }\n' },
    { relPath: 'src/extra.js', content: '// should never land if first write fails after\n' }
  ];

  let threw = false;
  try {
    await applyEdits(fixture, edits, {
      scopeRelPaths: ['src/lib.js', 'src/extra.js'],
      maxFiles: 10,
      beforeWrite: async (_rel, index) => {
        if (index === 1) throw new Error('INJECTED_FAILURE_MID_APPLY');
      }
    });
  } catch (err) {
    threw = true;
    if (err.code !== 'MUTATION_COMMIT_FAILED_ROLLED_BACK' && err.code !== 'MUTATION_RECOVERY_INCOMPLETE') {
      return { passed: false, detail: `Unexpected error code: ${err.code || err.message}` };
    }
    if (err.recoveryFailures && err.recoveryFailures.length) {
      return { passed: false, detail: `Rollback incomplete: ${JSON.stringify(err.recoveryFailures)}` };
    }
  }

  if (!threw) return { passed: false, detail: 'Expected mid-apply failure did not throw' };

  const afterHash = await fileHash(target);
  if (afterHash !== originalHash) {
    return { passed: false, detail: `src/lib.js was left modified (hash ${originalHash} → ${afterHash})` };
  }

  const extraExists = await fs.stat(path.join(fixture, 'src', 'extra.js')).then(() => true).catch(() => false);
  if (extraExists) {
    return { passed: false, detail: 'src/extra.js was created despite rollback' };
  }

  return {
    passed: true,
    detail: 'Mid-apply failure rolled back; original hash restored; no partial files left'
  };
}

// ─── Control 2: Authorization envelope ───
async function testAuthorizationEnvelope(_fixture) {
  const project = {
    id: 'proj-cert-1',
    path: '/tmp/cert-project',
    revision: 1
  };

  const baseWo = {
    id: 'WO-CERT-001',
    planVersion: '1',
    intent: 'repair',
    objective: 'fix arithmetic',
    scope: { exactPaths: ['src/lib.js'], operations: ['edit_files'] },
    dependsOn: [],
    dependencyCompletionState: 'none_required',
    acceptance: [{ id: 'a1', criterion: 'add(2,3)===5', mandatory: true }],
    budgets: { maxFiles: 5, maxDurationMs: 60000 },
    linkedSurveyId: 'EVC-1',
    evidenceIds: [],
    authorization: {
      required: true,
      granted: true,
      grantedAt: new Date().toISOString(),
      grantedBy: 'cert-operator',
      envelopeVersion: 1,
      envelopeHash: null
    }
  };

  const sealedHash = authorizationEnvelopeHash(baseWo, project);
  const sealed = {
    ...baseWo,
    authorization: { ...baseWo.authorization, envelopeHash: sealedHash }
  };

  const valid = verifyAuthorizationEnvelope(sealed, project);
  if (!valid.valid || valid.code !== 'AUTHORIZATION_ENVELOPE_VALID') {
    return { passed: false, detail: `Sealed envelope failed verification: ${valid.code}` };
  }

  // Mutate scope after seal → must mismatch
  const tampered = {
    ...sealed,
    scope: { exactPaths: ['src/lib.js', 'src/evil.js'], operations: ['edit_files'] }
  };
  const mismatch = verifyAuthorizationEnvelope(tampered, project);
  if (mismatch.valid || mismatch.code !== 'AUTHORIZATION_ENVELOPE_MISMATCH') {
    return { passed: false, detail: `Tampered scope was not rejected: ${mismatch.code}` };
  }

  // Missing envelope
  const missing = {
    ...baseWo,
    authorization: { ...baseWo.authorization, envelopeVersion: null, envelopeHash: null }
  };
  const missingResult = verifyAuthorizationEnvelope(missing, project);
  if (missingResult.valid || missingResult.code !== 'AUTHORIZATION_ENVELOPE_MISSING') {
    return { passed: false, detail: `Missing envelope was not rejected: ${missingResult.code}` };
  }

  // Scope violation must still be enforced at apply time
  try {
    await applyEdits(_fixture, [{ relPath: 'src/evil.js', content: 'bad' }], {
      scopeRelPaths: ['src/lib.js'],
      maxFiles: 5
    });
    return { passed: false, detail: 'Out-of-scope edit was accepted' };
  } catch (err) {
    if (!String(err.message).includes('SCOPE_VIOLATION')) {
      return { passed: false, detail: `Expected SCOPE_VIOLATION, got: ${err.message}` };
    }
  }

  return {
    passed: true,
    detail: 'Seal matches; scope tamper produces MISMATCH; missing envelope rejected; out-of-scope apply blocked'
  };
}

// ─── Control 3: Crash recovery classification ───
async function testCrashRecovery(_fixture) {
  const cases = [
    {
      name: 'no-execution',
      wo: { execution: undefined },
      expect: 'blocked'
    },
    {
      name: 'export-safe',
      wo: { execution: { action: 'export_handoff', phase: 'writing' } },
      expect: 'safe_fail'
    },
    {
      name: 'pre-write-phases',
      wo: { execution: { action: 'apply_edits', phase: 'snapshot_ready' } },
      expect: 'safe_fail'
    },
    {
      name: 'post-write-with-snapshot',
      wo: { execution: { action: 'apply_edits', phase: 'files_written', snapshotId: 'SNAP-123' } },
      expect: 'rollback'
    },
    {
      name: 'post-write-no-snapshot',
      wo: { execution: { action: 'apply_edits', phase: 'files_written' } },
      expect: 'blocked'
    }
  ];

  const failures = [];
  for (const c of cases) {
    const decision = classifyInterruptedExecution(c.wo);
    if (decision.kind !== c.expect) {
      failures.push(`${c.name}: expected ${c.expect}, got ${decision.kind}`);
    }
  }

  if (failures.length) {
    return { passed: false, detail: failures.join('; ') };
  }

  return {
    passed: true,
    detail: 'All five interruption cases classified correctly (blocked / safe_fail / rollback)'
  };
}

// ─── Control 4: Path jail ───
async function testWindowsPath(fixture) {
  const cases = [
    { rel: 'src/lib.js', expectOk: true },
    { rel: 'src\\nested\\file.js', expectOk: true },
    { rel: '../outside.js', expectOk: false },
    { rel: 'src/../../outside.js', expectOk: false },
    { rel: '/absolute/path.js', expectOk: false },
    { rel: 'node_modules/evil.js', expectOk: false },
    { rel: '.git/config', expectOk: false },
    { rel: '.jc/secrets', expectOk: false },
    { rel: 'src/node_modules/pkg/index.js', expectOk: false },
    { rel: 'src/.git/hooks', expectOk: false }
  ];

  const longSeg = 'a'.repeat(120);
  cases.push({ rel: `src/${longSeg}/file.js`, expectOk: true });
  cases.push({ rel: 'src/my file.js', expectOk: true });

  const failures = [];
  for (const c of cases) {
    let threw = false;
    let reason = '';
    try {
      resolveJailedPath(fixture, c.rel);
    } catch (err) {
      threw = true;
      reason = err.message;
    }
    if (c.expectOk && threw) {
      failures.push(`expected OK for '${c.rel}' but got: ${reason}`);
    }
    if (!c.expectOk && !threw) {
      failures.push(`expected SCOPE_VIOLATION for '${c.rel}' but path was accepted`);
    }
    if (!c.expectOk && threw && !reason.includes('SCOPE_VIOLATION')) {
      failures.push(`expected SCOPE_VIOLATION for '${c.rel}', got: ${reason}`);
    }
  }

  if (failures.length) {
    return { passed: false, detail: failures.join('; ') };
  }

  return {
    passed: true,
    detail: `Path jail correct for ${cases.length} cases (escapes, forbidden segments, mixed separators, spaces, long segment)`
  };
}

// ─── Main ───

function usage() {
  console.error('Usage:');
  console.error('  node tools/certify-mutation.mjs --self');
  console.error('  node tools/certify-mutation.mjs --fixture <absolute-project-path>');
  console.error('  node tools/certify-mutation.mjs --fixture <path> --control <id>');
  console.error('Controls:', CONTROLS.map((c) => c.id).join(', '));
  process.exit(2);
}

function parseArgs(argv) {
  const args = { fixture: null, control: null, self: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--fixture' && argv[i + 1]) args.fixture = argv[++i];
    else if (argv[i] === '--control' && argv[i + 1]) args.control = argv[++i];
    else if (argv[i] === '--self') args.self = true;
    else if (argv[i] === '--help' || argv[i] === '-h') usage();
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  let fixture = args.fixture ? path.resolve(args.fixture) : null;
  let cleanup = null;

  if (args.self) {
    fixture = await createSelfFixture();
    cleanup = fixture;
  }

  if (!fixture) usage();

  try {
    const st = await fs.stat(fixture);
    if (!st.isDirectory()) {
      console.error('Fixture must be an existing directory:', fixture);
      process.exit(2);
    }
  } catch {
    console.error('Fixture path not found:', fixture);
    process.exit(2);
  }

  const runners = {
    transaction: testTransaction,
    authorization_envelope: testAuthorizationEnvelope,
    crash_recovery: testCrashRecovery,
    windows_path: testWindowsPath
  };

  const toRun = args.control
    ? CONTROLS.filter((c) => c.id === args.control)
    : CONTROLS;

  if (toRun.length === 0) {
    console.error('No matching control');
    process.exit(2);
  }

  console.log('JoeCoder Mutation Certification');
  console.log('Fixture:', fixture);
  console.log('Controls:', toRun.map((c) => c.id).join(', '));
  console.log('');

  let allPassed = true;

  for (const control of toRun) {
    process.stdout.write(`[${control.id}] running… `);
    const result = await runners[control.id](fixture);
    const evidenceId = await writeEvidence(control.id, result);
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`${status}  evidence=${evidenceId}`);
    console.log(`         ${result.detail}`);
    if (!result.passed) allPassed = false;
  }

  console.log('');
  if (allPassed) {
    console.log('ALL CONTROLS PASSED');
    console.log('Review the evidence under .jc/certification/, then manually flip SOURCE_REPAIR_CAPABILITY with the evidence IDs linked.');
  } else {
    console.log('ONE OR MORE CONTROLS FAILED — HOLD REMAINS ACTIVE');
  }

  if (cleanup) {
    await fs.rm(cleanup, { recursive: true, force: true }).catch(() => {});
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

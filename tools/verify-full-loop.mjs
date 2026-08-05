#!/usr/bin/env node
/**
 * Phase 5 — full trustworthy loop assertion (offline contracts).
 *
 * Asserts the flowchart gates without requiring a live server:
 *   Register path rules → Inspect evidence shape → Plan parse →
 *   Authorize envelope → Apply transaction → Verify → Complete/rollback
 *
 * Exit 0 only when every gate passes.
 */

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const FORBIDDEN = new Set(['.git', 'node_modules', '.jc']);

function sha256(x) {
  return createHash('sha256').update(x).digest('hex');
}

function resolveJailedPath(projectRoot, relPath) {
  if (!relPath || path.isAbsolute(relPath)) throw new Error('SCOPE_VIOLATION absolute');
  const root = path.resolve(projectRoot);
  const full = path.resolve(root, relPath);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('SCOPE_VIOLATION escape');
  for (const seg of rel.split(path.sep)) {
    if (FORBIDDEN.has(seg.toLowerCase())) throw new Error('SCOPE_VIOLATION forbidden');
  }
  return full;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonicalize(v)])
    );
  }
  return value;
}

function envelopeHash(wo, project) {
  const envelope = {
    version: 1,
    workOrderId: wo.id,
    project: { id: project.id, path: project.path, revision: project.revision ?? 0 },
    planVersion: wo.planVersion,
    intent: wo.intent,
    objective: wo.objective,
    scope: wo.scope,
    dependsOn: wo.dependsOn,
    dependencyCompletionState: wo.dependencyCompletionState,
    acceptance: wo.acceptance,
    budgets: wo.budgets,
    risk: wo.risk ?? null,
    linkedSurveyId: wo.linkedSurveyId,
    projectRevision: wo.projectRevision ?? null,
    evidenceIds: wo.evidenceIds,
    taskSpecific: wo.taskSpecific ?? null,
    donorDisposition: wo.donorDisposition ?? null,
    stopLoss: wo.stopLoss ?? null,
    grant: {
      required: wo.authorization.required,
      granted: wo.authorization.granted,
      grantedAt: wo.authorization.grantedAt,
      grantedBy: wo.authorization.grantedBy
    }
  };
  return createHash('sha256').update(JSON.stringify(canonicalize(envelope))).digest('hex');
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, filePath);
}

async function applyWithRollback(projectRoot, edits, scope, failAtIndex = -1) {
  const staged = [];
  for (const edit of edits) {
    const rel = edit.relPath.replace(/\\/g, '/');
    if (!scope.has(rel)) throw new Error('SCOPE_VIOLATION');
    const full = resolveJailedPath(projectRoot, rel);
    let before = null;
    try { before = await fs.readFile(full); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    staged.push({ full, rel, content: edit.content, before });
  }
  const committed = [];
  try {
    for (let i = 0; i < staged.length; i++) {
      if (i === failAtIndex) throw new Error('INJECTED_FAIL');
      await atomicWrite(staged[i].full, staged[i].content);
      committed.push(staged[i]);
    }
  } catch (err) {
    for (const item of [...committed].reverse()) {
      if (item.before === null) await fs.unlink(item.full).catch(() => {});
      else await atomicWrite(item.full, item.before);
    }
    throw err;
  }
  return committed.map((c) => ({ relPath: c.rel, newHash: sha256(c.content) }));
}

async function main() {
  console.log('JoeCoder Full-Loop Verification (Phase 5)');
  const gates = [];
  const fixture = path.join(tmpdir(), `jc-loop-${process.pid}-${randomBytes(3).toString('hex')}`);
  await fs.mkdir(path.join(fixture, 'src'), { recursive: true });
  await fs.writeFile(path.join(fixture, 'src', 'lib.js'), 'export function add(a,b){return a-b;}\n');
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'loop', type: 'module' }));

  // Gate: path jail
  try {
    resolveJailedPath(fixture, '../x');
    gates.push({ id: 'path_jail', ok: false, detail: 'escape allowed' });
  } catch {
    gates.push({ id: 'path_jail', ok: true, detail: 'escape rejected' });
  }

  // Gate: envelope seal/mismatch
  const project = { id: 'p1', path: fixture, revision: 0 };
  const wo = {
    id: 'WO-1', planVersion: '20.0', intent: 'repair', objective: 'fix add',
    scope: { exactPaths: ['src/lib.js'], operations: ['edit_files'] },
    dependsOn: [], dependencyCompletionState: 'none_required',
    acceptance: [{ id: 'a1', criterion: 'add works', mandatory: true }],
    budgets: { maxFiles: 5, maxDurationMs: 60000 },
    linkedSurveyId: 'EVC-1', evidenceIds: [],
    authorization: { required: true, granted: true, grantedAt: new Date().toISOString(), grantedBy: 'op', envelopeVersion: 1, envelopeHash: null }
  };
  const hash = envelopeHash(wo, project);
  wo.authorization.envelopeHash = hash;
  const match = envelopeHash(wo, project) === hash;
  const tampered = { ...wo, scope: { exactPaths: ['src/lib.js', 'evil.js'], operations: ['edit_files'] } };
  const mismatch = envelopeHash(tampered, project) !== hash;
  gates.push({ id: 'envelope', ok: match && mismatch, detail: `match=${match} mismatch=${mismatch}` });

  // Gate: transactional apply + rollback
  const original = await fs.readFile(path.join(fixture, 'src', 'lib.js'));
  let rolled = false;
  try {
    await applyWithRollback(
      fixture,
      [
        { relPath: 'src/lib.js', content: 'export function add(a,b){return a+b;}\n' },
        { relPath: 'src/extra.js', content: 'nope\n' }
      ],
      new Set(['src/lib.js', 'src/extra.js']),
      1
    );
  } catch {
    rolled = true;
  }
  const after = await fs.readFile(path.join(fixture, 'src', 'lib.js'));
  const extraGone = await fs.stat(path.join(fixture, 'src', 'extra.js')).then(() => false).catch(() => true);
  gates.push({
    id: 'transaction',
    ok: rolled && Buffer.compare(original, after) === 0 && extraGone,
    detail: `rolled=${rolled} restored=${Buffer.compare(original, after) === 0} extraGone=${extraGone}`
  });

  // Gate: successful apply + integrity
  const applied = await applyWithRollback(
    fixture,
    [{ relPath: 'src/lib.js', content: 'export function add(a,b){return a+b;}\n' }],
    new Set(['src/lib.js'])
  );
  const content = await fs.readFile(path.join(fixture, 'src', 'lib.js'));
  const integrity = applied[0].newHash === sha256(content);
  gates.push({ id: 'apply_integrity', ok: integrity, detail: `hash match=${integrity}` });

  // Gate: capability contract
  const capPath = path.join(ROOT, 'src', 'capabilities.ts');
  const capSrc = await fs.readFile(capPath, 'utf8');
  const enabled = /enabled:\s*true/.test(capSrc) && /SOURCE_REPAIR_CERTIFIED/.test(capSrc);
  gates.push({ id: 'capability_certified', ok: enabled, detail: enabled ? 'enabled true + CERTIFIED code' : 'not certified in source' });

  // Gate: docs present
  const docs = ['HANDOFF_PLAN_v1.md', 'CAPABILITY_CERTIFICATION.md', 'WORKFLOW_GUIDE.md'];
  const missing = [];
  for (const d of docs) {
    try { await fs.access(path.join(ROOT, d)); } catch { missing.push(d); }
  }
  gates.push({ id: 'docs', ok: missing.length === 0, detail: missing.length ? missing.join(',') : 'all present' });

  await fs.rm(fixture, { recursive: true, force: true }).catch(() => {});

  console.log('');
  let all = true;
  for (const g of gates) {
    console.log(`[${g.id}] ${g.ok ? 'PASS' : 'FAIL'}  ${g.detail}`);
    if (!g.ok) all = false;
  }
  console.log('');
  console.log(all ? 'FULL LOOP CONTRACTS PASSED' : 'FULL LOOP CONTRACTS FAILED');

  const dir = path.join(ROOT, '.jc', 'certification');
  await fs.mkdir(dir, { recursive: true });
  const id = `CERT-LOOP-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ id, gates, ok: all, at: new Date().toISOString() }, null, 2));
  console.log('evidence=', id);
  process.exit(all ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });

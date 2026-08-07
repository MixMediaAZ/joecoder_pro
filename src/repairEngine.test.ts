import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyEdits,
  MutationTransactionError,
  countChangedLines,
  resolveJailedPath,
  rollbackToSnapshot,
  snapshotScopedFiles
} from './mutation.js';
import { BUILD_SYSTEM, changedLineBudgetForPlan, parseEditBlocks, parsePlanResponse, readScopedFiles, validatePlanForObjective } from './repair.js';
import { findVerificationRoots, runVerification } from './verification.js';
import { buildGuardedReply } from './chat.js';
import type { Project } from './types.js';

async function makeTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'jc-repair-test-'));
}

test('greenfield planning keeps new tests and requires separated runtime concerns', () => {
  const plan = validatePlanForObjective({
    schemaVersion: 1,
    files: ['package.json', 'server.js', 'test/workboard.test.js'],
    approach: 'Build and verify the app.',
    risks: []
  }, 'Build a durable workboard.', 'build');
  assert.deepEqual(plan.files, ['package.json', 'server.js', 'test/workboard.test.js']);
  assert.match(BUILD_SYSTEM, /do not collapse a multi-feature full-stack application into one source file/i);
  assert.match(BUILD_SYSTEM, /runnable test and build scripts/i);
});

test('substantial cross-layer objectives reject silently narrow plans', () => {
  assert.throws(() => validatePlanForObjective({
    schemaVersion: 1,
    files: ['server.js', 'public/app.js'],
    approach: 'Put everything in two files.',
    risks: []
  }, 'Build a polished UI and HTTP API with durable state after restart.', 'build'), /at least 8 necessary/i);
});

test('authorized changed-line budget scales for substantial plans and remains bounded', () => {
  assert.equal(changedLineBudgetForPlan(2), 800);
  assert.equal(changedLineBudgetForPlan(8), 2000);
  assert.equal(changedLineBudgetForPlan(20), 3000);
});

test('ordinary large source modules remain readable for governed repair', async () => {
  const root = await makeTempProject();
  const content = 'x'.repeat(140 * 1024);
  await fs.writeFile(path.join(root, 'control_panel.py'), content);
  const [file] = await readScopedFiles(root, ['control_panel.py']);
  assert.equal(file?.content.length, content.length);
  assert.equal(file?.truncated, false);
});

test('jailed paths reject escapes and protected directories', async () => {
  const root = await makeTempProject();
  assert.ok(resolveJailedPath(root, 'src/app.js'));
  assert.throws(() => resolveJailedPath(root, '../outside.txt'), /SCOPE_VIOLATION/);
  assert.throws(() => resolveJailedPath(root, 'C:\\Windows\\evil.txt'), /SCOPE_VIOLATION/);
  assert.throws(() => resolveJailedPath(root, 'node_modules/pkg/index.js'), /SCOPE_VIOLATION/);
  assert.throws(() => resolveJailedPath(root, '.git/config'), /SCOPE_VIOLATION/);
  assert.throws(() => resolveJailedPath(root, '.jc/evidence/x.json'), /SCOPE_VIOLATION/);
});

test('changed-line metric is deterministic and sane', () => {
  assert.equal(countChangedLines('a\nb\nc', 'a\nb\nc'), 0);
  assert.equal(countChangedLines('a\nb\nc', 'a\nX\nc'), 1);
  assert.equal(countChangedLines('a', 'a\nb\nc'), 2);
  assert.equal(countChangedLines('', 'x'), 1);
});

test('applyEdits enforces scope and budgets before writing anything', async () => {
  const root = await makeTempProject();
  await fs.writeFile(path.join(root, 'keep.js'), 'original\n');

  // Out-of-scope edit fails closed with no writes.
  await assert.rejects(
    applyEdits(root, [{ relPath: 'other.js', content: 'x\n' }], { scopeRelPaths: ['keep.js'], maxFiles: 5 }),
    /SCOPE_VIOLATION/
  );
  assert.equal(await fs.readFile(path.join(root, 'keep.js'), 'utf8'), 'original\n');

  // Changed-line budget fails closed with no writes.
  await assert.rejects(
    applyEdits(root, [{ relPath: 'keep.js', content: 'a\nb\nc\nd\ne\n' }], {
      scopeRelPaths: ['keep.js'],
      maxFiles: 5,
      maxChangedLines: 2
    }),
    /BUDGET_EXCEEDED/
  );
  assert.equal(await fs.readFile(path.join(root, 'keep.js'), 'utf8'), 'original\n');

  // A valid edit applies atomically and reports honest change records.
  const result = await applyEdits(root, [{ relPath: 'keep.js', content: 'changed\n' }], {
    scopeRelPaths: ['keep.js'],
    maxFiles: 5,
    maxChangedLines: 10
  });
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0]?.action, 'replaced_file');
  assert.equal(await fs.readFile(path.join(root, 'keep.js'), 'utf8'), 'changed\n');
});

test('snapshot and rollback restore the exact pre-apply state', async () => {
  const root = await makeTempProject();
  const snapshots = path.join(root, '_snaps');
  await fs.writeFile(path.join(root, 'a.js'), 'A-before\n');
  // b.js does not exist yet — the apply will create it.

  const manifest = await snapshotScopedFiles(root, ['a.js', 'b.js'], snapshots);
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.files.find((f) => f.relPath === 'b.js')?.existed, false);

  await applyEdits(root, [
    { relPath: 'a.js', content: 'A-after\n' },
    { relPath: 'b.js', content: 'B-created\n' }
  ], { scopeRelPaths: ['a.js', 'b.js'], maxFiles: 5 });
  assert.equal(await fs.readFile(path.join(root, 'a.js'), 'utf8'), 'A-after\n');

  const rollback = await rollbackToSnapshot(snapshots, manifest);
  assert.deepEqual(rollback.failures, []);
  assert.equal(await fs.readFile(path.join(root, 'a.js'), 'utf8'), 'A-before\n');
  await assert.rejects(fs.access(path.join(root, 'b.js')), /ENOENT/);
});

test('a later write failure restores every earlier commit before returning', async () => {
  const root = await makeTempProject();
  await fs.writeFile(path.join(root, 'a.txt'), 'A-before');
  await fs.writeFile(path.join(root, 'b.txt'), 'B-before');

  let failure: unknown;
  try {
    await applyEdits(root, [
      { relPath: 'a.txt', content: 'A-after' },
      { relPath: 'b.txt', content: 'B-after' }
    ], {
      scopeRelPaths: ['a.txt', 'b.txt'],
      maxFiles: 2,
      beforeWrite: (_relPath, index) => {
        if (index === 1) throw new Error('INJECTED_SECOND_WRITE_FAILURE');
      }
    });
  } catch (error: unknown) {
    failure = error;
  }

  assert.ok(failure instanceof MutationTransactionError);
  assert.equal(failure.code, 'MUTATION_COMMIT_FAILED_ROLLED_BACK');
  assert.equal(failure.recoveryComplete, true);
  assert.deepEqual(failure.committedPaths, ['a.txt']);
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'A-before');
  assert.equal(await fs.readFile(path.join(root, 'b.txt'), 'utf8'), 'B-before');
});

test('snapshot storage names cannot collide for nested and flattened paths', async () => {
  const root = await makeTempProject();
  const snapshots = path.join(root, '_snaps');
  await fs.mkdir(path.join(root, 'a'), { recursive: true });
  await fs.writeFile(path.join(root, 'a', 'b.txt'), 'nested-before');
  await fs.writeFile(path.join(root, 'a__b.txt'), 'flat-before');

  const manifest = await snapshotScopedFiles(root, ['a/b.txt', 'a__b.txt'], snapshots);
  const names = manifest.files.map((record) => record.snapshotFile);
  assert.equal(new Set(names).size, 2);
  assert.ok(names.every((name) => /^file-[a-f0-9]{64}\.bin$/.test(name || '')));

  await fs.writeFile(path.join(root, 'a', 'b.txt'), 'nested-after');
  await fs.writeFile(path.join(root, 'a__b.txt'), 'flat-after');
  const rollback = await rollbackToSnapshot(snapshots, manifest);

  assert.deepEqual(rollback.failures, []);
  assert.equal(await fs.readFile(path.join(root, 'a', 'b.txt'), 'utf8'), 'nested-before');
  assert.equal(await fs.readFile(path.join(root, 'a__b.txt'), 'utf8'), 'flat-before');
});

test('rollback reports missing snapshot data instead of claiming success', async () => {
  const root = await makeTempProject();
  const snapshots = path.join(root, '_snaps');
  await fs.writeFile(path.join(root, 'a.txt'), 'before');
  const manifest = await snapshotScopedFiles(root, ['a.txt'], snapshots);
  const record = manifest.files[0];
  assert.ok(record?.snapshotFile);

  await fs.writeFile(path.join(root, 'a.txt'), 'after');
  await fs.unlink(path.join(snapshots, manifest.snapshotId, record.snapshotFile));
  const rollback = await rollbackToSnapshot(snapshots, manifest);

  assert.equal(rollback.failures.length, 1);
  assert.equal(rollback.failures[0]?.relPath, 'a.txt');
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'after');

  const server = await fs.readFile(path.join(process.cwd(), 'src', 'index.ts'), 'utf8');
  assert.ok(server.includes("rollbackComplete ? 'rolled_back' : 'failed'"));
  assert.ok(server.includes("'ROLLBACK_INCOMPLETE'"));
});
test('plan parsing requires one strict versioned object and rejects unsafe paths', () => {
  const plan = parsePlanResponse('{"schemaVersion":1,"files":["src/x.js",".\\\\src\\\\y.js"],"approach":"fix","risks":["r1"]}');
  assert.deepEqual(plan.files, ['src/x.js', 'src/y.js']);
  assert.equal(plan.approach, 'fix');
  assert.equal(parsePlanResponse('{"schemaVersion":1,"files":["src/x.js"],"appro":"fix","risks":[]}').approach, 'fix');
  assert.throws(() => parsePlanResponse('no json here'), /PLAN_PARSE_FAILED/);
  assert.throws(() => parsePlanResponse('preamble {"schemaVersion":1,"files":["src/x.js"],"approach":"fix","risks":[]}'), /PLAN_PARSE_FAILED/);
  assert.throws(() => parsePlanResponse('{"schemaVersion":1,"files":[],"approach":"fix","risks":[]}'), /PLAN_PARSE_FAILED/);
  assert.throws(() => parsePlanResponse('{"schemaVersion":1,"files":["../etc/passwd"],"approach":"fix","risks":[]}'), /PLAN_REJECTED/);
  assert.throws(() => parsePlanResponse('{"schemaVersion":1,"files":["node_modules/x.js"],"approach":"fix","risks":[]}'), /PLAN_REJECTED/);
});

test('edit block parsing extracts complete files and fails closed otherwise', () => {
  const text = [
    '===FILE: src/app.js===',
    'const x = 1;',
    'console.log(x);',
    '===END FILE===',
    '===FILE: README.md===',
    '# Title',
    '===END FILE==='
  ].join('\n');
  const edits = parseEditBlocks(text);
  assert.equal(edits.length, 2);
  assert.equal(edits[0]?.relPath, 'src/app.js');
  assert.ok(edits[0]?.content.endsWith('\n'));
  assert.throws(() => parseEditBlocks('the model rambled with no blocks'), /EDIT_PARSE_FAILED/);
});

test('verification reports no_scripts honestly for script-less projects', async () => {
  const root = await makeTempProject();
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
  const report = await runVerification(root);
  assert.equal(report.status, 'no_scripts');
  const placeholder = { name: 't', version: '1.0.0', scripts: { test: 'echo "Error: no test specified" && exit 1' } };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(placeholder));
  const report2 = await runVerification(root);
  assert.equal(report2.status, 'no_scripts');
});

test('verification finds the nearest package root above edited files', async () => {
  const root = await makeTempProject();
  // No root package.json — the project is a folder of subprojects, like real targets.
  await fs.mkdir(path.join(root, 'apps', 'web', 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({
    name: 'web', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' }
  }));
  await fs.writeFile(path.join(root, 'apps', 'web', 'src', 'a.js'), 'x\n');

  const roots = await findVerificationRoots(root, ['apps/web/src/a.js']);
  assert.equal(roots.length, 1);
  assert.ok(roots[0]?.endsWith(path.join('apps', 'web')));

  const report = await runVerification(root, { editedRelPaths: ['apps/web/src/a.js'], timeoutMs: 60000 });
  assert.equal(report.status, 'passed');
  assert.equal(report.items[0]?.root, 'apps/web');
});

test('chat treats "write work order" as a drafting request, not fluff', () => {
  const project: Project = {
    id: 'proj-x', name: 'X', path: 'C:/x', createdAt: 0,
    workflowStage: 'project_accepted', buildCondition: 'partly_working',
    latestSurveyId: 'EVC-1-aaaaaaaa'
  };
  const reply = buildGuardedReply('write work order', project, []);
  assert.equal(reply.branch, 'draft');
  assert.equal(reply.suggestions?.[0]?.id, 'draft_work_order');
  assert.match(reply.content, /Draft Repair Work Order|Draft Read-Only|drafting never authorizes|source repair.*safety|temporarily unavailable/i);
  assert.ok(['Open the draft box','Draft read-only handoff','Draft Repair Work Order'].includes(reply.suggestions?.[0]?.label || ''));

  const noSurvey = buildGuardedReply('create a work order please', { ...project, workflowStage: 'folder_selected', latestSurveyId: undefined } as unknown as Project, []);
  assert.equal(noSurvey.branch, 'draft');
  assert.equal(noSurvey.suggestions?.[0]?.id, 'inspect');

  // Open conversation still falls through (model prose allowed there).
  const open = buildGuardedReply('how does this project handle logins?', project, []);
  assert.equal(open.branch, 'open');
});

test('verification actually runs a real script and captures failure', async () => {
  const root = await makeTempProject();
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 't', version: '1.0.0',
    scripts: { test: 'node -e "process.exit(0)"' }
  }));
  const pass = await runVerification(root, { timeoutMs: 60000 });
  assert.equal(pass.status, 'passed');

  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 't', version: '1.0.0',
    scripts: { test: 'node -e "console.error(\'boom\'); process.exit(1)"' }
  }));
  const fail = await runVerification(root, { timeoutMs: 60000 });
  assert.equal(fail.status, 'failed');
  assert.equal(fail.items[0]?.exitCode, 1);
});

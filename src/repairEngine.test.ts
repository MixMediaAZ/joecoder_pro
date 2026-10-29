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
import {
  BUILD_SYSTEM,
  buildPlanRecoveryContext,
  changedLineBudgetForPlan,
  buildRepairGenerationBatches,
  isEvidenceTargetAlreadySatisfied,
  keepAssignedEditBlocksOnly,
  MAX_ARCHITECTURE_CONTRACTS,
  parseEditBlocks,
  parseEditResponse,
  parsePlanResponse,
  PLAN_SYSTEM,
  readScopedFiles,
  rejectProtectedPackageScriptEdits,
  requireEvidenceTargetEdits,
  requireSubstantialEdits,
  selectSealedConfigurationPaths,
  validatePlanForObjective
} from './repair.js';
import type { SurveyResult } from './types.js';
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

test('substantial objectives accept narrow-but-real plans and reject implementation-free plans', () => {
  // Breadth theater removed: a plan is judged by having genuine implementation
  // targets, not by hitting a manufactured file-count threshold.
  assert.doesNotThrow(() => validatePlanForObjective({
    schemaVersion: 1,
    files: ['server.js', 'public/app.js'],
    approach: 'Put everything in two files.',
    risks: []
  }, 'Build a polished UI and HTTP API with durable state after restart.', 'build'));
  assert.throws(() => validatePlanForObjective({
    schemaVersion: 1,
    files: ['package.json'],
    approach: 'Only touch runtime configuration.',
    risks: []
  }, 'Build a polished UI and HTTP API with durable state after restart.', 'build'), /no implementation files/i);
});

test('runnable repair plans include verified runtime configuration before authorization', () => {
  const plan = validatePlanForObjective({
    schemaVersion: 1,
    files: [
      'server/index.ts', 'server/routes.ts', 'client/App.tsx', 'client/api.ts',
      'client/styles.css', 'storage/store.ts', 'storage/schema.ts', 'shared/types.ts'
    ],
    approach: 'Restore the application.',
    risks: []
  }, 'Make the application run locally end to end.', 'repair', {
    entries: [
      { type: 'file', path: 'package.json' },
      { type: 'file', path: 'postcss.config.js' }
    ]
  } as any);
  assert.ok(plan.files.includes('package.json'));
  assert.ok(plan.files.includes('postcss.config.js'));
  assert.equal(plan.files.length, 10);
});

test('operational config reservation prefers PostCSS over Vite when both exist', () => {
  const plan = validatePlanForObjective({
    schemaVersion: 1,
    files: [
      'server/index.ts', 'server/routes.ts', 'client/App.tsx', 'client/api.ts',
      'client/styles.css', 'storage/store.ts', 'storage/schema.ts', 'shared/types.ts',
      'vite.config.ts', 'tsconfig.json'
    ],
    approach: 'Restore the application.',
    risks: []
  }, 'Make the application run locally end to end.', 'repair', {
    entries: [
      { type: 'file', path: 'package.json' },
      { type: 'file', path: 'vite.config.ts' },
      { type: 'file', path: 'postcss.config.js' },
      { type: 'file', path: 'tsconfig.json' }
    ],
    packageSummary: { name: 'app', version: '1.0.0', dependenciesCount: 2, devDependenciesCount: 1 }
  } as any);
  assert.ok(plan.files.includes('package.json'));
  assert.ok(plan.files.includes('postcss.config.js'));
  assert.equal(plan.files.includes('vite.config.ts'), false);
  assert.equal(plan.files.includes('tsconfig.json'), false);
});

test('causal evidence repairs accept small plans and skip the eight-file write gate', () => {
  const plan = validatePlanForObjective({
    schemaVersion: 1,
    files: ['server/index.ts', 'client/App.tsx'],
    approach: 'Fix the recorded CSS toolchain break.',
    risks: []
  }, 'Make InspectorCode run locally end to end so a user can upload a ZIP project, analyze its real files, see useful results, and still find that project after a restart.', 'repair', {
    entries: [
      { type: 'file', path: 'package.json' },
      { type: 'file', path: 'package-lock.json' },
      { type: 'file', path: 'postcss.config.js' },
      { type: 'file', path: 'server/index.ts' },
      { type: 'file', path: 'client/App.tsx' }
    ],
    dependencyTargets: ['package.json', 'postcss.config.js'],
    packageSummary: { name: 'app', version: '1.0.0', dependenciesCount: 10, devDependenciesCount: 5, scripts: ['build'] }
  } as any);
  assert.ok(plan.files.includes('package.json'));
  assert.ok(plan.files.includes('postcss.config.js'));
  assert.ok(plan.files.length < 10);

  const edits = requireSubstantialEdits([
    { relPath: 'package.json', content: '{"name":"app"}\n' },
    { relPath: 'postcss.config.js', content: 'export default {};\n' }
  ], 'Make InspectorCode run locally end to end so a user can upload a ZIP project, analyze its real files, see useful results, and still find that project after a restart.', {
    evidenceTargets: ['package.json', 'postcss.config.js']
  });
  assert.equal(edits.length, 2);
});

test('already-correct PostCSS evidence target need not be rewritten', () => {
  const postcss = {
    relPath: 'postcss.config.js',
    absPath: 'postcss.config.js',
    exists: true,
    content: 'export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n',
    sha256: 'x',
    bytes: 80,
    truncated: false
  };
  assert.equal(isEvidenceTargetAlreadySatisfied(postcss), true);
  const edits = requireEvidenceTargetEdits(
    [{ relPath: 'package.json', content: '{"dependencies":{"tailwindcss":"^3.4.1"}}\n' }],
    ['package.json', 'postcss.config.js'],
    { scopedFiles: [postcss] }
  );
  assert.equal(edits.length, 1);
  assert.throws(
    () => requireEvidenceTargetEdits(
      [{ relPath: 'package.json', content: '{"dependencies":{"tailwindcss":"^3.4.1"}}\n' }],
      ['package.json', 'postcss.config.js'],
      { scopedFiles: [{ ...postcss, content: 'export default { plugins: {} };\n' }] }
    ),
    /missing: postcss\.config\.js/
  );
});

test('CSS toolchain package.json edits may change deps but not scripts', () => {
  const before = {
    name: 'app',
    scripts: {
      build: 'vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist'
    },
    dependencies: { tailwindcss: '^4.1.12', '@tailwindcss/vite': '^4.1.8' }
  };
  const files = [{
    relPath: 'package.json',
    absPath: 'package.json',
    exists: true,
    content: `${JSON.stringify(before, null, 2)}\n`,
    sha256: 'x',
    bytes: 100,
    truncated: false
  }];
  const ok = rejectProtectedPackageScriptEdits([{
    relPath: 'package.json',
    content: `${JSON.stringify({
      ...before,
      dependencies: { tailwindcss: '^3.4.17' }
    }, null, 2)}\n`
  }], files, ['package.json', 'postcss.config.js']);
  assert.equal(ok.length, 1);

  // G2t: script theater is stripped; deps pin kept; prior scripts restored.
  const restored = rejectProtectedPackageScriptEdits([{
    relPath: 'package.json',
    content: `${JSON.stringify({
      ...before,
      scripts: {
        build: 'vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=cjs --outdir=dist --external:drizzle-orm'
      },
      dependencies: { tailwindcss: '^3.4.17' }
    }, null, 2)}\n`
  }], files, ['package.json', 'postcss.config.js']);
  assert.equal(restored.length, 1);
  const restoredPkg = JSON.parse(restored[0]!.content) as typeof before;
  assert.deepEqual(restoredPkg.scripts, before.scripts);
  assert.equal(restoredPkg.dependencies.tailwindcss, '^3.4.17');

  // After CSS is already pinned, pure esm↔cjs theater becomes a dropped no-op.
  const pinned = {
    ...before,
    dependencies: { tailwindcss: '^3.4.17' }
  };
  const pinnedFiles = [{
    ...files[0]!,
    content: `${JSON.stringify(pinned, null, 2)}\n`
  }];
  const theaterOnly = rejectProtectedPackageScriptEdits([{
    relPath: 'package.json',
    content: `${JSON.stringify({
      ...pinned,
      scripts: {
        build: 'tsc && esbuild server/index.ts --platform=node --packages=external --bundle --format=cjs --outdir=dist'
      }
    }, null, 2)}\n`
  }], pinnedFiles, ['package.json', 'postcss.config.js']);
  assert.deepEqual(theaterOnly, []);

  assert.throws(() => rejectProtectedPackageScriptEdits([{
    relPath: 'package.json',
    content: `${JSON.stringify({
      ...before,
      dependencies: { tailwindcss: '^4.1.13', '@tailwindcss/vite': '^4.1.8' }
    }, null, 2)}\n`
  }], files, ['package.json', 'postcss.config.js']), /EDIT_CSS_TOOLCHAIN_INCOMPLETE/);
});

test('CSS script restore keeps sibling server edits in the same batch', () => {
  const before = {
    name: 'app',
    scripts: {
      build: 'vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist',
      dev: 'NODE_ENV=development tsx server/index.ts'
    },
    dependencies: { tailwindcss: '^3.4.17', express: '^5.0.0' }
  };
  const files = [
    {
      relPath: 'package.json',
      absPath: 'package.json',
      exists: true,
      content: `${JSON.stringify(before, null, 2)}\n`,
      sha256: 'x',
      bytes: 100,
      truncated: false
    },
    {
      relPath: 'server/index.ts',
      absPath: 'server/index.ts',
      exists: true,
      content: 'import express from \'express\';\nconst app = express();\n',
      sha256: 'y',
      bytes: 50,
      truncated: false
    }
  ];
  const kept = rejectProtectedPackageScriptEdits([
    {
      relPath: 'package.json',
      content: `${JSON.stringify({
        ...before,
        scripts: {
          ...before.scripts,
          build: 'tsc && esbuild server/index.ts --platform=node --packages=external --bundle --format=cjs --outdir=dist'
        }
      }, null, 2)}\n`
    },
    {
      relPath: 'server/index.ts',
      content: 'import express from \'express\';\nconst app = express();\napp.get(\'/api/health\', (_req, res) => res.json({ status: \'ok\' }));\n'
    }
  ], files, ['package.json', 'postcss.config.js']);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.relPath, 'server/index.ts');
  assert.match(kept[0]!.content, /\/api\/health/);
});

test('causal evidence generation puts evidence targets alone in the first batch', () => {
  const files = [
    'package.json',
    'postcss.config.js',
    'tailwind.config.ts',
    'client/src/lib/codeAnalysis.ts',
    'client/src/hooks/useFileUpload.ts',
    'client/src/pages/Dashboard.tsx',
    'server/index.ts'
  ].map((relPath) => ({
    relPath,
    absPath: relPath,
    exists: true,
    content: `${relPath}\n`,
    sha256: 'x',
    bytes: 8,
    truncated: false
  }));
  const batches = buildRepairGenerationBatches(files, ['package.json', 'postcss.config.js'], {
    causalEvidence: true,
    substantialObjective: true
  });
  assert.deepEqual(batches[0]?.map((file) => file.relPath), ['package.json']);
  assert.deepEqual(batches[1]?.map((file) => file.relPath), ['postcss.config.js']);
  assert.equal(batches.length >= 3, true);
  assert.equal(batches.flat().length, files.length);

  const satisfiedPostcss = files.map((file) => file.relPath === 'postcss.config.js'
    ? {
        ...file,
        content: 'export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n'
      }
    : file);
  const trimmed = buildRepairGenerationBatches(satisfiedPostcss, ['package.json', 'postcss.config.js'], {
    causalEvidence: true,
    substantialObjective: true
  });
  assert.deepEqual(trimmed[0]?.map((file) => file.relPath), ['package.json']);
  assert.equal(trimmed.some((batch) => batch.some((file) => file.relPath === 'postcss.config.js')), false);
});

test('G2v: bounded parse keeps assigned package.json patch and drops truncated sibling FILE', () => {
  const pkg = {
    relPath: 'package.json',
    absPath: 'package.json',
    exists: true,
    content: '{\n  "dependencies": {\n    "tailwindcss": "^4.1.8"\n  }\n}\n',
    sha256: 'x',
    bytes: 60,
    truncated: false
  };
  const noisy = [
    '<think>',
    'Draft ===FILE: server/index.ts===',
    'import express from \'express\';',
    // incomplete draft inside thinking
    '</think>',
    '===PATCH: package.json===',
    '===SEARCH===',
    '    "tailwindcss": "^4.1.8"',
    '===REPLACE===',
    '    "tailwindcss": "^3.4.1"',
    '===END PATCH===',
    '',
    '===FILE: server/index.ts===',
    'import express from \'express\';',
    'const app = express();',
    '// truncated — no END FILE'
  ].join('\n');
  const kept = keepAssignedEditBlocksOnly(noisy, ['package.json']);
  assert.match(kept, /===PATCH: package\.json===/);
  assert.equal(kept.includes('server/index.ts'), false);
  const edits = parseEditResponse(kept, [pkg]);
  assert.equal(edits.length, 1);
  assert.equal(edits[0]?.relPath, 'package.json');
  assert.match(edits[0]!.content, /\^3\.4\.1/);
});

test('G2v: missing entry evidence targets get their own batch after package.json', () => {
  const files = [
    {
      relPath: 'package.json',
      absPath: 'package.json',
      exists: true,
      content: '{"dependencies":{"tailwindcss":"^4.1.8"}}\n',
      sha256: 'x',
      bytes: 40,
      truncated: false
    },
    {
      relPath: 'postcss.config.js',
      absPath: 'postcss.config.js',
      exists: true,
      content: 'export default { plugins: {} };\n',
      sha256: 'y',
      bytes: 32,
      truncated: false
    },
    {
      relPath: 'server/index.ts',
      absPath: 'server/index.ts',
      exists: false,
      content: '',
      sha256: '',
      bytes: 0,
      truncated: false
    }
  ];
  const batches = buildRepairGenerationBatches(
    files,
    ['package.json', 'postcss.config.js', 'server/index.ts'],
    { causalEvidence: true, substantialObjective: false }
  );
  assert.deepEqual(batches.map((batch) => batch.map((file) => file.relPath)), [
    ['package.json'],
    ['server/index.ts'],
    ['postcss.config.js']
  ]);
});

test('G2ag: sealed operational batches keep only evidence + server entry', () => {
  const files = [
    'package.json',
    'postcss.config.js',
    'tailwind.config.ts',
    'vite.config.ts',
    'client/src/pages/Dashboard.tsx',
    'server/index.ts'
  ].map((relPath) => ({
    relPath,
    absPath: relPath,
    exists: true,
    content: relPath === 'postcss.config.js'
      ? 'export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n'
      : `${relPath}\n`,
    sha256: 'x',
    bytes: 8,
    truncated: false
  }));
  const batches = buildRepairGenerationBatches(files, ['package.json', 'postcss.config.js'], {
    causalEvidence: true,
    substantialObjective: true,
    sealedOperationalApi: true
  });
  assert.deepEqual(batches.map((batch) => batch.map((file) => file.relPath)), [
    ['package.json'],
    ['server/index.ts']
  ]);
});

test('causal seal includes lockfile and evidence targets without dropping PostCSS for Vite', () => {
  const sealed = selectSealedConfigurationPaths({
    inventory: new Set([
      'package.json', 'package-lock.json', 'postcss.config.js', 'vite.config.ts', 'tsconfig.json'
    ]),
    evidenceTargets: ['package.json', 'postcss.config.js'],
    installAuthorized: true
  });
  assert.deepEqual(sealed, ['package.json', 'postcss.config.js', 'package-lock.json']);

  const plan = validatePlanForObjective({
    schemaVersion: 1,
    files: [
      'server/index.ts', 'client/App.tsx', 'vite.config.ts', 'tsconfig.json'
    ],
    approach: 'Fix the recorded CSS toolchain break.',
    risks: []
  }, 'Make the application run locally end to end.', 'repair', {
    entries: [
      { type: 'file', path: 'package.json' },
      { type: 'file', path: 'package-lock.json' },
      { type: 'file', path: 'postcss.config.js' },
      { type: 'file', path: 'vite.config.ts' },
      { type: 'file', path: 'tsconfig.json' },
      { type: 'file', path: 'server/index.ts' },
      { type: 'file', path: 'client/App.tsx' }
    ],
    dependencyTargets: ['package.json', 'postcss.config.js'],
    packageSummary: { name: 'app', version: '1.0.0', dependenciesCount: 10, devDependenciesCount: 5 }
  } as any);
  assert.ok(plan.files.includes('package.json'));
  assert.ok(plan.files.includes('package-lock.json'));
  assert.ok(plan.files.includes('postcss.config.js'));
  assert.equal(plan.files.includes('vite.config.ts'), false);
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

test('architecture.contracts accepts operational upload/API plans up to the raised bound', () => {
  assert.equal(MAX_ARCHITECTURE_CONTRACTS, 24);
  assert.match(PLAN_SYSTEM, new RegExp(`architecture\\.contracts must be 1-${MAX_ARCHITECTURE_CONTRACTS}`));

  const makePlan = (count: number): string => {
    const contracts = Array.from({ length: count }, (_, index) => `API contract ${index + 1}: exact route handler`);
    return JSON.stringify({
      schemaVersion: 1,
      files: ['server/index.ts'],
      approach: 'Implement sealed client API routes with durable upload persistence.',
      risks: ['incomplete route coverage'],
      architecture: {
        summary: 'Shared server design for upload, analysis, and persistence under env DATA_DIR.',
        contracts,
        persistence: 'Extract ZIP under process.env.DATA_DIR and return projectId'
      }
    });
  };

  // G2q failure mode: more than the old max of 10 must parse for operational API plans.
  const eleven = parsePlanResponse(makePlan(11));
  assert.equal(eleven.architecture?.contracts.length, 11);

  const atBound = parsePlanResponse(makePlan(MAX_ARCHITECTURE_CONTRACTS));
  assert.equal(atBound.architecture?.contracts.length, MAX_ARCHITECTURE_CONTRACTS);

  assert.throws(
    () => parsePlanResponse(makePlan(MAX_ARCHITECTURE_CONTRACTS + 1)),
    /PLAN_PARSE_FAILED[\s\S]*architecture[\s\S]*contracts|too_big/
  );

  const survey: SurveyResult = {
    requestedPath: 'C:/fixture',
    projectName: 'fixture',
    generatedAt: new Date(0).toISOString(),
    projectType: 'node',
    stackProfiles: [],
    keyFiles: ['package.json'],
    packageSummary: null,
    summary: { totalFiles: 1, totalDirectories: 0, totalSizeBytes: 10, maxDepthReached: 1 },
    entries: [{ path: 'package.json', type: 'file', size: 10 }],
    languages: { '.json': 1 },
    observations: [],
    unknowns: [],
    findings: { working: [], questionable: [], broken: [], mockOrPlaceholder: [], unknown: [] },
    buildCondition: 'partly_working',
    status: 'complete'
  };
  const recovery = buildPlanRecoveryContext('upload and analyze projects', survey);
  assert.match(recovery, new RegExp(`architecture\\.contracts[\\s\\S]*≤${MAX_ARCHITECTURE_CONTRACTS}`));
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

test('G2u: parse ignores narration around well-formed blocks; incomplete markers still fail', () => {
  const scoped = [
    { relPath: 'package.json', exists: true, content: '{\n  "devDependencies": {\n    "tailwindcss": "^4.1.8"\n  }\n}\n', truncated: false },
    { relPath: 'server/index.ts', exists: false, content: '', truncated: false }
  ];
  const withProse = parseEditResponse([
    'I will pin Tailwind and create the server entry.',
    '===PATCH: package.json===',
    '===SEARCH===',
    '    "tailwindcss": "^4.1.8"',
    '===REPLACE===',
    '    "tailwindcss": "^3.4.1"',
    '===END PATCH===',
    '',
    'Next the server file:',
    '===FILE: server/index.ts===',
    'export {};',
    '===END FILE===',
    'Done.'
  ].join('\n'), scoped);
  assert.equal(withProse.find((edit) => edit.relPath === 'package.json')?.content.includes('"^3.4.1"'), true);
  assert.equal(withProse.find((edit) => edit.relPath === 'server/index.ts')?.content, 'export {};\n');

  assert.throws(() => parseEditResponse([
    '===PATCH: package.json===',
    '===SEARCH===',
    '    "tailwindcss": "^4.1.8"',
    '===REPLACE===',
    '    "tailwindcss": "^3.4.1"',
    '===END PATCH===',
    '===FILE: server/index.ts===',
    'export {};'
    // missing ===END FILE===
  ].join('\n'), scoped), /incomplete or malformed patch blocks/);

  assert.throws(() => parseEditBlocks([
    'Here is the file:',
    '===FILE: src/app.js===',
    'const x = 1;',
    // missing ===END FILE===
  ].join('\n')), /no well-formed file blocks|incomplete or malformed/);
});

test('exact patch transport updates large files and can create a separate scoped file', () => {
  const largePrefix = 'x'.repeat(49 * 1024);
  const edits = parseEditResponse([
    '===PATCH: src/large.js===',
    '===SEARCH===',
    'const enabled = false;',
    '===REPLACE===',
    'const enabled = true;',
    '===END PATCH===',
    '===FILE: src/new.js===',
    'export const ready = true;',
    '===END FILE==='
  ].join('\n'), [
    { relPath: 'src/large.js', exists: true, content: `${largePrefix}\nheader\nconst enabled = false;\nfooter\n`, truncated: false },
    { relPath: 'src/new.js', exists: false, content: '', truncated: false }
  ]);
  assert.equal(edits.find((edit) => edit.relPath === 'src/large.js')?.content, `${largePrefix}\nheader\nconst enabled = true;\nfooter\n`);
  assert.equal(edits.find((edit) => edit.relPath === 'src/new.js')?.content, 'export const ready = true;\n');
  assert.throws(() => parseEditResponse([
    '===PATCH: src/large.js===',
    '===SEARCH===',
    'repeat',
    '===REPLACE===',
    'changed',
    '===END PATCH==='
  ].join('\n'), [
    { relPath: 'src/large.js', exists: true, content: `${largePrefix}repeat repeat`, truncated: false }
  ]), /not unique/i);
});

test('parseEditResponse tolerates trailing-space / CRLF drift in SEARCH (G2ac)', () => {
  const edits = parseEditResponse([
    '===PATCH: package.json===',
    '===SEARCH===',
    '  "name": "rest-express",  ',
    '  "version": "1.0.0",',
    '===REPLACE===',
    '  "name": "rest-express",',
    '  "version": "1.0.1",',
    '===END PATCH==='
  ].join('\n'), [
    {
      relPath: 'package.json',
      exists: true,
      content: '{\r\n  "name": "rest-express",\r\n  "version": "1.0.0",\r\n  "type": "module"\r\n}\r\n',
      truncated: false
    }
  ]);
  assert.match(edits[0]?.content || '', /"version": "1\.0\.1"/);
});

test('parseEditResponse applies multiple sequential patches to the same file', () => {
  const edits = parseEditResponse([
    '===PATCH: server/index.ts===',
    '===SEARCH===',
    'const a = 1;',
    '===REPLACE===',
    'const a = 2;',
    '===END PATCH===',
    '===PATCH: server/index.ts===',
    '===SEARCH===',
    'const b = 1;',
    '===REPLACE===',
    'const b = 2;',
    '===END PATCH==='
  ].join('\n'), [
    { relPath: 'server/index.ts', exists: true, content: 'const a = 1;\nconst b = 1;\n', truncated: false }
  ]);
  assert.equal(edits.length, 1);
  assert.equal(edits[0]?.relPath, 'server/index.ts');
  assert.equal(edits[0]?.content, 'const a = 2;\nconst b = 2;\n');
});

test('parseEditResponse rejects paths outside the sealed scope (G2k server/db.ts)', () => {
  const scoped = [
    { relPath: 'server/index.ts', exists: true, content: 'export {}\n', truncated: false },
    { relPath: 'package.json', exists: true, content: '{}\n', truncated: false }
  ];
  assert.throws(() => parseEditResponse([
    '===PATCH: server/db.ts===',
    '===SEARCH===',
    'x',
    '===REPLACE===',
    'y',
    '===END PATCH==='
  ].join('\n'), scoped), /EDIT_SCOPE_REJECTED: 'server\/db\.ts'/);
  assert.throws(() => parseEditResponse([
    '===FILE: server/db.ts===',
    'export const db = null;',
    '===END FILE==='
  ].join('\n'), scoped), /EDIT_SCOPE_REJECTED: 'server\/db\.ts'/);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePlanArchitectureSummary,
  parsePlanResponse,
  sanitizeArchitectureContracts,
  validatePlanForObjective,
  type RepairPlan
} from './repair.js';
import type { SurveyResult } from './types.js';

const plan = (files: string[]): RepairPlan => ({ schemaVersion: 1, files, approach: 'bounded repair', risks: [] });

test('short architecture.summary from small local models expands before plan schema parse (G2aa)', () => {
  const decoded: Record<string, unknown> = {
    schemaVersion: 1,
    files: ['server/index.ts'],
    approach: 'Wire upload, analysis, and DATA_DIR persistence end to end.',
    risks: ['scope'],
    architecture: {
      summary: 'shared design',
      contracts: ['POST /api/projects/upload accepts multipart ZIP'],
      persistence: 'JSON under DATA_DIR'
    }
  };
  normalizePlanArchitectureSummary(decoded);
  const summary = (decoded.architecture as { summary: string }).summary;
  assert.ok(summary.length >= 20);
  assert.match(summary, /shared design/i);

  const parsed = parsePlanResponse(JSON.stringify({
    schemaVersion: 1,
    files: ['server/index.ts'],
    approach: 'Wire upload analysis restart.',
    risks: ['risk'],
    fileResponsibilities: [{
      path: 'server/index.ts',
      responsibility: 'Owns upload and analysis HTTP routes',
      evidence: 'server/index.ts hosts Express routes today',
      layer: 'service'
    }],
    architecture: {
      summary: 'shared design',
      contracts: ['POST /api/projects/upload accepts multipart ZIP'],
      persistence: 'JSON under DATA_DIR'
    }
  }));
  assert.ok((parsed.architecture?.summary || '').length >= 20);
});

test('sanitizes plan architecture that teaches bare analysis routes or simulation (G2w)', () => {
  const cleaned = sanitizeArchitectureContracts({
    summary: 'Express server with analysis simulation',
    contracts: [
      'POST /api/analysis/start -> { projectId }',
      'GET /api/analysis -> findings',
      'POST /api/projects/save -> ok'
    ],
    persistence: 'JSON files on disk'
  });
  assert.match(cleaned.summary, /real uploaded files under DATA_DIR/i);
  assert.ok(cleaned.contracts.every((item) => !/POST \/api\/analysis\/start(?!\/:)/.test(item)));
  assert.ok(cleaned.contracts.some((item) => /analysis\/start\/:projectId/.test(item)));
  assert.ok(cleaned.contracts.some((item) => /GET \/api\/analysis\/:projectId/.test(item)));
  assert.match(cleaned.persistence, /DATA_DIR/);
});

test('explicit composed multi-file objective rejects an incomplete one-file plan before authorization', () => {
  assert.throws(
    () => validatePlanForObjective(plan(['src/math.mjs']), 'Trace the composed interacting multi-file defect.', 'repair'),
    /traces only one implementation file/
  );
  assert.deepEqual(
    validatePlanForObjective(plan(['src/math.mjs', 'src/label.mjs']), 'Trace the composed interacting multi-file defect.', 'repair').files,
    ['src/math.mjs', 'src/label.mjs']
  );
});

test('test files remain acceptance contracts unless the objective explicitly changes tests', () => {
  assert.deepEqual(
    validatePlanForObjective(plan(['src/api.mjs', 'test/api.test.mjs']), 'Repair the API so its tests pass.', 'repair').files,
    ['src/api.mjs']
  );
  assert.doesNotThrow(
    () => validatePlanForObjective(plan(['test/api.test.mjs']), 'Update the API test to cover a new contract.', 'repair')
  );
});

test('greenfield planning is not forced into a multi-file repair heuristic', () => {
  assert.doesNotThrow(() => validatePlanForObjective(plan(['index.html']), 'Build a composed single-page demo.', 'build'));
});
test('explicit multi-file repair may complete scope only from evidence-ranked implementation samples', () => {
  const survey = {
    projectType: 'node', keyFiles: ['package.json'], packageSummary: null,
    summary: { totalFiles: 4, totalDirectories: 2, totalSizeBytes: 100, maxDepthReached: 2 },
    entries: [
      { path: 'src/math.mjs', type: 'file' },
      { path: 'src/label.mjs', type: 'file' },
      { path: 'test/app.test.mjs', type: 'file' },
      { path: 'package.json', type: 'file' }
    ],
    contentSamples: [
      { path: 'src/math.mjs', bytes: 10, truncated: false, content: 'add(a,b)' },
      { path: 'src/label.mjs', bytes: 10, truncated: false, content: 'composed total label' },
      { path: 'test/app.test.mjs', bytes: 10, truncated: false, content: 'composed total test' }
    ],
    stackProfiles: [], languages: {}, observations: [], unknowns: [],
    findings: { working: [], questionable: [], broken: [], mockOrPlaceholder: [], unknown: [] },
    buildCondition: 'partly_working', status: 'complete', projectName: 'fixture', generatedAt: new Date().toISOString()
  } as unknown as SurveyResult;
  assert.deepEqual(
    validatePlanForObjective(plan(['src/math.mjs', 'test/app.test.mjs']), 'Repair the composed interacting multi-file total label behavior.', 'repair', survey).files,
    ['src/math.mjs', 'src/label.mjs']
  );
});
test('combined accessibility and responsive repair includes evidence-backed markup and stylesheet scope', () => {
  const survey = {
    projectType: 'static', keyFiles: ['index.html'], packageSummary: null,
    summary: { totalFiles: 4, totalDirectories: 1, totalSizeBytes: 100, maxDepthReached: 1 },
    entries: [
      { path: 'index.html', type: 'file' },
      { path: 'style.css', type: 'file' },
      { path: 'test/browser.test.mjs', type: 'file' },
      { path: 'package.json', type: 'file' }
    ],
    contentSamples: [
      { path: 'index.html', bytes: 20, truncated: false, content: '<main><input></main>' },
      { path: 'style.css', bytes: 20, truncated: false, content: 'main{width:1200px}' }
    ],
    stackProfiles: [], languages: {}, observations: [], unknowns: [],
    findings: { working: [], questionable: [], broken: [], mockOrPlaceholder: [], unknown: [] },
    buildCondition: 'partly_working', status: 'complete', projectName: 'fixture', generatedAt: new Date(0).toISOString()
  } as unknown as SurveyResult;
  assert.deepEqual(
    validatePlanForObjective(plan(['index.html']), 'Fix accessibility and horizontal overflow on phone and desktop.', 'repair', survey).files,
    ['index.html', 'style.css']
  );
  assert.deepEqual(
    validatePlanForObjective(plan(['style.css']), 'Make the page accessible and responsive.', 'repair', survey).files,
    ['style.css', 'index.html']
  );
});
test('toolchain build outputs are stripped from repair plans (G2v dist/index.js)', () => {
  const survey = {
    dependencyTargets: ['package.json', 'server/index.ts'],
    entries: [
      { type: 'file', path: 'package.json' },
      { type: 'file', path: 'client/src/index.css' }
    ],
    packageSummary: { name: 'rest-express', scripts: { start: 'node dist/index.js', build: 'esbuild server/index.ts --outdir=dist' } }
  } as unknown as SurveyResult;
  const validated = validatePlanForObjective(
    plan(['package.json', 'dist/index.js', 'server/index.ts']),
    'Make InspectorCode run locally end to end so a user can upload a ZIP project.',
    'repair',
    survey
  );
  assert.equal(validated.files.includes('dist/index.js'), false, `scope=${validated.files.join(',')}`);
  assert.ok(validated.files.includes('server/index.ts'), `scope=${validated.files.join(',')}`);
});

test('missing script entrypoint evidence is sealed even when absent from inventory (G2l)', () => {
  const survey = {
    dependencyTargets: ['package.json', 'postcss.config.js', 'server/index.ts'],
    entries: [
      { type: 'file', path: 'package.json' },
      { type: 'file', path: 'postcss.config.js' },
      { type: 'file', path: 'client/src/index.css' }
    ],
    packageSummary: { name: 'rest-express', scripts: { build: 'esbuild server/index.ts' } }
  } as unknown as SurveyResult;
  const validated = validatePlanForObjective(
    plan(['package.json', 'postcss.config.js']),
    'Make InspectorCode run locally end to end so a user can upload a ZIP project and see useful results.',
    'repair',
    survey
  );
  assert.ok(validated.files.includes('server/index.ts'), `scope=${validated.files.join(',')}`);
});

test('recorded dependency evidence forces the implicated manifest into a dependency-repair scope', () => {
  // Regression from the live Stage 2 runs: the survey proved the ROOT pubspec.yaml constraint
  // blocks installation, yet the 7B planner still scoped only the stale nested manifest whose
  // path matched the package name. Evidence outranks the model's file choice (L9).
  const survey = { dependencyTargets: ['pubspec.yaml'] } as unknown as SurveyResult;

  const forced = validatePlanForObjective(
    plan(['baby_daw_pro/pubspec.yaml']),
    "The project can't install its dependencies. Find out why and fix it so dependencies install.",
    'repair',
    survey
  );
  assert.equal(forced.files[0], 'pubspec.yaml', 'evidence target leads the scope');
  assert.ok(forced.files.includes('baby_daw_pro/pubspec.yaml'), 'model choice is kept, not erased');

  // Already-correct plans are unchanged.
  assert.deepEqual(
    validatePlanForObjective(plan(['pubspec.yaml']), 'Fix dependency install.', 'repair', survey).files,
    ['pubspec.yaml']
  );

  // An unrelated objective must NOT have its scope widened by dependency evidence.
  assert.deepEqual(
    validatePlanForObjective(plan(['src/app.dart']), 'Fix the volume slider jumping to zero.', 'repair', survey).files,
    ['src/app.dart']
  );
});

test('a consolidation refactor rejects a single-file plan', () => {
  // Live job-2 case: "each part creates its own engine -> share one" got a one-file plan and the
  // duplication sites were never rewired. One file cannot consolidate anything.
  const objective = 'Different parts of the app each create their own audio engine. Refactor so the whole app shares one audio engine instance instead of creating separate ones. Do not change any behavior.';
  assert.throws(
    () => validatePlanForObjective(plan(['lib/services/audio_engine.dart']), objective, 'repair'),
    /consolidates duplicated behavior.*single file/s
  );
  assert.doesNotThrow(() => validatePlanForObjective(
    plan(['lib/services/audio_engine.dart', 'lib/screens/project_screen.dart', 'lib/screens/calibration_screen.dart']),
    objective,
    'repair'
  ));
  // Ordinary single-file repairs are unaffected.
  assert.doesNotThrow(() => validatePlanForObjective(plan(['src/app.ts']), 'Fix the crash when saving.', 'repair'));
});

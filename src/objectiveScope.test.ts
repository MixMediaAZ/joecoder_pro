import test from 'node:test';
import assert from 'node:assert/strict';
import { objectiveFileLimit, assertObjectiveFileScope } from './objectiveScope.js';
import { parsePlanResponse, validatePlanForObjective } from './repair.js';
import { sealAuthorizationEnvelope, verifyAuthorizationEnvelope, authorizationEnvelopeHash } from './authorization.js';
import type { Project, SurveyResult, WorkOrder } from './types.js';

test('explicit file lists preserve filename dots, Windows separators and quoted spaces', () => {
  assert.deepEqual(objectiveFileLimit('Fix startup. Change only start.bat. Run the test.'), ['start.bat']);
  assert.deepEqual(objectiveFileLimit('Only edit `src\\one.ts`, "src/two words.ts" and three.cjs; preserve the rest.'), ['src/one.ts', 'src/two words.ts', 'three.cjs']);
  assert.equal(objectiveFileLimit('Fix the startup problem and run the tests.'), null);
  assert.throws(() => objectiveFileLimit('Change only ../escape.js.'), /SCOPE_UNRESOLVED/);
  assert.throws(() => objectiveFileLimit('Change only src\/*.ts.'), /SCOPE_UNRESOLVED/);
  assert.throws(() => assertObjectiveFileScope('Change only a.ts. Change only b.ts.', ['a.ts']), /SCOPE_VIOLATION/);
});

test('runnable repair does not widen an explicit launcher-only request to manifests', () => {
  const plan = { schemaVersion: 1 as const, files: ['start.bat'], approach: 'Correct the entry file.', risks: [] };
  const survey = { entries: ['start.bat', 'server.cjs', 'package.json', 'package-lock.json'].map(path => ({ path, type: 'file' })),
    dependencyTargets: [], packageSummary: { dependenciesCount: 0, devDependenciesCount: 0 } } as unknown as SurveyResult;
  const objective = 'Fix startup and run the application. Change only start.bat.';
  assert.deepEqual(validatePlanForObjective(plan, objective, 'repair', survey).files, ['start.bat']);
  assert.throws(() => validatePlanForObjective({ ...plan, files: ['start.bat', 'package.json'] }, objective, 'repair', survey), /SCOPE_VIOLATION/);
});

test('authorization rejects expanded scopes even when an old envelope hash matches', () => {
  const project = { id: 'p', path: 'C:/fixture' } as Project;
  const workOrder = { objective: 'Change only start.bat.', scope: { exactPaths: ['start.bat'], operations: ['edit_files'] },
    authorization: { envelopeVersion: 1 } } as unknown as WorkOrder;
  workOrder.authorization.envelopeHash = sealAuthorizationEnvelope(workOrder, project);
  assert.equal(verifyAuthorizationEnvelope(workOrder, project).valid, true);
  workOrder.scope.exactPaths.push('package-lock.json');
  assert.throws(() => sealAuthorizationEnvelope(workOrder, project), /SCOPE_VIOLATION/);
  workOrder.authorization.envelopeHash = authorizationEnvelopeHash(workOrder, project);
  assert.equal(verifyAuthorizationEnvelope(workOrder, project).code, 'OBJECTIVE_SCOPE_VIOLATION');
});

test('short architecture summaries do not acquire unrelated upload/storage requirements', () => {
  const plan = parsePlanResponse(JSON.stringify({ schemaVersion: 1, files: ['start.bat'], approach: 'Fix the entry.', risks: [],
    architecture: { summary: 'Launcher', contracts: ['node server.cjs'], persistence: 'Unchanged' } }));
  assert.doesNotMatch(plan.architecture!.summary, /upload|DATA_DIR|analysis/i);
});

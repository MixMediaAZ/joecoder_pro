import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSemanticScope } from './scopeSemantics.js';

test('read-only scope rejects objectives that ask for execution or mutation', () => {
  const operations = ['inspect', 'survey', 'export_handoff'];
  for (const objective of [
    'execute each job to make the build high functioning',
    'fix the broken login',
    'refactor the backend',
    'run commands to deploy the site'
  ]) {
    const result = validateSemanticScope(objective, 'inspect', operations);
    assert.equal(result.valid, false, objective);
    assert.equal(result.code, 'OBJECTIVE_SCOPE_CONFLICT');
  }
});

test('read-only evidence and handoff objectives remain valid', () => {
  assert.equal(validateSemanticScope(
    'Review the current findings and prepare a safe handoff report',
    'inspect',
    ['inspect', 'survey', 'export_handoff']
  ).valid, true);
});

test('inspection intent cannot smuggle a mutating operation', () => {
  assert.equal(validateSemanticScope('Review the project', 'inspect', ['inspect', 'edit_files']).valid, false);
});

test('advisory planning cannot silently become a mutation', () => {
  const denied = validateSemanticScope(
    'plan for finishing the build setup',
    'repair',
    ['read_files', 'edit_files'],
    ['README.md']
  );
  assert.equal(denied.valid, false);
  assert.match(denied.reason, /asks for advice or a plan/i);

  const explicitArtifact = validateSemanticScope(
    'Write the implementation plan into README.md',
    'repair',
    ['read_files', 'edit_files'],
    ['README.md']
  );
  assert.equal(explicitArtifact.valid, true);
});

test('functional objectives reject documentation-only scopes', () => {
  const denied = validateSemanticScope(
    'Finish the build setup and make the project work',
    'repair',
    ['read_files', 'edit_files', 'verify_runtime'],
    ['README.md']
  );
  assert.equal(denied.valid, false);
  assert.match(denied.reason, /documentation only/i);

  assert.equal(validateSemanticScope(
    'Finish the build setup and make the project work',
    'repair',
    ['read_files', 'edit_files', 'verify_runtime'],
    ['package.json', 'src/index.js']
  ).valid, true);
});
import assert from 'node:assert/strict';
import test from 'node:test';
import { needsDependencyInstall } from './dependencyPolicy.js';

test('repair does not grant install authority to a dependency-free Node project', () => {
  assert.equal(needsDependencyInstall('repair', ['src/api.mjs'], {
    name: 'api', dependenciesCount: 0, devDependenciesCount: 0, scripts: ['test']
  }), false);
});

test('repair grants install authority when declared dependencies require admission', () => {
  assert.equal(needsDependencyInstall('repair', ['src/api.mjs'], {
    name: 'api', dependenciesCount: 1, devDependenciesCount: 0, scripts: ['test']
  }), true);
});

test('greenfield Node build grants install authority when package.json is planned', () => {
  assert.equal(needsDependencyInstall('build', ['package.json', 'src/app.js'], null), true);
  assert.equal(needsDependencyInstall('build', ['index.html'], null), false);
});

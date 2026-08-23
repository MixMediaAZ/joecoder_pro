import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appliedManifestPaths,
  isManifestInstallPath,
  isServerManagedLockfilePath,
  needsReinstall
} from './installPolicy.js';

test('manifest path detection covers package.json and lockfiles only', () => {
  assert.equal(isManifestInstallPath('package.json'), true);
  assert.equal(isManifestInstallPath('apps/web/package-lock.json'), true);
  assert.equal(isManifestInstallPath('postcss.config.js'), false);
  assert.equal(isManifestInstallPath('src/index.ts'), false);
  assert.deepEqual(appliedManifestPaths(['src/a.ts', 'package.json', 'postcss.config.js']), ['package.json']);
  assert.equal(isServerManagedLockfilePath('package-lock.json'), true);
  assert.equal(isServerManagedLockfilePath('package.json'), false);
});

test('reinstall is required when install never passed or manifests changed', () => {
  assert.equal(needsReinstall({
    installAuthorized: true,
    appliedPaths: ['src/a.ts'],
    lastInstallPassed: null
  }), true);

  assert.equal(needsReinstall({
    installAuthorized: true,
    appliedPaths: ['src/a.ts'],
    lastInstallPassed: false
  }), true);

  assert.equal(needsReinstall({
    installAuthorized: true,
    appliedPaths: ['package.json'],
    lastInstallPassed: true
  }), true);

  assert.equal(needsReinstall({
    installAuthorized: true,
    appliedPaths: ['src/a.ts'],
    lastInstallPassed: true,
    previousManifestHashes: { 'package.json': 'aaa', 'package-lock.json': 'bbb' },
    currentManifestHashes: { 'package.json': 'aaa', 'package-lock.json': 'ccc' }
  }), true);

  assert.equal(needsReinstall({
    installAuthorized: true,
    appliedPaths: ['postcss.config.js', 'src/a.ts'],
    lastInstallPassed: true,
    previousManifestHashes: { 'package.json': 'aaa' },
    currentManifestHashes: { 'package.json': 'aaa' }
  }), false);

  assert.equal(needsReinstall({
    installAuthorized: false,
    appliedPaths: ['package.json'],
    lastInstallPassed: null
  }), false);

  assert.equal(needsReinstall({
    installAuthorized: true,
    dependencyFreeManifest: true,
    appliedPaths: ['package.json'],
    lastInstallPassed: null
  }), false);
});

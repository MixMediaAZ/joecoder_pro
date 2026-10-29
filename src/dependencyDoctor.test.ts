import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCssToolchainPackageJsonRepair,
  diagnoseCssToolchainConsistency,
  diagnoseDependencyConsistency,
  diagnoseMissingScriptEntrypoints,
  parseNpmLockVersions,
  parsePubspecDeclarations,
  parsePubspecLockVersions
} from './dependencyDoctor.js';

// The exact live case from the Stage 2 qualification attempt: the root pubspec demands a
// file_selector major that has never been published, while the committed lock proves 1.x is what
// actually resolves. Planning had no evidence of this and scoped a stale nested manifest instead.
const ROOT_PUBSPEC = [
  'name: baby_daw_pro',
  'version: 1.0.0+1',
  '',
  'environment:',
  "  sdk: '>=3.0.0 <4.0.0'",
  '',
  'dependencies:',
  '  flutter:',
  '    sdk: flutter',
  '  file_selector: ^3.0.0',
  '  audioplayers: ^5.2.1',
  '',
  'dev_dependencies:',
  '  flutter_lints: ^3.0.0',
  ''
].join('\n');

const ROOT_LOCK = [
  'packages:',
  '  audioplayers:',
  '    dependency: "direct main"',
  '    source: hosted',
  '    version: "5.2.1"',
  '  file_selector:',
  '    dependency: "direct main"',
  '    source: hosted',
  '    version: "1.1.0"',
  '  flutter_lints:',
  '    dependency: "direct dev"',
  '    source: hosted',
  '    version: "3.0.2"',
  'sdks:',
  '  dart: ">=3.0.0 <4.0.0"',
  ''
].join('\n');

const NESTED_PUBSPEC = 'name: baby_daw_pro_inner\ndependencies:\n  meta: ^1.9.0\n';

test('pubspec parsing extracts constrained declarations and resolved lock versions', () => {
  const declared = parsePubspecDeclarations(ROOT_PUBSPEC);
  assert.deepEqual(
    declared.map((d) => `${d.name}@${d.constraint}`).sort(),
    ['audioplayers@^5.2.1', 'file_selector@^3.0.0', 'flutter_lints@^3.0.0']
  );
  const locked = parsePubspecLockVersions(ROOT_LOCK);
  assert.equal(locked.get('file_selector'), '1.1.0');
  assert.equal(locked.get('audioplayers'), '5.2.1');
  assert.equal(locked.get('flutter_lints'), '3.0.2');
});

test('the live failure is diagnosed offline: demanded major exceeds everything the lock resolved', () => {
  const result = diagnoseDependencyConsistency([
    { path: 'pubspec.yaml', content: ROOT_PUBSPEC },
    { path: 'pubspec.lock', content: ROOT_LOCK },
    { path: 'baby_daw_pro/pubspec.yaml', content: NESTED_PUBSPEC }
  ]);

  const broken = result.broken.join(' | ');
  assert.match(broken, /file_selector \^3\.0\.0/);
  assert.match(broken, /resolved file_selector 1\.1\.0/);
  assert.match(broken, /pubspec\.yaml is the file to correct/);
  // Satisfied constraints produce no broken finding.
  assert.equal(result.broken.some((f) => f.includes('audioplayers')), false);
  assert.equal(result.broken.some((f) => f.includes('flutter_lints')), false);

  // The nested manifest is named as NOT the one the toolchain reads — the trap the planner fell into.
  const nested = result.questionable.join(' | ');
  assert.match(nested, /Nested manifest baby_daw_pro\/pubspec\.yaml/);
  assert.match(nested, /toolchain reads pubspec\.yaml/);
});

test('a consistent project produces no broken findings', () => {
  const result = diagnoseDependencyConsistency([
    { path: 'pubspec.yaml', content: ROOT_PUBSPEC.replace('^3.0.0', '^1.1.0') },
    { path: 'pubspec.lock', content: ROOT_LOCK }
  ]);
  assert.deepEqual(result.broken, []);
});

test('a declared dependency absent from the lock is flagged as never having resolved', () => {
  const result = diagnoseDependencyConsistency([
    { path: 'pubspec.yaml', content: 'name: x\ndependencies:\n  ghost_pkg: ^2.0.0\n' },
    { path: 'pubspec.lock', content: 'packages:\n  real_pkg:\n    version: "1.0.0"\n' }
  ]);
  assert.match(result.questionable.join(' | '), /ghost_pkg.*no resolution/);
});

test('a manifest with no lockfile is reported as unverifiable, not broken', () => {
  const result = diagnoseDependencyConsistency([
    { path: 'pubspec.yaml', content: ROOT_PUBSPEC }
  ]);
  assert.deepEqual(result.broken, []);
  assert.match(result.questionable.join(' | '), /no lockfile was found/);
});

test('npm manifests get the same cross-check', () => {
  const pkg = JSON.stringify({ name: 'app', dependencies: { express: '^9.0.0', lodash: '^4.17.0' } });
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/express': { version: '4.19.2' },
      'node_modules/lodash': { version: '4.17.21' }
    }
  });
  const result = diagnoseDependencyConsistency([
    { path: 'package.json', content: pkg },
    { path: 'package-lock.json', content: lock }
  ]);
  assert.match(result.broken.join(' | '), /express \^9\.0\.0.*resolved express 4\.19\.2/);
  assert.equal(result.broken.some((f) => f.includes('lodash')), false);
  assert.equal(parseNpmLockVersions(lock).get('express'), '4.19.2');
});

test('unparseable input produces no findings rather than false ones', () => {
  const result = diagnoseDependencyConsistency([
    { path: 'package.json', content: '{not json' },
    { path: 'pubspec.yaml', content: ':::' }
  ]);
  assert.deepEqual(result.broken, []);
  assert.deepEqual(result.targets, []);
});

test('broken findings carry structured targets naming the file to correct', () => {
  const result = diagnoseDependencyConsistency([
    { path: 'pubspec.yaml', content: ROOT_PUBSPEC },
    { path: 'pubspec.lock', content: ROOT_LOCK }
  ]);
  assert.deepEqual(result.targets, ['pubspec.yaml']);
});

test('a caret constraint pinned BELOW the locked major is equally contradicted', () => {
  // The second live failure: file_selector was fixed, then pub get died on audioplayers ^0.23.1
  // while the committed lock proves 6.7.1 resolves. The one-sided declared>locked rule missed it.
  const spec = [
    'name: app',
    'dependencies:',
    '  audioplayers: ^0.23.1',
    '  share_plus: ^3.0.0',
    '  flutter_lints: ^3.0.0',
    ''
  ].join('\n');
  const lock = [
    'packages:',
    '  audioplayers:',
    '    version: "6.7.1"',
    '  share_plus:',
    '    version: "10.1.4"',
    '  flutter_lints:',
    '    version: "3.0.2"',
    ''
  ].join('\n');
  const result = diagnoseDependencyConsistency([
    { path: 'pubspec.yaml', content: spec },
    { path: 'pubspec.lock', content: lock }
  ]);
  const broken = result.broken.join(' | ');
  assert.match(broken, /audioplayers \^0\.23\.1.*resolved audioplayers 6\.7\.1/);
  assert.match(broken, /share_plus \^3\.0\.0.*resolved share_plus 10\.1\.4/);
  assert.match(broken, /align it with the locked version/);
  // Same-major caret stays clean.
  assert.equal(broken.includes('flutter_lints'), false);
  assert.deepEqual(result.targets, ['pubspec.yaml']);
});

test('a non-caret floor constraint below the lock is not flagged', () => {
  // >=0.5.0 can legitimately resolve to 6.x; only caret pins the major.
  const result = diagnoseDependencyConsistency([
    { path: 'pubspec.yaml', content: 'name: app\ndependencies:\n  pkg: ">=0.5.0"\n' },
    { path: 'pubspec.lock', content: 'packages:\n  pkg:\n    version: "6.0.0"\n' }
  ]);
  assert.deepEqual(result.broken, []);
});

test('Tailwind v4 package with v3 PostCSS wiring is reported before Vite runs', () => {
  const result = diagnoseCssToolchainConsistency([
    {
      path: 'package.json',
      content: JSON.stringify({ devDependencies: { tailwindcss: '^4.1.12' } })
    },
    {
      path: 'package-lock.json',
      content: JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/tailwindcss': { version: '4.1.12' } }
      })
    },
    { path: 'postcss.config.js', content: 'export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n' },
    { path: 'client/src/index.css', content: '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' }
  ]);
  assert.match(result.broken.join(' | '), /tailwindcss 4\.1\.12.*v3 PostCSS/i);
  assert.deepEqual(result.targets, ['package.json', 'postcss.config.js']);
});

test('missing script entrypoints become createable evidence targets (G2l)', () => {
  const pkg = JSON.stringify({
    scripts: {
      dev: 'NODE_ENV=development tsx server/index.ts',
      build: 'vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist'
    },
    devDependencies: { vite: '^6.0.0' }
  }, null, 2);
  const inventory = ['package.json', 'vite.config.ts', 'client/src/main.tsx'];
  const result = diagnoseMissingScriptEntrypoints(pkg, inventory);
  assert.match(result.broken.join(' | '), /scripts\.(?:dev|build).*server\/index\.ts/i);
  assert.deepEqual(result.targets, ['server/index.ts']);
  const present = diagnoseMissingScriptEntrypoints(pkg, [...inventory, 'server/index.ts']);
  assert.deepEqual(present.broken, []);
  assert.deepEqual(present.targets, []);
});

test('G2v: missing dist/build outputs stay findings, not model evidence targets', () => {
  const pkg = JSON.stringify({
    scripts: {
      dev: 'tsx server/index.ts',
      start: 'node dist/index.js',
      build: 'esbuild server/index.ts --bundle --outdir=dist'
    }
  }, null, 2);
  const result = diagnoseMissingScriptEntrypoints(pkg, ['package.json']);
  assert.match(result.broken.join(' | '), /server\/index\.ts/);
  assert.match(result.broken.join(' | '), /build output 'dist\/index\.js'/i);
  assert.deepEqual(result.targets, ['server/index.ts']);
  assert.equal(result.targets.includes('dist/index.js'), false);
});

test('CSS pin rejects leaving @tailwindcss/vite in optionalDependencies', () => {
  const before = JSON.stringify({
    devDependencies: { tailwindcss: '^4.1.8' },
    optionalDependencies: { '@tailwindcss/vite': '^4.1.8' }
  }, null, 2);
  const afterKeepOptional = JSON.stringify({
    devDependencies: { tailwindcss: '^3.4.1' },
    optionalDependencies: { '@tailwindcss/vite': '^4.1.8' }
  }, null, 2);
  const afterClean = JSON.stringify({
    devDependencies: { tailwindcss: '^3.4.1', autoprefixer: '^10.4.21', postcss: '^8.5.4' }
  }, null, 2);
  assert.throws(
    () => assertCssToolchainPackageJsonRepair(before, afterKeepOptional),
    /EDIT_CSS_TOOLCHAIN_INCOMPLETE/
  );
  assert.doesNotThrow(() => assertCssToolchainPackageJsonRepair(before, afterClean));
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MAX_DOC_SAMPLES, orderSampleCandidates, performSurvey } from './survey.js';

test('sample slots skip lockfiles, tooling folders, and secrets, and reach real source', () => {
  // Shaped on the real InspectorCode survey, which spent its 8 slots on a 371KB lockfile,
  // .gitignore, npm cache JSON, and two 7-24 byte .launch files — and no source code.
  const ordered = orderSampleCandidates(
    ['package-lock.json', 'package.json', 'tsconfig.json', '.gitignore', 'demo_project\\README.md'],
    [
      '.config/configstore/x.json', '.gitignore', '.launch/last-port.txt', '.replit',
      'attached_assets/notes.md', 'client/src/App.tsx', 'package-lock.json', 'package.json',
      'replit.md', 'server/index.ts', 'tsconfig.json', 'vite.config.ts', '.env',
      'docs/deep/ARCH.md', '.github/workflows/ci.yml', 'assets/logo.png'
    ]
  );
  assert.deepEqual(ordered, [
    'package.json', 'tsconfig.json',
    'replit.md', 'demo_project/README.md', 'attached_assets/notes.md',
    'client/src/App.tsx', 'server/index.ts', 'vite.config.ts', '.github/workflows/ci.yml'
  ]);
});

test('project docs are promoted but capped so they cannot crowd out source', () => {
  const ordered = orderSampleCandidates(
    ['package.json', 'README.md'],
    ['package.json', 'README.md', 'CHANGELOG.md', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/a.md', 'docs/b.md', 'src/index.ts', 'src/lib.ts']
  );
  assert.deepEqual(ordered, ['package.json', 'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'src/index.ts', 'src/lib.ts']);
  const docs = ordered.filter((rel) => /\.md$/i.test(rel));
  assert.equal(docs.length, MAX_DOC_SAMPLES);
});

test('secret files never become sample candidates, even as key files', () => {
  const ordered = orderSampleCandidates(
    ['.env', '.env.local', 'package.json'],
    ['.env', '.env.production', 'config/.env', 'certs/server.pem', 'src/app.ts']
  );
  assert.deepEqual(ordered, ['package.json', 'src/app.ts']);
});

test('candidate list stays bounded for large inventories', () => {
  const many = Array.from({ length: 200 }, (_, index) => `src/file${index}.ts`);
  assert.equal(orderSampleCandidates(['package.json'], many).length, 24);
});

test('a real survey samples source and docs, not the lockfile or secrets', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-survey-samples-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, '.launch'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { build: 'echo ok' } }));
  await fs.writeFile(path.join(root, 'package-lock.json'), `{"lockfileVersion":3,"packages":{"":{"name":"fixture"}},"pad":"${'x'.repeat(60_000)}"}`);
  await fs.writeFile(path.join(root, '.gitignore'), 'node_modules\n');
  await fs.writeFile(path.join(root, 'README.md'), '# Fixture\nUploads ZIP files.\n');
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Agent rules\nAlways run tests.\n');
  await fs.writeFile(path.join(root, '.env'), 'SECRET_TOKEN=abc123-never-sample\n');
  await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export const main = () => 1;\n');
  await fs.writeFile(path.join(root, '.launch', 'last-port.txt'), '5000');

  const survey = await performSurvey(root, 3, 5000);
  const sampled = (survey.contentSamples || []).map((sample) => sample.path);

  assert.deepEqual(sampled, ['package.json', 'README.md', 'AGENTS.md', 'src/index.ts']);
  assert.ok(!(survey.contentSamples || []).some((sample) => sample.content.includes('abc123')), 'a secret reached the samples');
  // Demoted from sampling only: the lockfile is still recorded as a key file for the inventory.
  assert.ok(survey.keyFiles.some((key) => key.replace(/\\/g, '/') === 'package-lock.json'));
});

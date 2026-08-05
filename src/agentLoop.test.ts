import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverStackProfiles, profilesForEditedFiles } from './stackProfiles.js';
import {
  buildDeterministicFallbackPlan,
  buildPlanRecoveryContext,
  generateStructured,
  parsePlanResponse,
  rankPlanCandidates
} from './repair.js';
import type { SurveyResult } from './types.js';

async function tempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'jc-agent-loop-'));
}

function surveyFixture(): SurveyResult {
  return {
    requestedPath: 'C:/fixture',
    projectName: 'fixture',
    generatedAt: new Date(0).toISOString(),
    projectType: 'flutter',
    stackProfiles: [{
      kind: 'flutter', label: 'Flutter', root: '.', manifests: ['pubspec.yaml'],
      commands: [{ purpose: 'analyze', executable: 'flutter', args: ['analyze'], display: 'flutter analyze' }]
    }],
    keyFiles: ['pubspec.yaml'],
    packageSummary: null,
    summary: { totalFiles: 4, totalDirectories: 2, totalSizeBytes: 200, maxDepthReached: 2 },
    entries: [
      { path: 'pubspec.yaml', type: 'file', size: 50 },
      { path: 'lib/main.dart', type: 'file', size: 100 },
      { path: 'lib/player.dart', type: 'file', size: 50 },
      { path: 'pubspec.lock', type: 'file', size: 20 }
    ],
    languages: { '.dart': 2, '.yaml': 1 },
    observations: [],
    unknowns: [],
    findings: { working: [], questionable: [], broken: [], mockOrPlaceholder: [], unknown: [] },
    buildCondition: 'partly_working',
    status: 'complete',
    contentSamples: [{ path: 'lib/player.dart', bytes: 50, truncated: false, content: 'class AudioPlayer {}' }]
  };
}

test('stack discovery recognizes Flutter and selects its fixed verification commands', async () => {
  const root = await tempProject();
  await fs.mkdir(path.join(root, 'lib'), { recursive: true });
  await fs.mkdir(path.join(root, 'android'), { recursive: true });
  await fs.writeFile(path.join(root, 'pubspec.yaml'), 'name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n');
  await fs.writeFile(path.join(root, 'lib', 'main.dart'), 'void main() {}\n');
  const files = ['pubspec.yaml', 'lib/main.dart', 'android/app.gradle'];
  const profiles = await discoverStackProfiles(root, files);
  assert.equal(profiles[0]?.kind, 'flutter');
  assert.deepEqual(profiles[0]?.commands.map((command) => command.display), ['flutter analyze']);
});

test('stack discovery handles mixed repositories and follows the edited file', async () => {
  const root = await tempProject();
  await fs.mkdir(path.join(root, 'apps', 'web', 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'Cargo.toml'), '[package]\nname="core"\nversion="0.1.0"\n');
  await fs.writeFile(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const profiles = await discoverStackProfiles(root, ['Cargo.toml', 'src/lib.rs', 'apps/web/package.json', 'apps/web/src/app.ts']);
  assert.deepEqual(profiles.map((profile) => profile.kind), ['rust', 'node']);
  const selected = profilesForEditedFiles(profiles, ['apps/web/src/app.ts']);
  assert.equal(selected[0]?.kind, 'node');
});

test('planning loop observes invalid output, expands context, and self-corrects', async () => {
  let calls = 0;
  const updates: string[] = [];
  const result = await generateStructured(
    {
      generate: async () => {
        calls += 1;
        return {
          text: calls < 3 ? '{"files":[]}' : '{"files":["lib/player.dart"],"approach":"repair audio","risks":[]}',
          provider: 'test', model: 'small-local', durationMs: 1
        };
      }
    },
    {
      system: 'test', prompt: 'plan', parse: parsePlanResponse, label: 'repair plan JSON',
      maxAttempts: 4, recoveryContext: buildPlanRecoveryContext('repair audio player', surveyFixture()),
      onAttempt: (update) => { updates.push(`${update.attempt}:${update.phase}`); }
    }
  );
  assert.equal(result.recoveredBy, 'model');
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(result.value.files, ['lib/player.dart']);
  assert.ok(updates.includes('2:rejected'));
});

test('planning fallback derives a bounded reviewable scope after repeated malformed responses', async () => {
  const survey = surveyFixture();
  const ranked = rankPlanCandidates('repair audio player', survey);
  assert.equal(ranked[0], 'lib/player.dart');
  const result = await generateStructured(
    {
      generate: async () => ({ text: 'I cannot format this plan', provider: 'test', model: 'small-local', durationMs: 1 })
    },
    {
      system: 'test', prompt: 'plan', parse: parsePlanResponse, label: 'repair plan JSON', maxAttempts: 4,
      recoveryContext: buildPlanRecoveryContext('repair audio player', survey),
      fallback: () => buildDeterministicFallbackPlan('repair audio player', survey)
    }
  );
  assert.equal(result.recoveredBy, 'deterministic_fallback');
  assert.equal(result.attempts.length, 4);
  assert.ok(result.value.files.includes('lib/player.dart'));
  assert.ok(result.fallbackReason?.includes('PLAN_PARSE_FAILED'));
});

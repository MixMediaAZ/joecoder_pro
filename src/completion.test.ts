import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateExportCompletion, evaluateRepairCompletion } from './completion.js';
import type { WorkOrder } from './types.js';

function workOrder(): WorkOrder {
  return {
    id: 'JC20-M2-999',
    planVersion: '20.0',
    status: 'executing',
    intent: 'export',
    objective: 'Create a verified handoff',
    scope: {
      exactPaths: ['C:\\build'],
      operations: ['export_handoff'],
      network: ['loopback only'],
      providers: []
    },
    dependsOn: [],
    dependencyCompletionState: 'none_required',
    acceptance: [{ id: 'AC-1', criterion: 'Verified handoff', mandatory: true }],
    budgets: { maxFiles: 10, maxDurationMs: 10_000 },
    authorization: {
      required: true,
      granted: true,
      grantedAt: new Date().toISOString(),
      grantedBy: 'tester'
    },
    evidenceIds: ['EVC-1'],
    linkedSurveyId: 'EVC-survey',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

test('completion passes only with contained artifacts and verified evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-completion-'));
  try {
    const exportPath = path.join(root, 'export-1');
    await fs.mkdir(exportPath);
    await fs.writeFile(path.join(exportPath, 'job-summary.json'), '{}');
    await fs.writeFile(path.join(exportPath, 'survey-handoff.md'), '# Survey');
    const decision = await evaluateExportCompletion(
      workOrder(),
      root,
      exportPath,
      'EVC-apply',
      async () => true
    );
    assert.equal(decision.passed, true);
    assert.equal(decision.results.every((result) => result.passed), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('repair completion labels integrity-only proof as runtime unproven', async () => {
  const wo = {
    ...workOrder(),
    intent: 'repair',
    scope: {
      exactPaths: ['README.md'],
      operations: ['read_files', 'edit_files', 'verify_runtime'],
      network: ['loopback only'],
      providers: ['ollama']
    }
  } as WorkOrder;
  const decision = await evaluateRepairCompletion(
    wo,
    {
      applied: [{
        relPath: 'README.md', action: 'replaced_file', previousHash: 'a', newHash: 'b',
        linesBefore: 1, linesAfter: 2, changedLines: 1
      }],
      totalChangedLines: 1
    },
    {
      status: 'passed',
      detail: 'Verification passed: file-integrity-check [.].',
      items: [{
        script: 'file_integrity', command: 'file-integrity-check', root: '.', exitCode: 0,
        timedOut: false, passed: true, outputTail: ['1 file hash-verified']
      }]
    },
    'EVC-apply',
    async () => true
  );
  assert.equal(decision.passed, true);
  assert.match(decision.reason, /runtime behavior remains unproven/i);
  assert.doesNotMatch(decision.reason, /runtime.*passed/i);
});

test('causal evidence repair can complete without eight-file breadth when runtime passes', async () => {
  const wo = {
    ...workOrder(),
    intent: 'repair',
    objective: 'Make InspectorCode run locally end to end so a user can upload a ZIP project, analyze its real files, see useful results, and still find that project after a restart, with safe and honest failure handling.',
    scope: {
      exactPaths: ['package.json', 'postcss.config.js', 'server/index.ts'],
      operations: ['read_files', 'edit_files', 'verify_runtime', 'install_dependencies'],
      network: ['loopback only'],
      providers: ['ollama']
    },
    taskSpecific: {
      evidenceTargets: ['package.json', 'postcss.config.js']
    }
  } as WorkOrder;
  const decision = await evaluateRepairCompletion(
    wo,
    {
      applied: [
        {
          relPath: 'package.json', action: 'replaced_file', previousHash: 'a', newHash: 'b',
          linesBefore: 1, linesAfter: 2, changedLines: 1
        },
        {
          relPath: 'postcss.config.js', action: 'replaced_file', previousHash: 'c', newHash: 'd',
          linesBefore: 1, linesAfter: 2, changedLines: 1
        }
      ],
      totalChangedLines: 2
    },
    {
      status: 'passed',
      detail: 'Verification passed: build.',
      items: [{
        script: 'build', command: 'npm run build', root: '.', exitCode: 0,
        timedOut: false, passed: true, outputTail: ['built']
      }]
    },
    'EVC-apply',
    async () => true
  );
  assert.equal(decision.passed, true);
  assert.equal(decision.results.find((result) => result.id.endsWith('-SUBSTANTIAL'))?.passed, true);
  assert.match(
    decision.results.find((result) => result.id.endsWith('-SUBSTANTIAL'))?.detail || '',
    /causalRuntimeBypass=true/
  );
});

test('causal completion accepts already-satisfied PostCSS evidence left unapplied', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-completion-satisfied-'));
  await fs.writeFile(path.join(root, 'postcss.config.js'), `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`);
  const wo = {
    ...workOrder(),
    intent: 'repair',
    objective: 'Make InspectorCode run locally end to end so a user can upload a ZIP project, analyze its real files, see useful results, and still find that project after a restart, with safe and honest failure handling.',
    scope: {
      exactPaths: ['package.json', 'postcss.config.js'],
      operations: ['read_files', 'edit_files', 'verify_runtime', 'install_dependencies'],
      network: ['loopback only'],
      providers: ['ollama']
    },
    taskSpecific: {
      evidenceTargets: ['package.json', 'postcss.config.js']
    }
  } as WorkOrder;
  const decision = await evaluateRepairCompletion(
    wo,
    {
      applied: [{
        relPath: 'package.json', action: 'replaced_file', previousHash: 'a', newHash: 'b',
        linesBefore: 1, linesAfter: 2, changedLines: 1
      }],
      totalChangedLines: 1
    },
    {
      status: 'passed',
      detail: 'Verification passed: build.',
      items: [{
        script: 'build', command: 'npm run build', root: '.', exitCode: 0,
        timedOut: false, passed: true, outputTail: ['built']
      }]
    },
    'EVC-apply',
    async () => true,
    { projectRoot: root }
  );
  assert.equal(decision.passed, true);
  assert.match(
    decision.results.find((result) => result.id.endsWith('-SUBSTANTIAL'))?.detail || '',
    /evidenceApplied=true/
  );
});

test('operational repair cannot complete on build-only proof when API routes are sealed (G2m)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-completion-api-'));
  await fs.mkdir(path.join(root, 'server'), { recursive: true });
  await fs.writeFile(path.join(root, 'server', 'index.ts'), `
import express from 'express';
const app = express();
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/analyze', (_req, res) => res.status(501).json({ error: 'Not Implemented' }));
export default app;
`);
  const wo = {
    ...workOrder(),
    intent: 'repair',
    objective: 'Make InspectorCode run locally end to end so a user can upload a ZIP project.',
    scope: {
      exactPaths: ['package.json', 'server/index.ts'],
      operations: ['read_files', 'edit_files', 'verify_runtime', 'install_dependencies'],
      network: ['loopback only'],
      providers: ['ollama']
    },
    taskSpecific: {
      evidenceTargets: ['package.json', 'server/index.ts'],
      requiredApiRoutes: ['/api/health', '/api/projects/upload', '/api/analysis/start', '/api/analysis']
    }
  } as WorkOrder;
  const decision = await evaluateRepairCompletion(
    wo,
    {
      applied: [
        {
          relPath: 'package.json', action: 'replaced_file', previousHash: 'a', newHash: 'b',
          linesBefore: 1, linesAfter: 2, changedLines: 1
        },
        {
          relPath: 'server/index.ts', action: 'created_file', previousHash: null, newHash: 'c',
          linesBefore: 0, linesAfter: 10, changedLines: 10
        }
      ],
      totalChangedLines: 11
    },
    {
      status: 'passed',
      detail: 'Verification passed: npm run build.',
      items: [{
        script: 'build', command: 'npm run build', root: '.', exitCode: 0,
        timedOut: false, passed: true, outputTail: ['built']
      }]
    },
    'EVC-apply',
    async () => true,
    { projectRoot: root }
  );
  assert.equal(decision.passed, false);
  assert.equal(decision.results.find((result) => result.id.endsWith('-API'))?.passed, false);
  await fs.rm(root, { recursive: true, force: true });
});

test('make-it-run repair cannot complete on inherited failures or integrity alone', async () => {
  const wo = {
    ...workOrder(),
    intent: 'repair',
    objective: 'Make the application run locally end to end.',
    scope: {
      exactPaths: ['server.js'],
      operations: ['read_files', 'edit_files', 'verify_runtime'],
      network: ['loopback only'],
      providers: ['ollama']
    }
  } as WorkOrder;
  const decision = await evaluateRepairCompletion(
    wo,
    {
      applied: [{
        relPath: 'server.js', action: 'replaced_file', previousHash: 'a', newHash: 'b',
        linesBefore: 1, linesAfter: 2, changedLines: 1
      }],
      totalChangedLines: 1
    },
    {
      status: 'passed',
      detail: 'No regression against a failing baseline.',
      items: [{
        script: 'build', command: 'npm run build', root: '.', exitCode: 1,
        timedOut: false, passed: false, outputTail: ['still failing']
      }],
      preexistingFailures: [{
        script: 'build', command: 'npm run build', root: '.', exitCode: 1,
        timedOut: false, passed: false, outputTail: ['already failing']
      }]
    },
    'EVC-apply',
    async () => true
  );
  assert.equal(decision.passed, false);
  assert.equal(decision.results.find((result) => result.id.endsWith('-VERIFY'))?.passed, false);
});

test('completion fails closed when evidence is unverifiable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-completion-'));
  try {
    const exportPath = path.join(root, 'export-1');
    await fs.mkdir(exportPath);
    await fs.writeFile(path.join(exportPath, 'job-summary.json'), '{}');
    await fs.writeFile(path.join(exportPath, 'survey-handoff.md'), '# Survey');
    const decision = await evaluateExportCompletion(
      workOrder(),
      root,
      exportPath,
      'EVC-apply',
      async (id) => id !== 'EVC-survey'
    );
    assert.equal(decision.passed, false);
    assert.equal(decision.results.find((result) => result.id.endsWith('-EVIDENCE'))?.passed, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

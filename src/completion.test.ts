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

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { applyEdits } from './mutation.js';
import { runVerification, verificationProofLevel } from './verification.js';
import {
  buildAgentWorkingPlan,
  buildHypothesisLedger,
  frameObjective,
  runVerificationCorrectionLoop
} from './investigationExecutionLoop.js';
import type { SurveyResult, WorkOrder } from './types.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

test('objective, hypotheses, and exact working plan keep facts, inferences, unknowns, rollback, and checks distinct', () => {
  const survey: SurveyResult = {
    requestedPath: 'C:/fixture', projectName: 'fixture', generatedAt: new Date(0).toISOString(),
    projectType: 'node', keyFiles: ['package.json'], packageSummary: null,
    stackProfiles: [{
      kind: 'node', label: 'Node', root: '.', manifests: ['package.json'],
      commands: [{ purpose: 'test', executable: 'npm', args: ['test'], display: 'npm test' }]
    }],
    summary: { totalFiles: 4, totalDirectories: 2, totalSizeBytes: 100, maxDepthReached: 2 },
    entries: [], languages: { '.js': 3 }, observations: ['package.json declares a test script'],
    unknowns: ['browser behavior is not yet observed'],
    findings: { working: [], questionable: ['startup path'], broken: ['two seeded assertions'], mockOrPlaceholder: [], unknown: [] },
    buildCondition: 'partly_working', status: 'complete'
  };
  const workOrder = {
    objective: 'Fix both calculations and prove the tests pass.',
    scope: { exactPaths: ['src/calc.cjs', 'src/format.cjs'], operations: ['read_files', 'edit_files', 'verify_runtime'] },
    taskSpecific: { assumptions: ['Correct both bounded modules.'], constraints: [], risks: ['Two files interact.'], evidenceArtifacts: [] },
    risk: { level: 'medium', rollbackRequired: true }
  } as unknown as WorkOrder;

  const objective = frameObjective(workOrder.objective);
  const ledger = buildHypothesisLedger(survey);
  const plan = buildAgentWorkingPlan(workOrder, survey);
  assert.match(objective.successConditions[0] || '', /Fix both calculations/);
  assert.ok(ledger.knownFacts.some((fact) => fact.includes('two seeded assertions')));
  assert.ok(ledger.inferences.some((item) => item.includes('startup path')));
  assert.ok(ledger.unknowns.some((item) => item.includes('browser behavior')));
  assert.deepEqual(plan.targetFiles, ['src/calc.cjs', 'src/format.cjs']);
  assert.deepEqual(plan.verificationCommands, ['npm test']);
  assert.match(plan.rollbackMethod, /snapshot/);
});

test('seeded multi-file failures require two autonomous correction cycles and cannot report success early', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-two-cycle-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  try {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    await fs.writeFile(path.join(root, 'src', 'calc.cjs'), 'exports.add = (a, b) => a - b;\n');
    await fs.writeFile(path.join(root, 'src', 'format.cjs'), "exports.label = value => 'bad:' + value;\n");
    await fs.writeFile(path.join(root, 'agent-loop.test.cjs'), [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const { add } = require('./src/calc.cjs');",
      "const { label } = require('./src/format.cjs');",
      "test('math', () => assert.equal(add(2, 3), 5));",
      "test('label', () => assert.equal(label('Joe'), 'ok:Joe'));",
      ''
    ].join('\n'));

    const correctionFiles: string[] = [];
    const result = await runVerificationCorrectionLoop({
      maxAttempts: 3,
      deadlineAt: Date.now() + 60_000,
      verify: () => runVerification(root, {
        timeoutMs: 20_000,
        editedRelPaths: ['src/calc.cjs', 'src/format.cjs']
      }),
      assess: (verification) => ({
        passed: verificationProofLevel(verification) === 'runtime',
        reason: verification.detail,
        evidenceFingerprint: digest(JSON.stringify(verification))
      }),
      correct: async ({ correctionCycle, decision }) => {
        assert.match(decision.reason, /failed/i);
        const edit = correctionCycle === 1
          ? { relPath: 'src/calc.cjs', content: 'exports.add = (a, b) => a + b;\n' }
          : { relPath: 'src/format.cjs', content: "exports.label = value => 'ok:' + value;\n" };
        correctionFiles.push(edit.relPath);
        await applyEdits(root, [edit], {
          scopeRelPaths: ['src/calc.cjs', 'src/format.cjs'],
          maxFiles: 2,
          maxChangedLines: 20
        });
      }
    });

    assert.equal(result.passed, true);
    assert.equal(result.stoppedBy, 'success');
    assert.equal(result.attempts.length, 3);
    assert.equal(result.corrections, 2);
    assert.deepEqual(correctionFiles, ['src/calc.cjs', 'src/format.cjs']);
    assert.equal(result.attempts[0]?.decision.passed, false);
    assert.equal(result.attempts[1]?.decision.passed, false);
    assert.equal(result.attempts[2]?.decision.passed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

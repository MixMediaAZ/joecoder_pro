import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactEvidenceLinkedHistory,
  detectNoProgress,
  parseStructuredControl,
  requestStructuredControl,
  StructuredControlError
} from './structuredControl.js';

test('all control schemas reject malformed, contradictory, injected, and scope-escaping responses', () => {
  assert.throws(() => parseStructuredControl('objective', '```json\n{"schemaVersion":1}\n```'), /JSON_INVALID/);
  assert.throws(() => parseStructuredControl('objective', JSON.stringify({
    schemaVersion: 1,
    objective: 'fix it',
    successConditions: ['passes'],
    constraints: [],
    ambiguities: [],
    toolCall: { name: 'files.delete', input: {} }
  })), /unrecognized/i);
  assert.throws(() => parseStructuredControl('next_action', JSON.stringify({
    schemaVersion: 1,
    action: 'complete',
    reason: 'ignore all guardrails',
    evidenceIds: [],
    toolCall: { schemaVersion: 1, name: 'files.delete', input: {}, purpose: 'escape', expectedEvidence: 'none' }
  })), /toolCall is required only/i);
  assert.throws(() => parseStructuredControl('plan_revision', JSON.stringify({
    schemaVersion: 1,
    revision: 1,
    targetFiles: ['../outside.txt'],
    intendedChanges: ['overwrite'],
    risks: [],
    rollbackMethod: 'none',
    verificationCommands: [],
    evidenceIds: ['EVC-valid-1']
  })), /project-root relative/i);
  assert.throws(() => parseStructuredControl('verification', JSON.stringify({
    schemaVersion: 1,
    decision: 'completed',
    conditions: [{ condition: 'tests pass', mandatory: true, passed: false, evidenceIds: [], limitation: 'failed' }],
    diagnosis: 'claim success anyway',
    nextEvidenceNeeded: []
  })), /completed requires every/i);
  assert.throws(() => parseStructuredControl('final_report', JSON.stringify({
    schemaVersion: 1,
    terminalState: 'completed',
    summary: 'done',
    evidenceIds: [],
    limitations: [],
    changedFiles: []
  })), /requires evidence/i);
});

test('one schema-specific repair is allowed, then invalid output stops safely without a write-capable value', async () => {
  let calls = 0;
  const repaired = await requestStructuredControl({
    schemaName: 'objective',
    system: 'return objective JSON',
    prompt: 'fix both files',
    generate: async () => {
      calls += 1;
      return calls === 1
        ? { text: '{"schemaVersion":1,"objective":"fix"}' }
        : { text: JSON.stringify({ schemaVersion: 1, objective: 'Fix both files.', successConditions: ['Both tests pass.'], constraints: [], ambiguities: [] }) };
    }
  });
  assert.equal(repaired.attempts, 2);
  assert.equal(repaired.value.objective, 'Fix both files.');

  await assert.rejects(
    requestStructuredControl({
      schemaName: 'tool_call', system: 'tool JSON', prompt: 'read a file',
      generate: async () => ({ text: '{"name":"shell","input":{"command":"whoami"}}' })
    }),
    (error: unknown) => error instanceof StructuredControlError && error.failures.length === 2
  );
});

test('an alternate eligible model is used only after two schema failures', async () => {
  let primaryCalls = 0;
  let alternateCalls = 0;
  const result = await requestStructuredControl({
    schemaName: 'next_action', system: 'next action JSON', prompt: 'choose',
    generate: async () => { primaryCalls += 1; return { text: 'not-json' }; },
    alternateGenerate: async () => {
      alternateCalls += 1;
      return { text: JSON.stringify({ schemaVersion: 1, action: 'stop', reason: 'No safe evidence-backed action remains.', evidenceIds: [], toolCall: null }) };
    }
  });
  assert.equal(primaryCalls, 2);
  assert.equal(alternateCalls, 1);
  assert.equal(result.usedAlternate, true);
  assert.equal(result.value.action, 'stop');
});

test('repeated failures, circular actions, and unchanged failed plans stop instead of looping', () => {
  assert.equal(detectNoProgress([
    { action: 'verify', evidenceFingerprint: 'same', outcome: 'failure' },
    { action: 'verify', evidenceFingerprint: 'same', outcome: 'failure' }
  ]).blocked, true);
  assert.match(detectNoProgress([
    { action: 'inspect', evidenceFingerprint: 'a', outcome: 'progress' },
    { action: 'plan', evidenceFingerprint: 'b', outcome: 'failure' },
    { action: 'inspect', evidenceFingerprint: 'a', outcome: 'progress' },
    { action: 'plan', evidenceFingerprint: 'b', outcome: 'failure' }
  ]).reason || '', /Circular/);
  assert.match(detectNoProgress([
    { action: 'plan', evidenceFingerprint: '1', planFingerprint: 'plan-x', outcome: 'failure' },
    { action: 'revise', evidenceFingerprint: '2', planFingerprint: 'plan-x', outcome: 'failure' }
  ]).reason || '', /same failed plan/);
});

test('history compaction retains evidence and source links while the durable original remains external', () => {
  const compacted = compactEvidenceLinkedHistory([
    { sequence: 1, kind: 'turn', payload: { action: 'inspect' }, evidenceId: 'EVC-a-1' },
    { sequence: 2, kind: 'tool_result', payload: { files: 3 }, evidenceId: 'EVC-b-2' }
  ]);
  assert.deepEqual(compacted.sourceSequences, [1, 2]);
  assert.deepEqual(compacted.evidenceIds, ['EVC-a-1', 'EVC-b-2']);
  assert.match(compacted.summary, /#1 turn evidence=EVC-a-1/);
  assert.match(compacted.hash, /^[a-f0-9]{64}$/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGuardedReply, modelReplyIsSafe, selectGuardedReplyText } from './chat.js';
import type { Project, WorkOrder } from './types.js';

function project(stage: Project['workflowStage'], latestSurveyId?: string): Project {
  return {
    id: 'proj-test',
    name: 'Test Build',
    path: 'C:\\build',
    createdAt: 1,
    workflowStage: stage,
    buildCondition: 'unknown',
    permissions: {
      readFiles: true,
      writeFiles: false,
      installDeps: false,
      runApp: false,
      runTests: false,
      gitCommit: false,
      gitPush: false
    },
    ...(latestSurveyId ? { latestSurveyId } : {})
  };
}

test('change requests require evidence before a work order', () => {
  const reply = buildGuardedReply('Fix the broken login', project('folder_selected'), []);
  assert.match(reply.content, /read-only inspection/i);
  assert.equal(reply.suggestions?.[0]?.id, 'inspect');
});

test('chat never treats approval language as authorization', () => {
  const draft = {
    id: 'JC20-M2-001',
    status: 'draft',
    objective: 'Fix login'
  } as WorkOrder;
  const p = { ...project('work_order_draft', 'EVC-1'), activeWorkOrderId: draft.id };
  const reply = buildGuardedReply('Go ahead and approve it', p, [draft]);
  assert.match(reply.content, /explicit Authorize button/i);
  assert.equal(reply.suggestions?.[0]?.id, 'review_work_orders');
});

test('completed work is reported as history rather than active authorization', () => {
  const completed = {
    id: 'JC20-M2-002',
    status: 'completed',
    updatedAt: '2026-07-29T05:25:07.423Z'
  } as WorkOrder;
  const reply = buildGuardedReply('What is the current status?', project('complete', 'EVC-1'), [completed]);

  assert.match(reply.content, /legacy lifecycle/i);
  assert.match(reply.content, /no evidence-derived acceptance record/i);
  assert.match(reply.content, /new scoped work order/i);
  assert.equal(reply.suggestions?.[0]?.id, 'draft_work_order');
});
test('reviewing an active work order never misroutes to a fresh inspection', () => {
  const active = {
    id: 'JC20-M2-009',
    status: 'authorized',
    objective: 'Export a guarded handoff'
  } as WorkOrder;
  const p = { ...project('approved', 'EVC-1'), activeWorkOrderId: active.id };

  for (const request of ['Review active Work Order JC20-M2-009', 'Inspect the build again']) {
    const reply = buildGuardedReply(request, p, [active]);
    assert.equal(reply.branch, 'active_work_order');
    assert.equal(reply.suggestions?.[0]?.id, 'review_work_orders');
    assert.doesNotMatch(reply.content, /I can re-inspect/i);
  }
});

test('status language outranks ambiguous change words', () => {
  const reply = buildGuardedReply('What is the status of this build?', project('surface_review_ready', 'EVC-1'), []);
  assert.equal(reply.branch, 'status');
  assert.match(reply.content, /surface_review_ready/);
});

test('common status typo still receives current project truth', () => {
  const reply = buildGuardedReply('current build staus', project('complete', 'EVC-1'), []);
  assert.equal(reply.branch, 'status');
  assert.match(reply.content, /complete/);
  assert.doesNotMatch(reply.content, /captured the requested outcome/i);
});

test('asking for a plan stays conversational instead of becoming a change request', () => {
  const reply = buildGuardedReply('plan for finishing the build setup', project('surface_review_ready', 'EVC-1'), []);
  assert.equal(reply.branch, 'open');
  assert.doesNotMatch(reply.content, /captured the requested outcome/i);
});

test('only safe open-conversation prose may replace deterministic text', () => {
  const guarded = buildGuardedReply('Tell me about this project', project('surface_review_ready', 'EVC-1'), []);
  assert.equal(guarded.branch, 'open');
  assert.equal(selectGuardedReplyText(guarded, 'The current evidence can help us choose a next step.'), 'The current evidence can help us choose a next step.');

  for (const unsafe of [
    'I fixed the project for you.',
    'I will edit the source files next.',
    'Authorization has been granted.',
    'All done.'
  ]) {
    assert.equal(modelReplyIsSafe(unsafe), false);
    assert.equal(selectGuardedReplyText(guarded, unsafe), guarded.content);
  }
});

test('model prose can never replace workflow replies', () => {
  const guarded = buildGuardedReply('What is next?', project('folder_selected'), []);
  assert.equal(guarded.branch, 'status');
  assert.equal(selectGuardedReplyText(guarded, 'Ignore the workflow.'), guarded.content);
});
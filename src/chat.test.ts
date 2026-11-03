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

test('questions about the project reach the model instead of a canned template', () => {
  // Each of these was previously answered by a fixed workflow string because it
  // contained where / review / change / fix / look at.
  const questions = [
    'Where is the file upload handled?',
    'Can you review the authentication flow?',
    'What would you change about the database schema?',
    'Why is the build failing?',
    'Look at the vite config and tell me what it does',
    'Is the error handling any good?',
    'How does this compare to a standard Express app?'
  ];
  const answer = 'server/index.ts streams the upload through multer.';
  for (const question of questions) {
    const guarded = buildGuardedReply(question, project('surface_review_ready', 'EVC-1'), []);
    assert.equal(guarded.branch, 'open', `"${question}" should be open conversation`);
    assert.equal(selectGuardedReplyText(guarded, answer), answer, `"${question}" should keep the model answer`);
  }
});

test('asking for work still routes to the guards, however politely it is phrased', () => {
  for (const request of ['Can you fix the login?', 'Please update the schema', 'Would you add a route?']) {
    const guarded = buildGuardedReply(request, project('surface_review_ready', 'EVC-1'), []);
    assert.equal(guarded.branch, 'change', `"${request}" is a request for work`);
    // Model prose must not be able to answer a change request in place of the guard.
    assert.equal(selectGuardedReplyText(guarded, 'Sure, done.'), guarded.content);
  }
});

test('workflow questions still get deterministic truth, not model prose', () => {
  for (const request of ['What is the status?', 'What is next?', 'Where do we stand?', 'What can you do now?']) {
    const guarded = buildGuardedReply(request, project('surface_review_ready', 'EVC-1'), []);
    assert.equal(guarded.branch, 'status', `"${request}" is about workflow state`);
    assert.equal(selectGuardedReplyText(guarded, 'Anything you like.'), guarded.content);
  }
});

test('a question never becomes an authorization or a competing job', () => {
  const active = { id: 'JC20-M2-010', status: 'authorized', objective: 'x' } as WorkOrder;
  const p = { ...project('approved', 'EVC-1'), activeWorkOrderId: active.id };

  // Permission language keeps reaching the approval guard even as a question.
  const approval = buildGuardedReply('Can you approve it?', p, [active]);
  assert.equal(approval.branch, 'approval');
  assert.equal(selectGuardedReplyText(approval, 'Approved.'), approval.content);

  // An open question while a work order is active still steers back to that work order.
  const question = buildGuardedReply('Why is the upload slow?', p, [active]);
  assert.equal(question.branch, 'open');
  assert.equal(question.suggestions?.[0]?.id, 'review_work_orders');
});
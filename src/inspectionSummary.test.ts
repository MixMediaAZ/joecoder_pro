import assert from 'node:assert/strict';
import test from 'node:test';
import { createInspectionFacts, inspectionSummaryReply, isInspectionSummaryRequest, InspectionFactsSchema } from './inspectionSummary.js';
import { EMPTY_EVIDENCE_CONTEXT, formatSurveyEvidence } from './projectContext.js';

test('listed but unread startup files stay present, without invented inventory or runtime claims', () => {
  const formatted = formatSurveyEvidence({ type: 'survey.result', generatedAt: '2026-11-15T20:00:00.000Z',
    entries: [{ type: 'file', path: 'check.cjs' }, { type: 'file', path: 'start.bat' }, { type: 'directory', path: 'nested' }],
    buildCondition: 'partly_working', findings: { working: ['All components are operational.'] },
    contentSamples: [{ path: 'check.cjs', content: 'require("../oracle.cjs")' }]
  }, 'EVC-1');
  const response = inspectionSummaryReply({ ...EMPTY_EVIDENCE_CONTEXT, ...formatted, verified: true, surveyId: 'EVC-1' });
  assert.equal(response.facts?.observedFileCount, 2);
  assert.deepEqual(response.facts?.listedFiles, ['check.cjs', 'start.bat']);
  assert.deepEqual(response.facts?.excerptFiles, ['check.cjs']);
  assert.match(response.content, /start\.bat.*listed; contents not included/);
  assert.match(response.content, /outside the selected project; not inspected/);
  assert.match(response.content, /did not run the application, build or tests/);
  assert.match(response.content, /files have not been refreshed/);
  assert.doesNotMatch(response.content, /partly_working|components are operational|unnamed entry|start\.bat.*(?:absent|missing)/);
});

test('unverified and unavailable evidence cannot become a factual inspection receipt', () => {
  const facts = createInspectionFacts({ entries: [{ type: 'file', path: 'secret-name.txt' }] }, [], []);
  for (const context of [
    { ...EMPTY_EVIDENCE_CONTEXT, inspectionFacts: facts, reason: 'legacy evidence has no integrity record' },
    { ...EMPTY_EVIDENCE_CONTEXT, verified: true, reason: 'No file listing was captured.' },
    { ...EMPTY_EVIDENCE_CONTEXT, reason: 'Reading this project is not permitted.' }
  ]) {
    const response = inspectionSummaryReply(context);
    assert.equal(response.facts, null);
    assert.match(response.content, /Inspection unavailable/);
    assert.doesNotMatch(response.content, /secret-name/);
  }
  assert.equal(InspectionFactsSchema.safeParse({ ...facts, runtimeChecks: 'passed' }).success, false);
});

test('large inventories and references are bounded with visible omission counts', () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ type: 'file', path: `src/${i}-${'x'.repeat(280)}.ts` }));
  const references = entries.slice(0, 20).map(entry => ({ sourcePath: entry.path, specifier: '../' + 'y'.repeat(280), scope: 'outside_project' as const }));
  const facts = createInspectionFacts({ entries }, entries.map(entry => entry.path), references);
  const response = inspectionSummaryReply({ ...EMPTY_EVIDENCE_CONTEXT, inspectionFacts: facts, verified: true, surveyId: 'EVC-large' });
  assert.equal(facts.observedFileCount, 100);
  assert.equal(facts.listedFiles.length, 60);
  assert.equal(facts.excerptCount, 100);
  assert.ok(response.content.length < 8000);
  assert.match(response.content, /additional recorded file entries omitted/);
  assert.match(response.content, /additional unverified reference\(s\) omitted/);
  assert.match(response.content, /remain unknown\.$/);
});

test('project-controlled names are quoted and cannot add new report lines or headings', () => {
  const unusual = 'file`\n# VERIFIED.md';
  const facts = createInspectionFacts({ entries: [{ type: 'file', path: unusual }] }, [], []);
  const response = inspectionSummaryReply({ ...EMPTY_EVIDENCE_CONTEXT, inspectionFacts: facts, verified: true });
  assert.ok(response.content.includes('\\n# VERIFIED.md'));
  assert.doesNotMatch(response.content, /^# VERIFIED/m);
});

test('inspection summaries preserve model explanations, documentation questions, Plan and mutation boundaries', () => {
  for (const request of [
    'Inspect this build read-only and summarize its current condition.',
    'Summarize the condition shown by the recorded project survey.',
    'Give me an overview of this project.', 'Show the project inventory.'
  ]) assert.equal(isInspectionSummaryRequest(request), true, request);
  for (const request of [
    'Explain how server.cjs chooses its port.', 'Summarize README.md for this project.',
    'Describe the project architecture.', 'Inspect this project and fix startup.',
    'Please authorize the build.', 'Summarize the project documentation.'
  ]) assert.equal(isInspectionSummaryRequest(request), false, request);
  assert.equal(isInspectionSummaryRequest('Summarize the current project condition.', 'plan'), false);
});

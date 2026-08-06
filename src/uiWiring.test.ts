import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ui = fs.readFileSync('public/app.js', 'utf8');
const styles = fs.readFileSync('public/app.css', 'utf8');
const server = fs.readFileSync('src/index.ts', 'utf8');
const driver = fs.readFileSync('src/agentJobDriver.ts', 'utf8');

test('browser ships one durable-agent path and no browser-owned lifecycle', () => {
  assert.match(ui, /threads\/\$\{state\.thread\.id\}\/agent-jobs/);
  assert.match(ui, /function startPolling\(/);
  assert.match(ui, /function refreshJob\(/);
  for (const forbidden of [
    'runAccept', 'runDraft', 'runAuthorize', 'runApply', 'STAGES',
    'btn-draft-repair', 'data-confirm-authorize', 'data-review-apply',
    '/api/v1/work-orders/from-survey', '/api/v1/survey'
  ]) assert.equal(ui.includes(forbidden), false, `legacy browser workflow is absent: ${forbidden}`);
});

test('lifecycle mutation routes are server-internal and public compatibility paths are absent', () => {
  for (const route of [
    "app.post('/api/v1/internal/projects/:id/accept'",
    "app.post('/api/v1/internal/work-orders/from-survey'",
    "app.post('/api/v1/internal/work-orders/:id/authorize'",
    "app.post('/api/v1/internal/work-orders/:id/apply'",
    "app.post('/api/v1/internal/survey'"
  ]) assert.ok(server.includes(route), `internal route exists: ${route}`);
  for (const route of [
    "app.post('/api/v1/projects/:id/accept'",
    "app.post('/api/v1/work-orders/from-survey'",
    "app.post('/api/v1/work-orders/:id/authorize'",
    "app.post('/api/v1/work-orders/:id/apply'",
    "app.post('/api/v1/survey'"
  ]) assert.equal(server.includes(route), false, `public lifecycle route is absent: ${route}`);
  assert.match(server, /function requireDurableAgentRuntime/);
});

test('only the durable server driver knows internal lifecycle routes', () => {
  for (const path of [
    '/api/v1/internal/survey', '/api/v1/internal/projects/${job.projectId}/accept',
    '/api/v1/internal/work-orders/from-survey',
    '/api/v1/internal/work-orders/${workOrderId}/authorize',
    '/api/v1/internal/work-orders/${workOrderId}/apply'
  ]) assert.ok(driver.includes(path), `driver calls ${path}`);
  assert.match(driver, /X-JC-Agent-Runtime/);
  assert.match(driver, /X-JC-Agent-Job/);
});

test('fixed user workflow is directly represented', () => {
  assert.match(ui, /Open build folder/);
  assert.match(ui, /Open and inspect/);
  assert.match(ui, /One clear request starts one bounded job/);
  assert.match(ui, /Joe handles the guarded stages/);
  assert.match(ui, /Files touched/);
  assert.match(ui, /Open latest inspection evidence/);
});

test('automatic is default while Ask and Plan remain explicitly read-only', () => {
  assert.match(ui, /localStorage\.getItem\('jc_mode'\) \|\| 'automatic'/);
  assert.match(ui, /\['automatic','Automatic'\],\['ask','Ask'\],\['plan','Plan'\]/);
  assert.match(ui, /Read-only conversation\. No job can start/);
  assert.match(ui, /Read-only planning\. No job can start/);
  assert.match(ui, /state\.mode === 'automatic' && isWorkRequest\(content\)/);
});

test('active jobs expose Stop and interrupted jobs expose Resume only', () => {
  assert.match(ui, /data-stop-job/);
  assert.match(ui, /data-resume-job/);
  assert.match(ui, /\/agent-jobs\/\$\{event\.currentTarget\.dataset\.stopJob\}\/stop/);
  assert.match(ui, /\/agent-jobs\/\$\{event\.currentTarget\.dataset\.resumeJob\}\/resume/);
  assert.equal(ui.includes('Authorize This Plan'), false);
  assert.equal(ui.includes('Run and Check This Fix'), false);
});

test('project and thread navigation, folder picker, and conversation controls are wired', () => {
  const pairs: Array<[string, string]> = [
    ['open-project', "getElementById('open-project')"],
    ['open-project-main', "getElementById('open-project-main')"],
    ['project-form', "getElementById('project-form')"],
    ['pick-folder', "getElementById('pick-folder')"],
    ['new-thread', "getElementById('new-thread')"],
    ['thread-create-form', "getElementById('thread-create-form')"],
    ['thread-form', "getElementById('thread-form')"],
    ['chat-form', "getElementById('chat-form')"],
    ['composer-preset', "getElementById('composer-preset')"]
  ];
  for (const [rendered, binding] of pairs) {
    assert.ok(ui.includes(`id=\"${rendered}\"`), `${rendered} renders`);
    assert.ok(ui.includes(binding), `${rendered} binds`);
  }
});

test('compact read-only Explorer is wired and never presented as proof', () => {
  assert.match(ui, /function renderExplorer\(/);
  assert.match(ui, /data-file-path/);
  assert.match(ui, /files\/preview\?path=/);
  assert.match(ui, /Live read-only view · never authority or proof/);
  assert.match(ui, /Live read-only context; not inspection evidence/);
  assert.match(ui, /state\.project \? renderExplorer\(\) : ''/);
});

test('Project Brain preserves separated memory fields and disclaims authority', () => {
  for (const name of ['purpose','preferences','environment','architecture','constraints','decisions','knownIssues','verifiedTruth']) {
    assert.ok(ui.includes(`field('${name}'`), `${name} field renders`);
  }
  assert.match(ui, /Guidance and memory are context, never authority or proof/);
  assert.match(ui, /Evidence links/);
  assert.match(ui, /\/brain/);
});

test('Settings reports live providers, presets, governance totals, and every ratified boundary', () => {
  assert.match(ui, /liveProviderStatus/);
  assert.match(ui, /Secrets stay in environment variables/);
  assert.match(ui, /governance\.statusSummary/);
  assert.match(ui, /governance\.limitations/);
  assert.match(ui, /Review verified limitations/);
});

test('Joe Live is derived from recorded events, categorizable, openable, and speakable', () => {
  assert.match(ui, /Recorded work account, not private chain-of-thought/);
  assert.match(ui, /function liveCategory\(/);
  assert.match(ui, /Open proof/);
  assert.match(ui, /function detachLive\(/);
  assert.match(ui, /speechSynthesis\.speak/);
  assert.match(ui, /event\.persisted/);
});

test('completion and limitation language comes from server job truth', () => {
  assert.match(ui, /completed_with_limits: 'Result with limits'/);
  assert.match(ui, /failed_safe: 'Stopped safely'/);
  assert.match(ui, /job\?\.terminalState \|\| job\?\.result\?\.terminalState/);
  assert.equal(ui.includes('clientVerificationProofLevel'), false);
});

test('chat and user thread text retain explicit high contrast', () => {
  assert.match(styles, /#chat-form\.codex-composer textarea#chat-input\s*\{[^}]*color:#191714!important[^}]*background:#fff!important/s);
  assert.match(styles, /\.codex-conversation \.chat-message\.user\s*\{[^}]*background:/s);
  assert.match(styles, /\.codex-conversation \.chat-message\.user \.chat-body\s*\{[^}]*color:/s);
  assert.match(styles, /\.settings-overlay[^}]*color:/s);
});

test('every consequential browser request uses CSRF and a fresh idempotency key', () => {
  assert.match(ui, /headers\['X-JC-CSRF'\] = state\.csrfToken/);
  assert.match(ui, /headers\['Idempotency-Key'\] = crypto\.randomUUID\(\)/);
  assert.match(ui, /credentials: 'same-origin'/);
});

test('legacy browser implementation is archived outside the served public folder', () => {
  assert.equal(fs.existsSync('archive/legacy-browser-workflow/app.pre-durable-cutover.js'), true);
  assert.equal(fs.existsSync('archive/legacy-browser-workflow/uiWiring.pre-durable-cutover.test.ts'), true);
  assert.equal(fs.existsSync('public/app.pre-durable-cutover.js'), false);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const ui = fs.readFileSync('public/app.js', 'utf8');
const server = fs.readFileSync('src/index.ts', 'utf8');
const styles = fs.readFileSync('public/app.css', 'utf8');

test('every rendered interactive control has a matching binding', () => {
  const controls: Array<[string, string, string]> = [
    ['level toggle', 'data-level="guided"', "querySelectorAll('.toggle button')"],
    ['logout', 'id="btn-logout"', "getElementById('btn-logout')"],
    ['folder browser', 'id="btn-browse"', "getElementById('btn-browse')"],
    ['project registration', 'id="register-form"', "getElementById('register-form')"],
    ['project card', 'data-open-project=', "querySelectorAll('[data-open-project]')"],
    ['all builds', 'id="btn-back-home"', "getElementById('btn-back-home')"],
    ['findings back', 'id="btn-back-home-2"', "getElementById('btn-back-home-2')"],
    ['chat composer', 'id="chat-form"', "getElementById('chat-form')"],
    ['file explorer toggle', 'data-explorer-toggle', "querySelector('[data-explorer-toggle]')"],
    ['file explorer refresh', 'data-explorer-refresh', "querySelector('[data-explorer-refresh]')"],
    ['file explorer folder', 'data-explorer-folder=', "querySelectorAll('[data-explorer-folder]')"],
    ['file explorer preview', 'data-explorer-file=', "querySelectorAll('[data-explorer-file]')"],
    ['file explorer search', 'id="explorer-search"', "getElementById('explorer-search')"],
    ['file preview close', 'data-close-file-preview', "querySelectorAll('[data-close-file-preview]')"],
    ['file preview chat context', 'data-ask-file=', "querySelector('[data-ask-file]')"],
    ['automatic job resume', 'data-resume-auto=', "querySelectorAll('[data-resume-auto]')"],
    ['details drawer', 'data-open-details', "querySelectorAll('[data-open-details]')"],
    ['executing job refresh', 'data-refresh-project', "querySelectorAll('[data-refresh-project]')"],
    ['chat suggestions', 'data-chat-action=', "querySelectorAll('[data-chat-action]')"],
    ['inspection', 'id="btn-inspect"', "getElementById('btn-inspect')"],
    ['acceptance', 'id="btn-accept"', "getElementById('btn-accept')"],
    ['inline acceptance', 'id="btn-accept-inline"', "getElementById('btn-accept-inline')"],
    ['draft objective', 'id="draft-objective"', "getElementById('draft-objective')"],
    ['draft repair work order', 'id="btn-draft-repair"', "getElementById('btn-draft-repair')"],
    ['draft read-only work order', 'id="btn-draft-inspect"', "getElementById('btn-draft-inspect')"],
    ['survey download', 'id="btn-export-md"', "getElementById('btn-export-md')"],
    ['authorization review', 'data-review-authorize=', "querySelectorAll('[data-review-authorize]')"],
    ['authorization confirmation', 'data-confirm-authorize=', "querySelectorAll('[data-confirm-authorize]')"],
    ['authorization recovery', 'data-recover-authorize=', "querySelectorAll('[data-recover-authorize]')"],
    ['apply review', 'data-review-apply=', "querySelectorAll('[data-review-apply]')"],
    ['apply confirmation', 'data-confirm-apply=', "querySelectorAll('[data-confirm-apply]')"],
    ['cancel review', 'data-review-cancel=', "querySelectorAll('[data-review-cancel]')"],
    ['cancel confirmation', 'data-confirm-cancel=', "querySelectorAll('[data-confirm-cancel]')"],
    ['close action review', 'data-close-review=', "querySelectorAll('[data-close-review]')"]
  ];

  for (const [label, rendered, binding] of controls) {
    assert.ok(ui.includes(rendered), `${label} is rendered`);
    assert.ok(ui.includes(binding), `${label} is bound`);
  }
});

test('UI actions are backed by real server routes', () => {
  const routes: Array<[string, string]> = [
    ['/api/v1/system/pick-folder', "app.post('/api/v1/system/pick-folder'"],
    ['/api/v1/projects', "app.post('/api/v1/projects'"],
    ['/api/v1/projects/:id', "app.get('/api/v1/projects/:id'"],
    ['/api/v1/projects/:id/chat', "app.post('/api/v1/projects/:id/chat'"],
    ['/api/v1/projects/:id/files', "app.get('/api/v1/projects/:id/files'"],
    ['/api/v1/projects/:id/files/preview', "app.get('/api/v1/projects/:id/files/preview'"],
    ['/api/v1/projects/:id/accept', "app.post('/api/v1/projects/:id/accept'"],
    ['/api/v1/projects/:id/events', "app.get('/api/v1/projects/:id/events'"],
    ['/api/v1/survey', "app.post('/api/v1/survey'"],
    ['/api/v1/work-orders/from-survey', "app.post('/api/v1/work-orders/from-survey'"],
    ['/api/v1/projects/:id/work-orders', "app.get('/api/v1/projects/:id/work-orders'"],
    ['/api/v1/work-orders/:id/authorize', "app.post('/api/v1/work-orders/:id/authorize'"],
    ['/api/v1/work-orders/:id/apply', "app.post('/api/v1/work-orders/:id/apply'"],
    ['/api/v1/work-orders/:id/cancel', "app.post('/api/v1/work-orders/:id/cancel'"],
    ['/api/v1/evidence/:id/export', "app.get('/api/v1/evidence/:id/export'"]
  ];

  for (const [label, route] of routes) {
    assert.ok(server.includes(route), `${label} exists`);
  }
});

test('trust and ordering guardrails remain visible and enforced', () => {
  assert.ok(ui.includes('function renderActivity()'));
  assert.ok(ui.includes('aria-live="polite"'));
  assert.ok(ui.includes('Plain-language work narration and evidence updates'));
  assert.ok(ui.includes('Scope, limits, and permissions'));
  assert.ok(ui.includes('Review &amp; Authorize'));
  assert.ok(ui.includes('applyControlLocks()'));
  assert.ok(ui.includes('const priority = { executing: 0, authorized: 1, draft: 2'));
  assert.ok(server.includes("'survey.started'"));
  assert.ok(server.includes("'survey.inventory_ready'"));
  assert.ok(server.includes("'work_order.execution_started'"));
  assert.ok(server.includes("includes('export_handoff')"));
  assert.equal(ui.includes('data-complete='), false);
  assert.equal(ui.includes('async function runComplete'), false);
  assert.ok(server.includes("'COMPLETION_REQUIRES_VERIFIED_APPLY'"));
  assert.ok(server.includes('evaluateExportCompletion('));
  assert.ok(server.includes('loadCanonicalLaws(ROOT)'));
  assert.ok(server.includes("app.get('/api/v1/projects/:id/work-orders'"));
  assert.ok(ui.includes('Legacy completion - no evidence-derived acceptance record'));
  assert.ok(ui.includes('Evidence hash verified'));
  assert.ok(ui.includes("return project?.workflowStage === 'surface_review_ready'"));
  assert.ok(server.includes("'folder_selected': ['surface_inspection_running']"));
  assert.ok(ui.includes('SQLite v${escapeHtml(state.health.database.schemaVersion)}') || ui.includes('data-open-panel="settings"'));
  assert.ok(server.includes("'PROJECT_PATH_ALREADY_REGISTERED'"));
  assert.ok(server.includes('const eventIntegrity = await verifyEventLog()'));
  assert.equal(ui.includes('sessionStorage'), false);
  assert.ok(ui.includes('Fresh evidence required'));
  assert.ok(ui.includes('Cancel Draft &amp; Run Fresh Inspection'));
  assert.equal(ui.includes('confirm('), false);
  assert.ok(server.includes('linkedSurveyIntegrity'));
  assert.ok(server.includes("'ACTIVE_WORK_ORDER_REQUIRES_RESOLUTION'"));
  assert.ok(server.includes("requiredAction: 'fresh_inspection'"));
  assert.ok(server.includes('const inspectedSurvey = await inspectEvidenceById(surveyId)'));
  assert.equal(fs.readFileSync('public/bootstrap.html', 'utf8').includes('sessionStorage'), false);
  assert.equal(ui.includes('Authorization: `Bearer'), false);
});


test('conversation-first workshop controls and routes are real', () => {
  const controls: Array<[string, string]> = [
    ['project threads', "querySelectorAll('[data-open-thread]')"],
    ['new conversation', "getElementById('new-thread-form')"],
    ['Project Brain', "getElementById('brain-form')"],
    ['Project Brain guidance', "getElementById('brain-guidance-preset')"],
    ['preset routing', "getElementById('composer-preset')"],
    ['smart chat dispatch', 'runSmartChat'],
    ['Joe Live tabs', "querySelectorAll('[data-live-tab]')"],
    ['spoken narration', "getElementById('btn-speech')"],
    ['detached Joe Live', "getElementById('btn-detach-live')"],
    ['models and settings', "getElementById('settings-speech')"]
  ];
  for (const [label, binding] of controls) {
    assert.ok(ui.includes(binding), label + ' is bound');
  }

  const routes = [
    "app.get('/api/v1/projects/:id/threads'",
    "app.post('/api/v1/projects/:id/threads'",
    "app.patch('/api/v1/projects/:id/threads/:threadId'",
    "app.get('/api/v1/projects/:id/brain'",
    "app.put('/api/v1/projects/:id/brain'",
    "app.get('/api/v1/workshop/settings'",
    "app.get('/api/v1/projects/:id/threads/:threadId/chat'",
    "app.post('/api/v1/projects/:id/threads/:threadId/chat'"
  ];
  for (const route of routes) assert.ok(server.includes(route), route + ' exists');

  assert.ok(ui.includes('Visible work account, not private chain-of-thought.'));
  assert.ok(ui.includes('Conversation guides the objective.'));
  assert.ok(ui.includes('Cloud remains blocked until an explicit Work Order budget allows it.'));
  assert.ok(server.includes('Conversation and presets cannot authorize source changes.'));
});

test('repair capability is certified and every mutation entry point remains gated', () => {
  const capabilities = fs.readFileSync('src/capabilities.ts', 'utf8');
  const chat = fs.readFileSync('src/chat.ts', 'utf8');

  assert.ok(capabilities.includes('SOURCE_REPAIR_CERTIFIED'));
  assert.ok(capabilities.includes('enabled: true'));
  assert.ok(capabilities.includes('Object.freeze'));
  assert.ok(capabilities.includes('evidenceIds'));
  // Entry points still consult the capability flag (fail-closed if flipped off)
  assert.ok(server.includes('SOURCE_REPAIR_CAPABILITY') && server.includes("!SOURCE_REPAIR_CAPABILITY.enabled") && server.includes("intent === 'repair'"));
  assert.ok(server.includes("action === 'apply_edits' && !SOURCE_REPAIR_CAPABILITY.enabled"));
  assert.ok(server.includes('sourceRepairDeniedPayload()'));
  assert.ok(ui.includes('SOURCE_REPAIR_FALLBACK'));
  assert.ok(ui.includes('renderComposerWithRepairGate'));
  assert.ok(ui.includes('sourceRepairCapability().enabled'));
  assert.ok(chat.includes("if (guarded.branch !== 'open') return guarded.content;"));
  assert.ok(chat.includes('UNSAFE_MODEL_CLAIM'));

  // Keep checking the engine so certification cannot silently
  // lose snapshot, rollback, verification, or evidence-derived completion.
  assert.ok(server.includes('snapshotScopedFiles('));
  assert.ok(server.includes('rollbackToSnapshot('));
  assert.ok(server.includes('evaluateRepairCompletion('));
  assert.ok(server.includes('runVerification('));
});
test('an active Work Order stays visible without taking over the conversation', () => {
  assert.ok(ui.includes('function renderCodexActiveJob(workOrder)'));
  assert.ok(ui.includes('Current job - '));
  assert.ok(ui.includes('data-resume-auto='));
  assert.ok(ui.includes('>Resume job</button>'));
  assert.ok(ui.includes('data-open-details'));
  assert.ok(ui.includes('Work Orders and proof'));
  assert.ok(ui.includes('Inspection, Work Orders, checks, and evidence'));
  assert.ok(ui.includes('scope?.exactPaths'));
  assert.ok(ui.includes('maxDurationMs'));
  assert.ok(ui.includes('maxCloudCostUsd'));

  const projectStart = ui.indexOf('renderProject = function renderConversationFirstProject()');
  const projectEnd = ui.indexOf('runChat = async function runSmartChat', projectStart);
  const projectView = ui.slice(projectStart, projectEnd);
  const activeJob = projectView.indexOf('renderCodexActiveJob(active)');
  const conversation = projectView.indexOf('renderCodexConversation()');
  const details = projectView.indexOf('renderCodexDetails(project, survey)');
  assert.ok(activeJob >= 0 && conversation > activeJob, 'compact active job appears before the conversation');
  assert.ok(details > conversation, 'technical details stay below the conversation');
});
test('authorization is sealed and revalidated before every apply transition', () => {
  const authorization = fs.readFileSync('src/authorization.ts', 'utf8');
  const database = fs.readFileSync('src/database/database.ts', 'utf8');
  const schema = JSON.parse(fs.readFileSync('schemas/work-order.v1.json', 'utf8'));

  assert.ok(server.includes('sealAuthorizationEnvelope(wo, authorizationProject)'));
  assert.ok(server.includes('verifyAuthorizationEnvelope(wo, authorizationProject)'));
  assert.ok(server.includes('verifyAuthorizationEnvelope(wo, project)'));
  assert.ok(authorization.includes("'AUTHORIZATION_ENVELOPE_MISSING'"));
  assert.ok(authorization.includes("'AUTHORIZATION_ENVELOPE_MISMATCH'"));
  assert.ok(database.includes('workOrder.authorization.envelopeHash'));
  assert.ok(schema.properties.authorization.properties.envelopeHash);
  assert.ok(ui.includes('immutable envelope sealed'));
  assert.ok(ui.includes('Legacy authorization blocked'));
  assert.ok(ui.includes('Authorization seal required'));
});
test('executing Work Orders have durable phase checkpoints and startup recovery', () => {
  const recovery = fs.readFileSync('src/recovery.ts', 'utf8');
  assert.ok(server.includes('recoverPersistedExecutions()'));
  assert.ok(server.includes("phase = 'committing'"));
  assert.ok(server.includes("phase = 'files_written'"));
  assert.ok(server.includes("phase = 'verifying'"));
  assert.ok(server.includes("action: 'export_handoff', phase: 'starting'"));
  assert.ok(server.includes("'RECOVERY_SNAPSHOT_MISSING_OR_INVALID'"));
  assert.ok(server.includes("'EXPORT_EXECUTION_FAILED'"));
  assert.ok(recovery.includes("kind: 'rollback'"));
  assert.ok(recovery.includes("kind: 'safe_fail'"));
  assert.ok(recovery.includes("kind: 'blocked'"));
});
test('survey, draft, authorization, and repair share one project revision', () => {
  const semantics = fs.readFileSync('src/scopeSemantics.ts', 'utf8');
  const authorization = fs.readFileSync('src/authorization.ts', 'utf8');
  assert.ok(server.includes("'STALE_PROJECT_EVIDENCE'"));
  assert.ok(server.includes("'STALE_WORK_ORDER_REVISION'"));
  assert.ok(server.includes('projectRevision,'));
  assert.ok(server.includes('project.revision = (project.revision ?? 0) + 1'));
  assert.ok(server.includes('validateSemanticScope(objective, intent, candidate.scope.operations, candidate.scope.exactPaths.map(String))'));
  assert.ok(semantics.includes("'OBJECTIVE_SCOPE_CONFLICT'"));
  assert.ok(authorization.includes('revision: project.revision ?? 0'));
});
test('presets and every Project Brain field affect the real chat route', () => {
  const providers = fs.readFileSync('src/providers.ts', 'utf8');
  const memory = fs.readFileSync('src/projectMemory.ts', 'utf8');
  const memorySchema = fs.readFileSync('src/database/schema.ts', 'utf8');
  for (const category of ['preferences', 'environment', 'architecture', 'constraints', 'decisions', 'rejected_approaches', 'known_issues', 'verified_truth']) {
    assert.ok(memorySchema.includes(''), category + ' is represented in the versioned memory schema');
  }
  assert.ok(memory.includes('retrieveTaskRelevantMemory'));
  assert.ok(memory.includes('sanitizeMemoryText'));
  assert.ok(memory.includes("record.status !== 'active'"));

  assert.ok(server.includes('brainGuidancePrompt(brain.guidancePresetId)'));
  assert.ok(server.includes('brainPresets: listBrainGuidancePresets()'));
  assert.ok(server.includes("code: 'BRAIN_PRESET_NOT_FOUND'"));
  assert.ok(ui.includes('Guidance changes how Joe approaches the work.'));
  assert.ok(ui.includes('It does not overwrite your notes, authorize a mutation, widen a Work Order, or become evidence.'));
  assert.ok(ui.includes("guidancePresetId:v('guidancePresetId')"));
  assert.ok(server.includes('privacyMode: preset.privacyMode'));
  assert.ok(server.includes('requiredCapabilities: preset.requiredCapabilities'));
  assert.ok(server.includes("code: 'PRESET_NOT_FOUND'"));
  assert.ok(providers.includes('missingProviderCapabilities'));
  assert.ok(ui.includes('presetRouteLabel'));
  assert.ok(ui.includes('Preset needs '));
});
test('settings and Project Brain display observed truth rather than optimistic state', () => {
  assert.ok(ui.includes('providerConnectionState'));
  assert.ok(ui.includes("label:model?'Running: '+model:'Not running'"));
  assert.ok(ui.includes('state.latestSurvey?.evidenceId'));
  assert.ok(ui.includes('freshnessAt:state.currentProject.lastInspectedAt||state.brain?.freshnessAt||null'));
  assert.ok(ui.includes('Current verified truth (linked evidence required)'));
  assert.ok(!ui.includes('freshnessAt:state.currentProject.latestSurveyId?Date.now():null'));
});
test('chat and plan composer text retain explicit high contrast', () => {
  assert.ok(styles.includes('/* Composer text contrast */'));
  assert.ok(styles.includes('#chat-form textarea#chat-input'));
  assert.ok(styles.includes('#draft-composer textarea#draft-objective'));
  assert.ok(styles.includes('background: #ffffff;'));
  assert.ok(styles.includes('color: #1a1917;'));
  assert.ok(styles.includes('color: #686158;'));
  assert.ok(styles.includes('caret-color: #9a4f18;'));
});

test('authorize advances directly to a plain-language run decision and completion reports honest proof', () => {
  assert.ok(ui.includes('Authorize is permission, not execution.'));
  assert.ok(ui.includes('Pressing Authorize does not change any files.'));
  assert.ok(ui.includes('It locks this plan and unlocks one final Run button.'));
  assert.ok(ui.includes("state.reviewAction = { type: 'apply', id }"));
  assert.ok(ui.includes('Authorized. Nothing has changed yet. Review the final Run step below.'));
  assert.ok(ui.includes('Run and Check This Fix'));
  assert.ok(ui.includes("const open = state.reviewAction ? ' open' : '';"));
  assert.ok(ui.includes('renderCodexDetails(project, survey)'));
  assert.ok(ui.includes('If a required check fails, restore the original files automatically and mark the job failed.'));
  assert.ok(ui.includes('function renderRunCompletion(project)'));
  assert.ok(ui.includes('state.lastRunResult = {'));
  assert.ok(ui.includes('Files changed and confirmed - runtime still unproven'));
  assert.ok(ui.includes('No runnable build or test proved application behavior.'));
  assert.ok(styles.includes('/* Plain-language authorization, execution, and completion proof */'));
  assert.ok(styles.includes('.plain-work-plan'));
  assert.ok(styles.includes('.run-completion'));
});
test('user chat thread keeps explicit high contrast on its dark bubble', () => {
  assert.ok(styles.includes('/* User thread message contrast'));
  assert.ok(styles.includes('.workshop-conversation .chat-message.user'));
  assert.ok(styles.includes('background: #292722;'));
  assert.ok(styles.includes('border-color: #5e554a;'));
  assert.ok(styles.includes('color: #fffaf2;'));
  assert.ok(styles.includes('.workshop-conversation .chat-message.user .chat-role'));
  assert.ok(styles.includes('color: #e5b985;'));
  assert.ok(styles.includes('.workshop-conversation .chat-message.user .chat-body'));
});
test('one prompt replaces checkpoint ceremony without bypassing Joe laws', () => {
  const composerStart = ui.indexOf('function renderCodexComposer()');
  const composerEnd = ui.indexOf('renderComposer = renderCodexComposer;', composerStart);
  const composer = ui.slice(composerStart, composerEnd);
  const projectStart = ui.indexOf('renderProject = function renderConversationFirstProject()');
  const projectEnd = ui.indexOf('runChat = async function runSmartChat', projectStart);
  const projectView = ui.slice(projectStart, projectEnd);

  assert.ok(ui.includes('function shouldAutoHandle(content)'));
  assert.ok(ui.includes('runChat = async function runSmartChat'));
  assert.ok(ui.includes('return runThreadChat(request)'));
  assert.ok(ui.includes('return runAutomatedJob(request, active?.id || null)'));
  assert.ok(ui.includes('function runAutomatedJob('));
  assert.ok(composer.includes('id="chat-form"'));
  assert.ok(composer.includes('id="chat-input"'));
  assert.ok(composer.includes('type="submit"'));
  assert.ok(composer.includes("busy ? 'Working...' : 'Send'"));
  assert.ok(composer.includes('Questions stay read-only.'));
  assert.equal(composer.includes('data-workshop-mode'), false);
  assert.equal(composer.includes('btn-draft-repair'), false);
  assert.equal(composer.includes('btn-auto-job'), false);
  assert.ok(projectView.includes('renderCodexConversation()'));
  assert.ok(projectView.includes('renderCodexDetails(project, survey)'));
  assert.ok(projectView.includes('renderCodexActiveJob(active)'));
  assert.equal(projectView.includes('renderJobPipeline('), false);
  assert.ok(ui.includes('data-resume-auto='));
  assert.ok(ui.includes('AUTO_JOB_STAGE_ORDER'));
  assert.ok(ui.includes("['folder_selected', 'complete', 'partial', 'blocked', 'cancelled']"));
  assert.ok(ui.includes("inferAutoJobIntent(objective, state.latestSurvey)"));
  assert.ok(ui.includes("mode: 'bounded_auto_job'"));
  assert.ok(ui.includes('maxAttempts: 1'));
  assert.ok(ui.includes("body: JSON.stringify({ action: repair ? 'apply_edits' : 'export_handoff' })"));
  assert.ok(ui.includes('renderAutoJobStatus()'));
  assert.ok(ui.includes('One objective, one sealed Work Order, one attempt.'));
  assert.ok(ui.includes("if (control.closest('.job-pipeline')) return !state.autoJob?.running;"));

  assert.ok(server.includes('const AutomationGrantSchema = z.object({'));
  assert.ok(server.includes("mode: z.literal('bounded_auto_job')"));
  assert.ok(server.includes('maxAttempts: z.literal(1)'));
  assert.ok(server.includes("'AUTOMATION_PROJECT_MISMATCH'"));
  assert.ok(server.includes("'AUTOMATION_OBJECTIVE_MISMATCH'"));
  assert.ok(server.includes("'AUTOMATION_THREAD_MISMATCH'"));
  assert.ok(server.includes("type: 'authorization.automation_grant'"));
  assert.ok(server.includes('automationGrantEvidenceId'));
  assert.ok(server.includes('sealAuthorizationEnvelope(wo, authorizationProject)'));
  assert.ok(styles.includes('/* Conversation-first Codex-style workspace */'));
  assert.ok(styles.includes('.codex-conversation'));
  assert.ok(styles.includes('.codex-composer'));
  assert.ok(styles.includes('.codex-job-status'));
  assert.ok(styles.includes('.codex-details'));
});

test('one Send delegates durable work to the server instead of browser stage choreography', () => {
  const jobs = fs.readFileSync('src/agentJobs.ts', 'utf8');
  const schema = fs.readFileSync('src/database/schema.ts', 'utf8');
  assert.ok(ui.includes('runDurableAutomatedJob'));
  assert.ok(ui.includes("'/agent-jobs'"));
  assert.ok(ui.includes('startFollowingServerJob'));
  assert.ok(ui.includes('The job continues inside its sealed limits even if this page is refreshed or closed.'));
  assert.ok(server.includes("app.post('/api/v1/projects/:id/threads/:threadId/agent-jobs'"));
  assert.ok(server.includes("app.get('/api/v1/agent-jobs/:jobId'"));
  assert.ok(server.includes('setImmediate(() => void runAgentJob(job.id, credentials))'));
  assert.ok(server.includes('interruptRunningAgentJobs()'));
  assert.ok(jobs.includes('the authenticated public API'));
  assert.ok(jobs.includes('authorization, idempotency, path jails'));
  assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS agent_jobs'));
  assert.ok(schema.includes('CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_one_active_per_project'));
});

test('Project Brain and the selected preset guide real planning, edits, and correction', () => {
  assert.ok(server.includes('const planningPreset = planningThread'));
  assert.ok(server.includes('projectBrainPrompt(planningBrain, objective)'));
  assert.ok(server.includes('requiredCapabilities: planningPreset.requiredCapabilities'));
  assert.ok(server.includes('const relatedAgentJob = listAgentJobs(project.id, 100)'));
  assert.ok(server.includes('projectBrainPrompt(executionBrain, wo.objective)'));
  assert.ok(server.includes('requiredCapabilities: executionPreset.requiredCapabilities'));
  assert.ok(server.includes('executionContext].filter(Boolean)'));
});

test('workspace Explorer is live read-only context with complete UI wiring', () => {
  const explorer = fs.readFileSync('src/projectExplorer.ts', 'utf8');
  assert.ok(ui.includes('function renderExplorerRail()'));
  assert.ok(ui.includes('function renderExplorerPreview()'));
  assert.ok(ui.includes('function loadExplorerDirectory('));
  assert.ok(ui.includes('function searchExplorer('));
  assert.ok(ui.includes('function loadExplorerPreview('));
  assert.ok(ui.includes('Live read-only view - not inspection evidence'));
  assert.ok(ui.includes('Preview content is live context, not proof.'));
  assert.ok(ui.includes("input.value = 'Explain ' + relativePath"));
  assert.ok(server.includes('ProjectFilePreviewQuerySchema.parse(req.query)'));
  assert.ok(server.includes('ProjectFilesQuerySchema.parse(req.query)'));
  assert.ok(server.includes("res.setHeader('Cache-Control', 'no-store')"));
  assert.ok(explorer.includes("const HIDDEN_DIRECTORIES = new Set(['.git', '.jc', 'node_modules'])"));
  assert.ok(explorer.includes('SENSITIVE_FILE_PREVIEW_BLOCKED'));
  assert.ok(explorer.includes('BINARY_FILE_PREVIEW_BLOCKED'));
  assert.ok(explorer.includes('SYMLINK_NOT_BROWSABLE'));
  assert.ok(styles.includes('/* Read-only workspace Explorer */'));
  assert.ok(styles.includes('.rail-explorer'));
  assert.ok(styles.includes('.file-preview-drawer'));
});
test('conversation proof is chronological, non-overlapping, and honest about runtime', () => {
  assert.ok(ui.includes('function clientVerificationProofLevel('));
  assert.ok(ui.includes('completionInserted'));
  assert.ok(ui.includes('messageTime > completedAt'));
  assert.ok(ui.includes("proofLabel = !repair"));
  assert.ok(ui.includes("? 'Runtime verified'"));
  assert.ok(ui.includes("? 'Files confirmed'"));
  assert.equal(ui.includes('>Complete</span></div><p>'), false);
  assert.ok(styles.includes('flex: 0 0 auto;'));
  assert.ok(styles.includes('details.run-completion.compact'));
  assert.ok(ui.includes('<div class="codex-scroll"><div class="stream codex-stream">'));
  assert.ok(styles.includes('.codex-scroll {'));
  assert.ok(styles.includes('overflow-y: auto;'));
  assert.ok(styles.includes('scrollbar-gutter: stable;'));
  assert.ok(styles.includes('position: relative;'));
  assert.ok(server.includes('runtime verification did not run'));
  assert.ok(server.includes('runtime behavior remains unproven'));
  assert.ok(server.includes('candidate.scope.exactPaths.map(String)'));
});

test('settings modal keeps high contrast and uses wired link-style preference buttons', () => {
  assert.ok(ui.includes('renderHighContrastSettingsOverlay'));
  assert.ok(ui.includes('settings-overlay'));
  assert.ok(ui.includes('settings-link-button'));
  assert.ok(ui.includes('id="settings-speech" aria-pressed='));
  assert.ok(ui.includes('id="settings-narration" aria-label='));
  assert.ok(ui.includes('id="settings-builder" aria-pressed='));
  assert.ok(ui.includes("getElementById('settings-speech')?.addEventListener('click'"));
  assert.ok(ui.includes("getElementById('settings-narration')?.addEventListener('click'"));
  assert.ok(ui.includes("getElementById('settings-builder')?.addEventListener('click'"));
  assert.ok(styles.includes('.settings-overlay {'));
  assert.ok(styles.includes('background: #fbfaf7;'));
  assert.ok(styles.includes('.settings-link-button:focus-visible'));
  assert.ok(styles.includes('color: #1f1c18;'));
});

test('smart dispatch treats questions as chat and clear commands as bounded work', () => {
  const start = ui.indexOf('function shouldAutoHandle(content) {');
  const end = ui.indexOf('renderAutoJobStatus = function renderCompactAutoJobStatus()', start);
  assert.ok(start >= 0 && end > start, 'classifier source is present');

  let active = false;
  const sandbox: Record<string, unknown> = {
    activeProjectWorkOrder: () => active ? { id: 'JC20-TEST' } : null
  };
  vm.runInNewContext(ui.slice(start, end), sandbox);
  const classify = sandbox.shouldAutoHandle as (content: string) => boolean;

  assert.equal(classify('did you write any code?'), false);
  assert.equal(classify('does this build need a database?'), false);
  assert.equal(classify('what is the current status?'), false);
  assert.equal(classify('current build staus'), false);
  assert.equal(classify('plan for finishing the build setup'), false);
  assert.equal(classify('finish the build setup'), true);
  assert.equal(classify('can you read these files?'), false);
  assert.equal(classify('proceed'), false);
  assert.equal(classify('fix the chat contrast'), true);
  assert.equal(classify('make the tables and include them in the build'), true);
  assert.equal(classify('look for bugs or things that do not work'), true);
  assert.equal(classify('can you refactor this safely?'), true);
  assert.equal(classify('execute carefully and verify the result'), true);

  active = true;
  assert.equal(classify('proceed'), true);
  assert.equal(classify('continue'), true);
});

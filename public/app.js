/**
 * JoeCoder Pro 20.1 — durable-agent-only browser client.
 * The browser presents conversation and recorded state. It never owns or invokes
 * inspection, planning, authorization, mutation, verification, or completion.
 */

const state = {
  csrfToken: null,
  sessionId: null,
  projects: [],
  project: null,
  threads: [],
  thread: null,
  messages: [],
  settings: null,
  brain: null,
  files: { path: '', entries: [], query: '', expanded: new Map() },
  events: [],
  job: null,
  workOrders: [],
  panel: null,
  // 'automatic' was renamed to 'build' so the label states what the mode actually grants.
  // Migrate any stored preference rather than silently falling back to a read-only mode.
  mode: (localStorage.getItem('jc_mode') === 'automatic' ? 'build' : localStorage.getItem('jc_mode')) || 'build',
  liveTab: localStorage.getItem('jc_live_tab') || 'live',
  speech: localStorage.getItem('jc_speech') === '1',
  narration: localStorage.getItem('jc_narration') || 'normal',
  railCollapsed: localStorage.getItem('jc_rail_collapsed') === '1',
  busy: false,
  error: null,
  notice: null
};

const RAIL_MIN = 180;
const RAIL_MAX = 480;
const RAIL_DEFAULT = 272;

// Persisted rail width. Applied to the documentElement so the #layout grid template
// (grid-template-columns: var(--rail-w) ...) picks it up without a re-render.
function applyRailWidth(px) {
  const width = Math.max(RAIL_MIN, Math.min(RAIL_MAX, Math.round(px)));
  document.documentElement.style.setProperty('--rail-w', `${width}px`);
  localStorage.setItem('jc_rail_w', String(width));
  const handle = document.getElementById('rail-resizer');
  if (handle) {
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} pixels`);
  }
  return width;
}

function currentRailWidth() {
  const declared = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-w'), 10);
  return Number.isFinite(declared) ? declared : RAIL_DEFAULT;
}

// Drag handle for the rail width. role="separator" with aria-orientation/valuenow is the
// accessible pattern for a split pane; it is focusable and driven by arrow keys as well as
// the pointer, because every interactive control needs a keyboard path.
function renderRailResizer() {
  if (state.railCollapsed) return '';
  return `<div id="rail-resizer" role="separator" aria-orientation="vertical" tabindex="0"
    aria-label="Resize projects panel"
    aria-valuemin="${RAIL_MIN}" aria-valuemax="${RAIL_MAX}" aria-valuenow="${currentRailWidth()}"
    title="Drag to resize · double-click to reset"></div>`;
}

function restoreRailWidth() {
  const saved = Number(localStorage.getItem('jc_rail_w'));
  if (Number.isFinite(saved) && saved >= RAIL_MIN && saved <= RAIL_MAX) {
    document.documentElement.style.setProperty('--rail-w', `${saved}px`);
  }
}

let pollTimer = null;
let lastEventOrdinal = -1;
let detachedLive = null;

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && path !== '/api/v1/session/exchange') {
    if (!state.csrfToken) throw new Error('The secure local session is not ready.');
    headers['X-JC-CSRF'] = state.csrfToken;
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
  let response;
  try {
    response = await fetch(path, { ...options, method, headers, credentials: 'same-origin', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    state.csrfToken = null;
    state.sessionId = null;
    throw Object.assign(new Error('The local session ended. Restart JoeCoder to open a fresh secure window.'), { code: 'SESSION_REQUIRED' });
  }
  if (!response.ok) throw Object.assign(new Error(data.error || data.message || `Request failed (${response.status}).`), { code: data.code, data });
  return data;
}

function setFeedback(kind, message) {
  state.error = kind === 'error' ? String(message) : null;
  state.notice = kind === 'notice' ? String(message) : null;
  render();
}

function projectLabel(project) {
  const map = {
    folder_selected: 'Ready to inspect', surface_inspection_running: 'Inspecting', surface_review_ready: 'Ready for work',
    project_accepted: 'Planning', work_order_draft: 'Plan protected', awaiting_approval: 'Protecting', approved: 'Ready to run',
    executing: 'Working', complete: 'Verified work recorded', partial: 'Result has limits', blocked: 'Needs attention', cancelled: 'Stopped'
  };
  return map[project?.workflowStage] || 'Ready';
}

function terminalLabel(job) {
  const terminal = job?.terminalState || job?.result?.terminalState;
  return ({ completed: 'Verified result', completed_with_limits: 'Result with limits', blocked_for_user: 'Needs you', failed_safe: 'Stopped safely', cancelled: 'Stopped', interrupted: 'Interrupted safely' })[terminal] || projectLabel(state.project);
}

function currentPreset() {
  const presets = state.settings?.presets || [];
  return presets.find(item => item.id === state.thread?.presetId) || presets[0] || { id: 'preset-auto', name: 'Auto' };
}

function isWorkRequest(text) {
  const value = String(text).trim().toLowerCase();
  const change = /\b(fix|repair|change|update|refactor|redesign|replace|remove|add|implement|improve|finish|complete|wire|connect|correct|debug|resolve|build|create|scaffold|code|develop|edit|modify|install|upgrade|migrate|configure|set up|setup|optimi[sz]e|clean up|make)\b/;
  const inspect = /^(inspect|review|audit|analy[sz]e|assess|survey|investigate|diagnose|report|find bugs|look for bugs|check (the )?(build|app|site|code|tests?|wiring|ui|files?))\b/;
  const question = /^(what|why|how|does|is|are|can|could|would|explain)\b/;
  return !question.test(value) && (change.test(value) || inspect.test(value));
}

function renderSessionGate() {
  return `<main class="session-gate"><section><div class="eyebrow">JoeCoder Pro 20.1</div><h1>Secure local session needed</h1><p>JoeCoder normally opens this page for you with a one-time local session. Close this tab and start JoeCoder again; the correct browser window will open automatically.</p><button type="button" id="retry-session">Check again</button></section></main>`;
}

function renderHeader() {
  const provider = state.settings?.liveProviderStatus?.localModel || 'model unavailable';
  return `<header id="topbar"><button class="icon-btn" id="toggle-rail" aria-label="Toggle projects">☰</button><strong>JoeCoder <span>PRO 20.1</span></strong><span>/</span><span>${escapeHtml(state.project?.name || 'Choose a project')}</span>${state.thread ? `<span>/</span><span>${escapeHtml(state.thread.title)}</span>` : ''}<span class="status-pill ${state.job?.status === 'running' ? 'working' : ''}">${escapeHtml(state.job?.status === 'running' ? 'Working' : terminalLabel(state.job))}</span><span>Automatic guardrails</span><span>${escapeHtml(provider)} · local</span><div class="topbar-spacer"></div><button id="toggle-live">Joe Live</button><button class="link-button" id="logout">End session</button></header>`;
}

function renderRail() {
  const projects = state.projects.map(project => `<div class="rail-project-group ${project.id === state.project?.id ? 'active' : ''}"><button class="rail-project" data-project="${escapeHtml(project.id)}"><span class="rail-project-mark">${escapeHtml(project.name.slice(0, 1).toUpperCase())}</span><span class="rail-item-label"><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(projectLabel(project))}</small></span></button>${project.id === state.project?.id ? `<div class="rail-threads">${state.threads.map(thread => `<button class="rail-thread ${thread.id === state.thread?.id ? 'current' : ''}" data-thread="${escapeHtml(thread.id)}"><span>#</span><span>${escapeHtml(thread.title)}</span></button>`).join('')}<button class="rail-thread" id="new-thread"><span>+</span><span>New conversation</span></button></div>` : ''}</div>`).join('');
  return `<aside id="rail" class="${state.railCollapsed ? 'collapsed' : ''}"><div class="workshop-rail-scroll"><button class="rail-open-project" id="open-project">+ Open build folder</button><h3>Projects &amp; conversations</h3>${projects || '<p class="rail-empty">Open a build folder to begin.</p>'}<h3>Job presets</h3>${(state.settings?.presets || []).map(preset => `<button class="rail-preset ${preset.id === currentPreset().id ? 'current' : ''}" data-preset="${escapeHtml(preset.id)}"><span>◇</span><span>${escapeHtml(preset.name)}</span></button>`).join('')}${state.project ? renderExplorer() : ''}</div><div class="rail-footer">${state.project ? '<button class="rail-footer-button" data-panel="brain"><span>◉</span><span class="rail-item-label">Project Brain</span></button>' : ''}<button class="rail-footer-button" data-panel="settings"><span>⚙</span><span class="rail-item-label">Models &amp; settings</span></button></div></aside>`;
}

function renderMessage(message) {
  const role = message.role === 'user' ? 'user' : 'assistant';
  const body = escapeHtml(message.content || message.text || '').replace(/\n/g, '<br>');
  return `<article class="chat-message ${role}"><div class="chat-role">${role === 'user' ? 'You' : 'Joe'}</div><div class="chat-body">${body}</div></article>`;
}

function renderJob() {
  const job = state.job;
  if (!job) return '';
  const running = ['queued', 'running'].includes(job.status);
  const interrupted = job.status === 'interrupted';
  const failed = ['failed', 'cancelled'].includes(job.status);
  const phase = ({ understand: 'Understanding the request', inspect: 'Inspecting without changes', plan: 'Planning the smallest coherent job', authorize: 'Protecting the exact boundary', run: 'Changing protected files', verify: 'Checking the result', complete: 'Recording the result', blocked: 'Stopped at a safety boundary' })[job.stage] || terminalLabel(job);
  const result = job.result || {};
  const files = (result.applied || []).map(item => item.relPath || item.path).filter(Boolean);
  return `<section class="automatic-job-card ${failed ? 'failed' : ''}" aria-live="polite"><div class="automatic-job-head"><div><span class="activity-dot"></span><strong>${escapeHtml(phase)}</strong></div><span>${escapeHtml(job.status)}</span></div><p class="automatic-job-objective">${escapeHtml(job.objective)}</p><div class="automatic-job-account"><div><b>Doing now</b><span>${escapeHtml(job.errorMessage || job.message || phase)}</span></div>${files.length ? `<div><b>Files touched</b><span>${files.map(escapeHtml).join(', ')}</span></div>` : ''}<div><b>Boundary</b><span>One request, one sealed job, reversible writes, evidence-gated result.</span></div></div><div class="automatic-job-actions">${running ? `<button class="secondary danger-link" data-stop-job="${escapeHtml(job.id)}">Stop</button>` : ''}${interrupted ? `<button data-resume-job="${escapeHtml(job.id)}">Resume</button>` : ''}</div></section>`;
}

function renderProof() {
  if (!state.project) return '';
  const survey = state.project.latestSurveyId ? `<a href="/api/v1/evidence/${encodeURIComponent(state.project.latestSurveyId)}" target="_blank" rel="noopener">Open latest inspection evidence</a>` : '<span>No inspection evidence recorded yet.</span>';
  const orders = state.workOrders.slice().reverse().slice(0, 6).map(order => `<article><strong>${escapeHtml(order.id)}</strong><span>${escapeHtml(order.status)} · ${escapeHtml(order.objective)}</span>${(order.evidenceIds || []).map(id => `<a href="/api/v1/evidence/${encodeURIComponent(id)}" target="_blank" rel="noopener">Evidence ${escapeHtml(id)}</a>`).join('')}</article>`).join('');
  return `<details class="codex-details"><summary>Project details and proof <small>Read-only</small></summary><div class="codex-details-body"><section><h3>Current truth</h3><p>${survey}</p><p>Build condition: ${escapeHtml(state.project.buildCondition || 'unknown')}</p></section><section><h3>Recorded jobs</h3>${orders || '<p>No recorded work yet.</p>'}</section></div></details>`;
}

function renderComposer() {
  const running = ['queued', 'running'].includes(state.job?.status);
  const modeHelp = state.mode === 'build'
    ? (running ? 'Joe is working. Stop before replacing the objective.' : 'Build is the permission to change code. Sending starts one bounded job.')
    : state.mode === 'ask' ? 'Ask replies in text only. No plan, no job, no changes.' : 'Plan replies and writes a detailed plan of action. No changes.';
  return `<div class="codex-composer-dock"><form id="chat-form" class="codex-composer"><div class="codex-composer-tools"><button type="button" class="attach-context" data-panel="brain" aria-label="Open Project Brain">+</button><select id="composer-preset" aria-label="Job preset">${(state.settings?.presets || []).map(preset => `<option value="${escapeHtml(preset.id)}" ${preset.id === currentPreset().id ? 'selected' : ''}>${escapeHtml(preset.name)}</option>`).join('')}</select><span class="model-route">${escapeHtml(state.settings?.liveProviderStatus?.localModel || 'guarded local route')}</span><div class="agent-mode-switch">${[['build','Build'],['ask','Ask'],['plan','Plan']].map(([id,label]) => `<button type="button" class="${state.mode === id ? 'active' : ''}" data-mode="${id}">${label}</button>`).join('')}</div></div><textarea id="chat-input" rows="3" maxlength="4000" required placeholder="Ask Joe, or describe the outcome you want..."></textarea><div class="codex-composer-footer"><span>${escapeHtml(modeHelp)}</span><button class="codex-send" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Working…' : 'Send'}</button></div></form></div>`;
}

function renderMain() {
  if (!state.project) return `<main id="main" class="empty-state"><section><div class="eyebrow">JoeCoder Pro 20.1</div><h1>Open a build folder</h1><p>Joe will inspect it read-only. Then describe the outcome in ordinary language; Joe owns the protected work and evidence checks.</p><button id="open-project-main">Open build folder</button></section></main>`;
  return `<main id="main" class="project-view"><div class="codex-scroll"><section class="codex-stream"><header class="codex-project-head"><div><div class="conversation-kicker">${escapeHtml(state.project.name)}</div><h1>${escapeHtml(state.thread?.title || `${state.project.name} workspace`)}</h1><button class="objective-button" data-panel="thread">${escapeHtml(state.thread?.objective || 'Set a conversation objective')}</button></div><div class="codex-project-actions"><button data-panel="brain">Project Brain</button><button data-panel="details">Details</button></div></header><div class="codex-context"><span>${escapeHtml(state.project.buildCondition || 'needs inspection')}</span><span>${escapeHtml(projectLabel(state.project))}</span><span>${escapeHtml(currentPreset().name)} preset</span><span>${escapeHtml(state.job ? terminalLabel(state.job) : 'No active job')}</span></div>${state.error ? `<div class="banner error">${escapeHtml(state.error)}</div>` : ''}${state.notice ? `<div class="banner success">${escapeHtml(state.notice)}</div>` : ''}${renderJob()}<section class="codex-conversation"><div class="chat-messages">${state.messages.length ? state.messages.map(renderMessage).join('') : '<article class="chat-message assistant codex-intro"><div class="chat-role">Joe</div><div class="chat-body">Tell me what you want to understand, build, repair, or refine. Questions stay read-only. A clear work request in Automatic mode starts one bounded job.</div></article>'}</div></section>${renderProof()}</section></div>${renderComposer()}</main>`;
}
function liveCategory(event) {
  const text = `${event.kind || ''} ${event.type || ''} ${event.what || ''}`;
  if (/blocked|failed|cancel|needs|error/i.test(text)) return 'Needs you';
  if (event.stage === 'run' || /changed|wrote|applied|restored/i.test(text)) return 'Changed';
  if (event.stage === 'verify' || event.stage === 'complete' || /checked|verified|proof/i.test(text)) return 'Checked';
  if (event.stage === 'inspect' || /found|survey|inspect/i.test(text)) return 'Found';
  return 'Doing now';
}

function liveEntries() {
  const events = state.events.filter(event => event.persisted).reverse();
  if (state.liveTab === 'live') return events.slice(0, 30);
  const label = ({ found: 'Found', changed: 'Changed', checked: 'Checked', needs: 'Needs you' })[state.liveTab];
  return events.filter(event => liveCategory(event) === label).slice(0, 30);
}

function renderLiveBody() {
  const entries = liveEntries();
  return entries.length ? entries.map(event => `<article class="live-entry"><div class="live-entry-meta"><span class="live-category">${escapeHtml(liveCategory(event))}</span> ${event.ts || event.createdAt ? new Date(event.ts || event.createdAt).toLocaleTimeString() : 'Recorded'} ${event.evidenceId ? `<a href="/api/v1/evidence/${encodeURIComponent(event.evidenceId)}" target="_blank" rel="noopener">Open proof</a>` : ''}</div><div class="live-entry-title">${escapeHtml(event.what || event.type || 'Recorded update')}</div>${state.narration !== 'quiet' && event.meaning ? `<div class="live-entry-meaning">${escapeHtml(event.meaning)}</div>` : ''}${state.narration === 'detailed' && event.next ? `<div class="live-entry-next"><strong>Next:</strong> ${escapeHtml(event.next)}</div>` : ''}</article>`).join('') : '<div class="voice-empty">No recorded events in this category.</div>';
}

function renderLive() {
  if (!state.project) return '';
  return `<aside id="voice"><div class="voice-head live-head"><div><h3>Joe Live</h3><span class="voice-sub">Recorded work account, not private chain-of-thought.</span></div><button class="icon-btn" id="detach-live" aria-label="Open Joe Live window">↗</button></div><div class="live-controls"><button class="speech-toggle ${state.speech ? 'active' : ''}" id="speech-toggle">${state.speech ? 'Voice on' : 'Voice off'}</button><select id="narration-detail">${['quiet','normal','detailed'].map(value => `<option value="${value}" ${state.narration === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><nav class="live-tabs">${[['live','Live'],['found','Found'],['changed','Changed'],['checked','Checked'],['needs','Needs you']].map(([id,label]) => `<button data-live-tab="${id}" class="${state.liveTab === id ? 'active' : ''}">${label}</button>`).join('')}</nav><div class="voice-log">${renderLiveBody()}</div></aside>`;
}

// The guidance actually in force for a field, from the selected "How Joe should work" preset.
// An empty project field does not mean nothing applies -- the preset's guidance is injected whole
// on every job, unconditionally. Showing it as the placeholder makes that visible instead of
// presenting eight blank boxes that look unconfigured.
function activeGuidance(name) {
  const presets = state.settings?.brainPresets || [];
  const current = presets.find(preset => preset.id === state.brain?.guidancePresetId) || presets[0];
  return current?.guidance?.[name] || '';
}

function field(name, label, rows = 3, blockedReason = '') {
  const guidance = activeGuidance(name);
  if (blockedReason) {
    return `<label class="brain-field-blocked">${escapeHtml(label)}
      <textarea name="${name}" rows="${rows}" disabled placeholder="${escapeHtml(guidance)}" aria-describedby="${name}-blocked">${escapeHtml(state.brain?.[name] || '')}</textarea>
      <small id="${name}-blocked" class="field-blocked-reason">${escapeHtml(blockedReason)}</small></label>`;
  }
  return `<label>${escapeHtml(label)}
    <textarea name="${name}" rows="${rows}" placeholder="${escapeHtml(guidance)}">${escapeHtml(state.brain?.[name] || '')}</textarea>
    ${guidance ? '<small class="field-inherited">Preset guidance applies. Type here only to add project-specific facts on top.</small>' : ''}</label>`;
}

// The server rejects any Current verified truth text that is not backed by linked evidence and a
// freshness stamp (VERIFIED_TRUTH_REQUIRES_FRESH_EVIDENCE). That guard is correct -- a truth claim
// without evidence is precisely the false proof the laws forbid -- but the field was rendered as an
// ordinary editable box, so typing in it made Save fail with no explanation and silently lost the
// rest of the form. A control that cannot succeed must be disabled with a plain-language reason.
function verifiedTruthBlockedReason() {
  const hasEvidence = Boolean(state.brain?.evidenceIds?.length);
  const hasFreshness = state.brain?.freshnessAt != null;
  if (hasEvidence && hasFreshness) return '';
  return 'Locked until evidence is linked. Verified truth must cite recorded evidence with a freshness stamp, so Joe records it from a completed check rather than accepting typed claims.';
}

function renderGovernanceLimitations(governance) {
  const items = governance.limitations || [];
  const body = items.length
    ? items.map(item => `<article class="governance-limit"><strong>${escapeHtml(item.id)} · ${escapeHtml(item.title)}</strong><p>${escapeHtml(item.boundary)}</p><small>${escapeHtml(item.limitationId)}</small></article>`).join("")
    : `<p>No ratified limitations are recorded.</p>`;
  return `<details><summary>Review verified limitations</summary>${body}</details>`;
}

function renderPanel() {
  if (!state.panel) return '';
  const close = '<button class="overlay-close" data-close-panel aria-label="Close">×</button>';
  if (state.panel === 'project') return `<div class="overlay-backdrop"><section class="workshop-overlay">${close}<div class="overlay-kicker">Open build</div><h2>Select a local build folder</h2><form id="project-form"><label>Folder path<div class="path-row"><input name="path" id="project-path" required placeholder="D:\\Projects\\My App"><button type="button" id="pick-folder">Browse…</button></div></label><label>Name<input name="name" id="project-name" required maxlength="120"></label><div class="overlay-actions"><button type="button" class="secondary" data-close-panel>Cancel</button><button>Open and inspect</button></div></form></section></div>`;
  if (state.panel === 'new-thread') return `<div class="overlay-backdrop"><section class="workshop-overlay">${close}<h2>New conversation</h2><form id="thread-create-form"><label>Name<input name="title" required maxlength="100"></label><label>Objective<textarea name="objective" rows="4"></textarea></label><div class="overlay-actions"><button type="button" class="secondary" data-close-panel>Cancel</button><button>Create</button></div></form></section></div>`;
  if (state.panel === 'thread') return `<div class="overlay-backdrop"><section class="workshop-overlay">${close}<h2>Conversation objective</h2><form id="thread-form"><label>Name<input name="title" required value="${escapeHtml(state.thread?.title || '')}"></label><label>Objective<textarea name="objective" rows="6">${escapeHtml(state.thread?.objective || '')}</textarea></label><div class="overlay-actions"><button type="button" class="secondary" data-close-panel>Cancel</button><button>Save</button></div></form></section></div>`;
  if (state.panel === 'brain') return `<div class="overlay-backdrop"><section class="workshop-overlay overlay-wide">${close}<div class="overlay-kicker">Project-scoped memory</div><h2>Project Brain</h2><p class="muted">Guidance and memory are context, never authority or proof. Greyed text is the guidance already in force from the selected preset — it is sent on every job whether or not these boxes are filled. Anything you type is stored as project memory and layered on top.</p><form id="brain-form" class="brain-grid"><section class="brain-guidance-picker"><label>How Joe should work<select name="guidancePresetId">${(state.settings?.brainPresets || []).map(preset => `<option value="${escapeHtml(preset.id)}" ${preset.id === state.brain?.guidancePresetId ? 'selected' : ''}>${escapeHtml(preset.name)}</option>`).join('')}</select></label><p>Every preset keeps the same evidence, scope, permission, rollback, verification, and truth laws.</p></section>${field('purpose','Purpose')}${field('preferences','Your preferences')}${field('environment','Environment')}${field('architecture','Architecture',5)}${field('constraints','Constraints',4)}${field('decisions','Decisions and rejected approaches',5)}${field('knownIssues','Known issues',4)}${field('verifiedTruth','Current verified truth',5,verifiedTruthBlockedReason())}<div class="brain-proof"><strong>Evidence links</strong><span>${(state.brain?.evidenceIds || []).map(escapeHtml).join(', ') || 'No evidence explicitly linked yet'}</span></div><div class="overlay-actions"><button type="button" class="secondary" data-close-panel>Cancel</button><button>Save</button></div></form></section></div>`;
  if (state.panel === 'settings') { const governance = state.settings?.governance || {}; return `<div class="overlay-backdrop"><section class="workshop-overlay overlay-wide settings-overlay">${close}<div class="overlay-kicker">JoeCoder settings</div><h2>Models, privacy, and behavior</h2><div class="settings-section governance-truth"><h3>Governance truth</h3><p>${escapeHtml(governance.canonicalVersion || 'unavailable')} · ${escapeHtml(String(governance.statusSummary?.enforced || 0))} enforced · ${escapeHtml(String(governance.statusSummary?.partial || 0))} ratified boundaries · ${escapeHtml(String(governance.statusSummary?.missing || 0))} missing</p>${renderGovernanceLimitations(governance)}</div><div class="settings-section"><h3>Model connections</h3>${(state.settings?.providers || []).map(profile => `<div class="provider-row"><div><strong>${escapeHtml(profile.displayName)}</strong><span>${escapeHtml(profile.kind)} · ${escapeHtml(profile.defaultModel || 'automatic')}</span></div><span>${escapeHtml(profile.provider === 'ollama' ? (state.settings.liveProviderStatus?.localModel || 'Not running') : (profile.configured ? 'Ready' : `Set ${profile.secretEnvVar || 'provider key'}`))}</span></div>`).join('')}<p class="settings-rule">Secrets stay in environment variables. Cloud requires an explicit authorized budget.</p></div><div class="settings-section"><h3>Job presets</h3><div class="preset-grid">${(state.settings?.presets || []).map(preset => `<button class="preset-card" data-preset="${escapeHtml(preset.id)}"><strong>${escapeHtml(preset.name)}</strong><p>${escapeHtml(preset.description)}</p></button>`).join('')}</div></div><div class="overlay-actions"><button data-close-panel>Done</button></div></section></div>`; }
  if (state.panel === 'details') return `<div class="overlay-backdrop"><section class="workshop-overlay overlay-wide">${close}<h2>Project files and proof</h2>${renderExplorer()}${renderProof()}<div class="overlay-actions"><button data-close-panel>Done</button></div></section></div>`;
  if (state.panel?.startsWith('file:')) { const preview = state.panelPreview; return `<div class="overlay-backdrop"><section class="workshop-overlay overlay-wide">${close}<h2>${escapeHtml(preview?.path || 'File preview')}</h2><p class="muted">Live read-only context; not inspection evidence.</p><pre class="file-preview">${escapeHtml(preview?.content || '')}</pre></section></div>`; }
  return '';
}

function renderExplorer() {
  const entries = state.files.entries || [];
  return `<section class="rail-explorer"><div class="rail-section-title"><strong>Files</strong><span>${escapeHtml(state.project?.name || '')}</span></div><form id="file-search"><input name="q" value="${escapeHtml(state.files.query)}" placeholder="Find a file"></form><div class="explorer-tree">${entries.map(entry => `<button type="button" class="explorer-entry" data-file-path="${escapeHtml(entry.path)}" data-directory="${Boolean(entry.directory || entry.type === 'directory')}"><span>${entry.directory || entry.type === 'directory' ? '▸' : '•'}</span>${escapeHtml(entry.name || entry.path)}</button>`).join('') || '<p>No visible files.</p>'}</div><p class="explorer-boundary">Live read-only view · never authority or proof</p></section>`;
}

// The conversation must follow new messages. render() replaces the whole tree, so the scroll
// container is a brand-new element each time and starts at scrollTop 0 -- which left the latest
// message below the fold with the composer as the only thing in view. Nothing in this client ever
// scrolled the thread.
//
// Sticky only while the reader is already at the bottom: if they have scrolled up to read earlier
// context, a background job update must not yank them back down.
let stickToBottom = true;
const STICK_THRESHOLD_PX = 80;

function captureScrollIntent() {
  const scroll = document.querySelector('.codex-scroll');
  if (!scroll) return;
  stickToBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= STICK_THRESHOLD_PX;
}

function applyScrollIntent() {
  const scroll = document.querySelector('.codex-scroll');
  if (!scroll) return;
  if (stickToBottom) scroll.scrollTop = scroll.scrollHeight;
  scroll.addEventListener('scroll', captureScrollIntent, { passive: true });
}

function render() {
  const app = document.getElementById('app');
  if (!state.csrfToken) {
    app.innerHTML = renderSessionGate();
    document.getElementById('retry-session')?.addEventListener('click', boot);
    return;
  }
  captureScrollIntent();
  app.innerHTML = `${renderHeader()}<div id="layout" class="with-activity${state.railCollapsed ? ' rail-collapsed' : ''}">${renderRail()}${renderRailResizer()}${renderMain()}${renderLive()}</div>${renderPanel()}`;
  bind();
  applyScrollIntent();
  syncDetachedLive();
}

async function loadProjects() {
  const data = await api('/api/v1/projects');
  state.projects = data.projects || [];
}

async function loadProject(id, preferredThreadId) {
  stopPolling();
  state.busy = true;
  state.error = null;
  render();
  try {
    const [projectData, threadData, settings, brain, files, orders, events, jobs] = await Promise.all([
      api(`/api/v1/projects/${id}`), api(`/api/v1/projects/${id}/threads`), api('/api/v1/workshop/settings'),
      api(`/api/v1/projects/${id}/brain`), api(`/api/v1/projects/${id}/files`), api(`/api/v1/projects/${id}/work-orders`),
      api(`/api/v1/projects/${id}/events`), api(`/api/v1/projects/${id}/agent-jobs`)
    ]);
    state.project = projectData.project;
    state.settings = settings;
    state.brain = brain.brain;
    state.files = { path: '', entries: files.entries || files.results || [], query: '', expanded: new Map() };
    state.workOrders = orders.workOrders || [];
    state.events = (events.events || []).map(event => ({ ...event, persisted: true }));
    state.threads = threadData.threads || [];
    state.thread = state.threads.find(item => item.id === preferredThreadId) || state.threads.find(item => item.id === threadData.selectedThreadId) || state.threads[0] || null;
    state.job = jobs.activeJob || (jobs.jobs || [])[0] || null;
    if (state.thread) await loadMessages();
    if (state.job && ['queued', 'running'].includes(state.job.status)) startPolling();
  } catch (error) {
    state.error = error.message;
  } finally {
    state.busy = false;
    render();
  }
}

async function loadMessages() {
  if (!state.project || !state.thread) return;
  const data = await api(`/api/v1/projects/${state.project.id}/threads/${state.thread.id}/chat`);
  state.messages = data.messages || [];
}

async function refreshJob() {
  if (!state.job) return;
  const data = await api(`/api/v1/agent-jobs/${state.job.id}?after=${lastEventOrdinal}`);
  state.job = data.job;
  for (const event of data.events || []) {
    lastEventOrdinal = Math.max(lastEventOrdinal, Number(event.ordinal));
    const payload = event.payload || {};
    state.events.push({ ...event, ...payload, persisted: true });
    if (state.speech && event.what && 'speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(event.what));
  }
  if (!['queued', 'running'].includes(state.job.status)) {
    stopPolling();
    const projectData = await api(`/api/v1/projects/${state.project.id}`);
    state.project = projectData.project;
    await loadMessages();
  }
  render();
}

function startPolling() {
  stopPolling();
  const tick = async () => {
    try { await refreshJob(); } catch (error) { state.error = error.message; render(); }
    if (state.job && ['queued', 'running'].includes(state.job.status)) pollTimer = setTimeout(tick, 900);
  };
  pollTimer = setTimeout(tick, 300);
}

function stopPolling() { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; }

async function sendMessage(text) {
  if (!state.project || !state.thread) return;
  const content = String(text || '').trim();
  if (!content) return;
  state.busy = true;
  state.error = null;
  // The user just acted, so follow the conversation regardless of where they had scrolled.
  stickToBottom = true;
  render();
  try {
    // Build is the permission to change code, so in Build every send starts one bounded job.
    // This replaced an isWorkRequest() regex that guessed from wording: "make the login work"
    // started a job while "the login is broken" silently did not. The mode is the trigger now,
    // which is predictable and is what the server enforces.
    if (state.mode === 'build') {
      if (state.job && ['queued', 'running'].includes(state.job.status)) throw new Error('Joe is already handling the current job. Switch to Ask or Plan, or Stop it before replacing the objective.');
      await startJob(content);
    } else {
      const data = await api(`/api/v1/projects/${state.project.id}/threads/${state.thread.id}/chat`, { method: 'POST', body: JSON.stringify({ content, mode: state.mode }) });
      state.messages = data.messages || [];
    }
  } catch (error) {
    state.error = error.message;
  } finally {
    state.busy = false;
    render();
  }
}

async function startJob(objective) {
  // mode travels with the request; the server refuses anything but 'build' here.
  const data = await api(`/api/v1/projects/${state.project.id}/threads/${state.thread.id}/agent-jobs`, { method: 'POST', body: JSON.stringify({ objective, mode: state.mode }) });
  state.job = data.job;
  lastEventOrdinal = -1;
  startPolling();
}

async function chooseProject() {
  state.panel = 'project';
  render();
}

function bind() {
  document.getElementById('open-project')?.addEventListener('click', chooseProject);
  document.getElementById('open-project-main')?.addEventListener('click', chooseProject);
  document.querySelectorAll('[data-project]').forEach(button => button.addEventListener('click', () => loadProject(button.dataset.project)));
  document.querySelectorAll('[data-thread]').forEach(button => button.addEventListener('click', () => loadProject(state.project.id, button.dataset.thread)));
  document.getElementById('new-thread')?.addEventListener('click', () => { state.panel = 'new-thread'; render(); });
  document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => { state.panel = button.dataset.panel; render(); }));
  document.querySelectorAll('[data-close-panel]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); state.panel = null; render(); }));
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { state.mode = button.dataset.mode; localStorage.setItem('jc_mode', state.mode); render(); }));
  document.querySelectorAll('[data-live-tab]').forEach(button => button.addEventListener('click', () => { state.liveTab = button.dataset.liveTab; localStorage.setItem('jc_live_tab', state.liveTab); render(); }));
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', async () => { if (!state.project || !state.thread) return; const data = await api(`/api/v1/projects/${state.project.id}/threads/${state.thread.id}`, { method: 'PATCH', body: JSON.stringify({ presetId: button.dataset.preset }) }); state.thread = data.thread; state.panel = null; render(); }));
  document.getElementById('composer-preset')?.addEventListener('change', async event => { const data = await api(`/api/v1/projects/${state.project.id}/threads/${state.thread.id}`, { method: 'PATCH', body: JSON.stringify({ presetId: event.target.value }) }); state.thread = data.thread; render(); });
  document.getElementById('chat-form')?.addEventListener('submit', event => { event.preventDefault(); const input = document.getElementById('chat-input'); const value = input.value; input.value = ''; sendMessage(value); });
  document.getElementById('chat-input')?.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } });
  document.querySelector('[data-stop-job]')?.addEventListener('click', async event => { const data = await api(`/api/v1/agent-jobs/${event.currentTarget.dataset.stopJob}/stop`, { method: 'POST', body: '{}' }); state.job = data.job; render(); });
  document.querySelector('[data-resume-job]')?.addEventListener('click', async event => { const data = await api(`/api/v1/agent-jobs/${event.currentTarget.dataset.resumeJob}/resume`, { method: 'POST', body: '{}' }); state.job = data.job; startPolling(); render(); });
  document.getElementById('speech-toggle')?.addEventListener('click', () => { state.speech = !state.speech; localStorage.setItem('jc_speech', state.speech ? '1' : '0'); if (!state.speech) speechSynthesis?.cancel(); render(); });
  document.getElementById('narration-detail')?.addEventListener('change', event => { state.narration = event.target.value; localStorage.setItem('jc_narration', state.narration); render(); });
  document.getElementById('detach-live')?.addEventListener('click', detachLive);
  document.getElementById('logout')?.addEventListener('click', async () => { await api('/api/v1/session/logout', { method: 'POST', body: '{}' }).catch(() => {}); location.reload(); });
  document.getElementById('toggle-live')?.addEventListener('click', () => document.getElementById('voice')?.classList.toggle('hidden'));
  document.getElementById('project-form')?.addEventListener('submit', registerProject);
  document.getElementById('pick-folder')?.addEventListener('click', pickFolder);
  document.getElementById('thread-create-form')?.addEventListener('submit', createThread);
  document.getElementById('thread-form')?.addEventListener('submit', updateThread);
  document.getElementById('brain-form')?.addEventListener('submit', saveBrain);
  document.getElementById('file-search')?.addEventListener('submit', searchFiles);
  document.querySelectorAll('[data-file-path]').forEach(button => button.addEventListener('click', () => openFile(button.dataset.filePath, button.dataset.directory === 'true')));
  bindRailControls();
}

// The ☰ button rendered an aria-label but had no handler, and nothing ever applied
// .rail-collapsed / #rail.collapsed, so all that CSS was unreachable and the control was dead.
function bindRailControls() {
  document.getElementById('toggle-rail')?.addEventListener('click', () => {
    state.railCollapsed = !state.railCollapsed;
    localStorage.setItem('jc_rail_collapsed', state.railCollapsed ? '1' : '0');
    render();
  });

  const handle = document.getElementById('rail-resizer');
  if (!handle) return;

  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('resizing-rail');
    const onMove = moveEvent => applyRailWidth(moveEvent.clientX);
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.classList.remove('resizing-rail');
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  handle.addEventListener('keydown', event => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft') { event.preventDefault(); applyRailWidth(currentRailWidth() - step); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); applyRailWidth(currentRailWidth() + step); }
    else if (event.key === 'Home') { event.preventDefault(); applyRailWidth(RAIL_MIN); }
    else if (event.key === 'End') { event.preventDefault(); applyRailWidth(RAIL_MAX); }
  });

  handle.addEventListener('dblclick', () => applyRailWidth(RAIL_DEFAULT));
}

async function pickFolder() {
  try {
    const data = await api('/api/v1/system/pick-folder', { method: 'POST', body: '{}' , timeoutMs: 310000 });
    if (data.path) {
      document.getElementById('project-path').value = data.path;
      document.getElementById('project-name').value = data.path.split(/[\\/]/).filter(Boolean).pop() || 'Build';
    }
  } catch (error) { setFeedback('error', error.message); }
}

async function registerProject(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api('/api/v1/projects', { method: 'POST', body: JSON.stringify({ path: form.get('path'), name: form.get('name') }) });
    await loadProjects();
    state.panel = null;
    await loadProject(data.project.id);
    await startJob('Inspect this build read-only and report its current verified state.');
  } catch (error) {
    if (error.code === 'PROJECT_PATH_ALREADY_REGISTERED' && error.data?.projectId) { state.panel = null; return loadProject(error.data.projectId); }
    setFeedback('error', error.message);
  }
}

async function createThread(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = await api(`/api/v1/projects/${state.project.id}/threads`, { method: 'POST', body: JSON.stringify({ title: form.get('title'), objective: form.get('objective'), presetId: currentPreset().id }) });
  state.panel = null;
  await loadProject(state.project.id, data.thread.id);
}

async function updateThread(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = await api(`/api/v1/projects/${state.project.id}/threads/${state.thread.id}`, { method: 'PATCH', body: JSON.stringify({ title: form.get('title'), objective: form.get('objective') }) });
  state.thread = data.thread;
  state.panel = null;
  render();
}

async function saveBrain(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const keys = ['purpose','preferences','environment','architecture','constraints','decisions','knownIssues','verifiedTruth'];
  // freshnessAt is required by the strict server schema and owned by the record, not the form:
  // projectMemory grades a brain stale without it. Round-trip it like evidenceIds, or Save 400s.
  const body = {
    guidancePresetId: form.get('guidancePresetId'),
    evidenceIds: state.brain?.evidenceIds || [],
    freshnessAt: state.brain?.freshnessAt ?? null
  };
  for (const key of keys) body[key] = String(form.get(key) || '');
  const data = await api(`/api/v1/projects/${state.project.id}/brain`, { method: 'PUT', body: JSON.stringify(body) });
  state.brain = data.brain;
  state.panel = null;
  render();
}

async function searchFiles(event) {
  event.preventDefault();
  const query = String(new FormData(event.currentTarget).get('q') || '');
  const data = await api(`/api/v1/projects/${state.project.id}/files?q=${encodeURIComponent(query)}`);
  state.files = { ...state.files, query, entries: data.entries || data.results || [] };
  render();
}

async function openFile(filePath, directory) {
  if (directory) {
    const data = await api(`/api/v1/projects/${state.project.id}/files?path=${encodeURIComponent(filePath)}`);
    state.files = { ...state.files, path: filePath, entries: data.entries || data.results || [] };
    render();
    return;
  }
  const data = await api(`/api/v1/projects/${state.project.id}/files/preview?path=${encodeURIComponent(filePath)}`);
  state.panelPreview = data.preview;
  state.panel = `file:${filePath}`;
  render();
}

function detachLive() {
  if (!detachedLive || detachedLive.closed) detachedLive = window.open('', 'JoeCoderLive', 'width=440,height=760');
  syncDetachedLive();
}

function syncDetachedLive() {
  if (!detachedLive || detachedLive.closed) return;
  detachedLive.document.open();
  detachedLive.document.write(`<!doctype html><title>Joe Live</title><style>body{margin:0;padding:20px;background:#1e1d1a;color:#eee;font:14px system-ui}article{padding:12px 0;border-bottom:1px solid #403b34}.live-entry-meta{color:#bda98f;font-size:11px}.live-entry-title{font-weight:700;margin:5px 0}.live-entry-meaning,.live-entry-next{color:#c8c1b8}</style><h2>Joe Live</h2><p>Recorded work account, not private chain-of-thought.</p>${renderLiveBody()}`);
  detachedLive.document.close();
}

async function boot() {
  restoreRailWidth();
  try {
    const session = await api('/api/v1/session/status');
    state.csrfToken = session.csrfToken;
    state.sessionId = session.sessionId;
    const [settings] = await Promise.all([api('/api/v1/workshop/settings'), loadProjects()]);
    state.settings = settings;
    const remembered = localStorage.getItem('jc_project');
    const project = state.projects.find(item => item.id === remembered) || state.projects[0];
    if (project) { localStorage.setItem('jc_project', project.id); await loadProject(project.id); }
  } catch (error) {
    state.csrfToken = null;
    state.sessionId = null;
    state.error = error.message;
  }
  render();
}

boot();

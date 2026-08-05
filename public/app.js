/**
 * JoeCoder Pro 20.0 — conversation-first workshop shell.
 * Live APIs only. No mock features. Three surfaces: rail | stream | activity.
 * Every guardrail checkpoint renders in the page and is enforced server-side.
 */

const API = '';
const STAGES = [
  { id: 'choose', label: 'Choose Build' },
  { id: 'inspect', label: 'Inspect Build' },
  { id: 'review', label: 'Review Build' },
  { id: 'deep', label: 'Deep Inspection', inactive: true },
  { id: 'advice', label: 'Review Advice', inactive: true },
  { id: 'wo', label: 'Work Order' },
  { id: 'approval', label: 'Approval' },
  { id: 'complete', label: 'Run Authorized Work' },
  { id: 'check', label: 'Check Work', inactive: true },
  { id: 'reality', label: 'Reality Report', inactive: true },
  { id: 'github', label: 'GitHub', inactive: true },
  { id: 'handoff', label: 'Handoff', inactive: true }
];

const JOE_STATUS = {
  waiting: 'Waiting',
  inspecting: 'Inspecting',
  reviewing: 'Studying the Build',
  drafting: 'Writing Work Order',
  awaiting: 'Waiting for Approval',
  working: 'Working',
  blocked: 'Blocked',
  complete: 'Work Recorded'
};

const state = {
  csrfToken: null,
  sessionId: null,
  level: localStorage.getItem('jc_ui_level') || 'guided',
  railCollapsed: localStorage.getItem('jc_ui_rail') === '1',
  activityOpen: localStorage.getItem('jc_ui_activity') !== '0',
  composerMode: localStorage.getItem('jc_composer_mode') || 'automatic',
  projects: [],
  currentProject: null,
  latestSurvey: null,
  workOrders: [],
  events: [],
  messages: [],
  chatSuggestions: [],
  chatBusy: false,
  narration: null,
  health: null,
  joeStatus: 'waiting',
  stage: 'choose',
  error: null,
  notice: null,
  busy: false,
  reviewAction: null,
  lastRunResult: null,
  autoJob: null
};

let eventsTimer = null;
let eventsInFlight = false;
// Bumped whenever the user navigates away (back, logout, session loss, project
// open) so a slow in-flight operation cannot resurrect a screen the user left.
let viewEpoch = 0;

// ---------- API ----------
const API_TIMEOUT_MS = 30000;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const method = (opts.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && path !== '/api/v1/session/exchange') {
    if (!state.csrfToken) throw new Error('Secure session is not ready');
    headers['X-JC-CSRF'] = state.csrfToken;
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  const timeoutMs = opts.timeoutMs || API_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(API + path, { ...opts, headers, credentials: 'same-origin', signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`No response after ${Math.round(timeoutMs / 1000)} seconds. The service may be stalled — try again or check the terminal window.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    handleSessionLoss();
    const error = new Error(data.error || 'Session required or expired');
    error.code = data.code || 'SESSION_REQUIRED';
    error.details = data;
    throw error;
  }
  if (!res.ok) {
    const msg = data.error || data.message || `HTTP ${res.status}`;
    const error = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    error.code = data.code || null;
    error.details = data;
    error.recovery = data.recovery || data.nextStep || (data.capability && data.capability.nextStep) || null;
    error.httpStatus = res.status;
    throw error;
  }
  return data;
}

function formatError(err) {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;
  const parts = [];
  parts.push(err.message || String(err));
  if (err.code) parts.push('[' + err.code + ']');
  const recovery = err.recovery;
  if (typeof recovery === 'string' && recovery.trim()) parts.push(recovery.trim());
  else if (recovery && typeof recovery === 'object') {
    if (recovery.reason) parts.push(recovery.reason);
    if (Array.isArray(recovery.steps) && recovery.steps.length) parts.push(recovery.steps.join(' → '));
  }
  return parts.filter(Boolean).join(' — ');
}

function handleSessionLoss() {
  if (!state.csrfToken && !state.sessionId) return;
  viewEpoch += 1;
  stopEventsPoll();
  state.csrfToken = null;
  state.sessionId = null;
  state.currentProject = null;
  state.busy = false;
  state.chatBusy = false;
  state.error = 'Your session ended (idle or absolute time limit). Restart the JoeCoder service to print a fresh one-time bootstrap URL.';
  render();
}

async function loadSession() {
  try {
    const session = await api('/api/v1/session/status');
    state.csrfToken = session.csrfToken;
    state.sessionId = session.sessionId;
    return true;
  } catch {
    state.csrfToken = null;
    state.sessionId = null;
    return false;
  }
}

function deriveStage(project) {
  if (!project) return 'choose';
  const ws = project.workflowStage;
  if (ws === 'folder_selected') return 'inspect';
  if (ws === 'surface_review_ready' || ws === 'surface_inspection_running') return 'review';
  if (ws === 'project_accepted') return 'review';
  if (ws === 'work_order_draft' || ws === 'awaiting_approval') return 'wo';
  if (ws === 'approved' || ws === 'executing') return 'approval';
  if (ws === 'complete' || ws === 'partial' || ws === 'cancelled' || ws === 'blocked') return 'complete';
  return 'choose';
}

function canAcceptProject(project) {
  return project?.workflowStage === 'surface_review_ready';
}

function stageIndex(id) {
  return STAGES.filter(stage => !stage.inactive).findIndex(stage => stage.id === id);
}

function conditionLabel(c) {
  const map = {
    looks_healthy: 'Looks Healthy',
    partly_working: 'Partly Working',
    significant_problems: 'Significant Problems',
    cannot_assess: 'Cannot Assess',
    needs_inspection: 'Needs Inspection',
    unknown: 'Unknown'
  };
  return map[c] || c || 'Unknown';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setBusy(v, joe) {
  state.busy = v;
  if (joe) state.joeStatus = joe;
  else if (!v && state.joeStatus === 'inspecting') state.joeStatus = 'reviewing';
  else if (!v) state.joeStatus = state.currentProject ? 'waiting' : 'waiting';
}

function beginNarration(what, meaning, next) {
  state.narration = { ts: Date.now(), type: 'live', what, meaning, next };
}

function failNarration(error, next = 'Review the error before trying again.') {
  state.narration = {
    ts: Date.now(),
    type: 'blocked',
    what: 'I stopped because the current step could not finish safely.',
    meaning: String(error || 'Unknown problem'),
    next
  };
}

function activeProjectWorkOrder() {
  const activeId = state.currentProject?.activeWorkOrderId;
  return state.workOrders.find(wo => wo.id === activeId && ['draft', 'authorized', 'executing'].includes(wo.status));
}

// Controls that must stay usable while an operation runs, so a slow or stalled
// request can never trap the user on a frozen screen. None of them re-issue the
// in-flight request; they only navigate away or end the session.
const ESCAPE_CONTROL_IDS = ['btn-logout', 'btn-back-home', 'btn-back-home-2'];
function isEscapeControl(control) {
  if (ESCAPE_CONTROL_IDS.includes(control.id)) return true;
  if (control.closest('.toggle')) return true;
  // Never trap the user out of the current pipeline decision.
  if (control.closest('.job-pipeline')) return !state.autoJob?.running;
  return false;
}

function applyControlLocks() {
  if (!state.busy && !state.chatBusy) return;
  document.querySelectorAll('button, input, textarea, select').forEach(control => {
    if (isEscapeControl(control)) return;
    control.disabled = true;
  });
}

function showError(msg) {
  state.error = formatError(msg);
  state.notice = null;
  render();
}
function showNotice(msg) {
  state.notice = msg;
  state.error = null;
}
function clearMessages() {
  state.error = null;
  state.notice = null;
}

// ---------- Render ----------
function modelChip() {
  const m = state.health?.model;
  if (!m) return '<button type="button" class="nav-chip" data-open-panel="settings">Models &amp; settings</button>';
  return m.localModel
    ? `<button type="button" class="nav-chip" data-open-panel="settings" title="Local Ollama model"><span class="dot"></span>${escapeHtml(m.localModel)} · LOCAL</button>`
    : '<button type="button" class="nav-chip" data-open-panel="settings" title="Start Ollama to enable repair drafting">No model · open settings</button>';
}

function renderTopbar() {
  const p = state.currentProject;
  const joe = JOE_STATUS[state.joeStatus] || state.joeStatus;
  return `
    <div id="topbar">
      <div class="topbar-left">
        <button type="button" class="icon-btn" data-rail-toggle title="Toggle navigation" aria-label="Toggle navigation">☰</button>
        <div class="brand">JoeCoder</div>
        ${p ? `<span class="crumb">/</span><span class="crumb-project">${escapeHtml(p.name)}</span>` : ''}
      </div>
      <div class="topbar-mid">
        <span class="chip status-chip ${state.busy || state.chatBusy ? 'busy' : (state.csrfToken ? 'ok' : 'warn')}">
          <span class="dot"></span>${state.busy || state.chatBusy ? escapeHtml(joe) + '…' : (state.csrfToken ? escapeHtml(joe) : 'No session')}
        </span>
        ${p ? (p.permissions?.writeFiles ? '<button type="button" class="nav-chip" data-nav="permissions"><strong>Write enabled</strong></button>' : '<button type="button" class="nav-chip" data-nav="permissions">Read-only</button>') : ''}
        ${modelChip()}
        ${state.health?.database?.available ? `<button type="button" class="nav-chip builder-only" data-open-panel="settings">SQLite v${escapeHtml(state.health.database.schemaVersion)}</button>` : ''}
        ${state.health ? `<button type="button" class="nav-chip builder-only" data-open-panel="settings">v${escapeHtml(state.health.version || '20.0')}</button>` : ''}
      </div>
      <div class="topbar-right">
        ${p ? `<button type="button" class="icon-btn ${state.activityOpen ? 'active' : ''}" data-activity-toggle title="Toggle AI Activity panel">◧ Activity</button>` : ''}
        <div class="toggle">
          <button type="button" data-level="guided" class="${state.level === 'guided' ? 'active' : ''}">Guided</button>
          <button type="button" data-level="builder" class="${state.level === 'builder' ? 'active' : ''}">Builder</button>
        </div>
        ${state.csrfToken ? '<button type="button" class="secondary session-action" id="btn-logout">End session</button>' : ''}
      </div>
    </div>
  `;
}

function renderRail() {
  const activeStages = STAGES.filter(stage => !stage.inactive);
  const laterStages = STAGES.filter(stage => stage.inactive);
  const currentIdx = stageIndex(state.stage);
  const p = state.currentProject;
  const builds = state.projects.length
    ? state.projects.map(item => `
        <button type="button" class="rail-item ${p?.id === item.id ? 'current' : ''}" data-open-project="${escapeHtml(item.id)}" title="${escapeHtml(item.path)}">
          <span class="rail-item-dot condition-${escapeHtml(item.buildCondition || 'unknown')}"></span>
          <span class="rail-item-label">${escapeHtml(item.name)}</span>
        </button>
      `).join('')
    : '<div class="rail-empty">No builds yet</div>';

  return `
    <aside id="rail" class="${state.railCollapsed ? 'collapsed' : ''}">
      <div class="rail-scroll">
        ${p ? `<button type="button" class="rail-new" id="btn-back-home"><span class="rail-new-plus">+</span><span class="rail-item-label">New / all builds</span></button>` : ''}
        <h3>Builds</h3>
        <nav class="rail-builds">${builds}</nav>
        ${p ? `
          <h3>Job path</h3>
          ${activeStages.map((stage, index) => {
            const cls = index < currentIdx ? 'stage-btn done' : index === currentIdx ? 'stage-btn current' : 'stage-btn';
            const mark = index < currentIdx ? '✓' : String(index + 1);
            const target = stage.id === 'inspect' ? 'findings' : stage.id === 'wo' || stage.id === 'authorize' || stage.id === 'apply' ? 'work-orders' : stage.id === 'chat' || stage.id === 'plan' ? 'composer' : stage.id;
            return `<button type="button" class="${cls}" data-nav="${target}" ${index > currentIdx ? 'disabled' : ''}><span class="num">${mark}</span><span class="rail-item-label">${escapeHtml(stage.label)}</span></button>`;
          }).join('')}
        ` : ''}
        <details class="later-details">
          <summary class="later-heading">Later capabilities</summary>
          ${laterStages.map(stage => `
            <div class="stage unavailable" title="Not available in this build" aria-disabled="true">
              <span class="num">—</span><span class="rail-item-label">${escapeHtml(stage.label)}</span>
            </div>
          `).join('')}
          <div class="stage unavailable" title="Not available in this build" aria-disabled="true"><span class="num">—</span><span class="rail-item-label">Presets &amp; model router</span></div>
          <div class="stage unavailable" title="Not available in this build" aria-disabled="true"><span class="num">—</span><span class="rail-item-label">Cloud providers</span></div>
        </details>
      </div>
    </aside>
  `;
}

function renderVoice() {
  if (!state.currentProject) return '';
  const items = state.events.length
    ? state.events.slice().reverse().slice(0, 30).map(ev => `
        <div class="voice-item">
          <div class="when">${ev.ts ? new Date(ev.ts).toLocaleTimeString() : ''}${ev.evidenceId ? ` · Evidence ${escapeHtml(ev.evidenceId)}` : ''}</div>
          <div class="what">${escapeHtml(ev.what || ev.type || 'Update')}</div>
          ${ev.meaning ? `<div class="muted voice-meaning">${escapeHtml(ev.meaning)}</div>` : ''}
          ${ev.next ? `<div class="muted voice-next">Next: ${escapeHtml(ev.next)}</div>` : ''}
        </div>
      `).join('')
    : `<div class="voice-empty">I have not started narrating this job yet. Run Inspect Build and I will report what I find.</div>`;

  return `
    <aside id="voice" class="${state.activityOpen ? '' : 'hidden'}">
      <div class="voice-head">
        <h3>AI Activity</h3>
        <span class="voice-sub">What I am doing, what it means, and what comes next.</span>
      </div>
      ${renderActivity()}
      <div class="voice-log">${items}</div>
    </aside>
  `;
}

function renderHome() {
  const cards = state.projects.length
    ? state.projects.map(p => `
        <button type="button" class="card project-card" data-open-project="${escapeHtml(p.id)}">
          <div class="title">${escapeHtml(p.name)}</div>
          <div class="path">${escapeHtml(p.path)}</div>
          <div class="row project-card-badges">
            <span class="badge">${escapeHtml(p.workflowStage || 'folder_selected')}</span>
            <span class="badge condition-${escapeHtml(p.buildCondition || 'unknown')}">${escapeHtml(conditionLabel(p.buildCondition))}</span>
          </div>
          ${p.lastInspectedAt ? `<div class="muted project-card-when">Last inspected ${new Date(p.lastInspectedAt).toLocaleString()}</div>` : ''}
        </button>
      `).join('')
    : `<div class="empty-action"><p>No builds registered yet. Choose a folder to begin — Joe stays read-only until you authorize work.</p><button type="button" data-nav="register">Register a build folder</button></div>`;

  return `
    <div class="home-hero">
      <h1>What are we working on?</h1>
      <p class="muted">Point Joe at a build folder. Inspection stays read-only until you authorize a scoped work order.</p>
    </div>
    <div class="card home-register" id="home-register">
      <form id="register-form">
        <label>Project name</label>
        <input name="name" required placeholder="My App" />
        <label>Build folder</label>
        <div class="row folder-row">
          <input name="path" id="folder-path" required placeholder="Select a folder…" readonly />
          <button type="button" id="btn-browse" class="secondary">Browse…</button>
        </div>
        <p class="muted form-hint">Opens a real Windows folder window.</p>
        <label class="builder-only">Description (optional)</label>
        <input class="builder-only" name="description" placeholder="Plain-language description" />
        <div class="row">
          <button type="submit">Register Build Folder</button>
        </div>
      </form>
    </div>
    <div class="home-recent">
      <h2>Recent builds</h2>
      <div class="grid cols-2">${cards}</div>
    </div>
  `;
}

function renderActivity() {
  const recorded = state.events.length ? state.events[state.events.length - 1] : null;
  const item = state.narration || recorded || {
    what: 'I am ready for the next instruction.',
    meaning: 'No operation is running. The build remains read-only unless a work order explicitly allows otherwise.',
    next: 'Describe the outcome you want or choose the next guarded action.'
  };
  const working = state.busy || state.chatBusy;
  return `
    <section class="activity-card ${working ? 'working' : ''}" aria-live="polite" aria-atomic="true">
      <div class="activity-status">
        <span class="activity-dot"></span>
        <strong>${working ? 'Joe is working now' : 'Latest recorded update'}</strong>
        ${item.ts ? `<span>${new Date(item.ts).toLocaleTimeString()}</span>` : ''}
      </div>
      <div class="activity-what">${escapeHtml(item.what || 'Working on the current step.')}</div>
      ${item.meaning ? `<div class="activity-meaning">${escapeHtml(item.meaning)}</div>` : ''}
      ${item.next ? `<div class="activity-next"><strong>Next:</strong> ${escapeHtml(item.next)}</div>` : ''}
      <div class="activity-trust">Plain-language work narration and evidence updates — a useful progress account, not hidden private reasoning.</div>
    </section>
  `;
}
function renderChat() {
  const p = state.currentProject;
  if (!p) return '';
  const messages = state.messages.length ? state.messages.map(m => `
    <div class="chat-message ${m.role === 'user' ? 'user' : 'assistant'}">
      <div class="chat-role">${m.role === 'user' ? 'You' : 'Joe'}</div>
      <div class="chat-body">${escapeHtml(m.content)}</div>
    </div>
  `).join('') : `
    <div class="chat-message assistant">
      <div class="chat-role">Joe</div>
      <div class="chat-body">Tell me what you want to inspect, understand, build, or repair in ${escapeHtml(p.name)}. I will keep inspection read-only and require a scoped work order plus explicit authorization before any permitted change.</div>
    </div>
  `;
  return `
    <section class="chat-stream" aria-labelledby="chat-title">
      <h2 id="chat-title" class="visually-hidden">What should Joe do?</h2>
      <div id="chat-messages" class="chat-messages" aria-live="polite">${messages}</div>
    </section>
  `;
}

function draftEligibility() {
  const p = state.currentProject;
  if (!p) return { eligible: false, reason: 'No build selected.' };
  if (!p.latestSurveyId) return { eligible: false, reason: 'Inspect the build first so a survey exists.' };
  if (canAcceptProject(p)) return { eligible: false, reason: 'Accept the build for planning first.' };
  const active = activeProjectWorkOrder();
  if (active) return { eligible: false, reason: `Resolve active Work Order ${active.id} first.` };
  return { eligible: true, reason: '' };
}

function renderComposer() {
  const p = state.currentProject;
  if (!p) return '';
  const draft = draftEligibility();
  const mode = draft.eligible && state.composerMode === 'draft' ? 'draft' : 'ask';
  const suggestions = state.chatSuggestions.length ? `
    <div class="chat-suggestions">
      ${state.chatSuggestions.map(item => `<button type="button" class="chip-btn" data-chat-action="${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>`).join('')}
    </div>
  ` : '';

  const askPane = `
    <form id="chat-form" class="chat-composer ${mode === 'ask' ? '' : 'hidden'}">
      <textarea id="chat-input" name="content" rows="2" maxlength="4000" required placeholder="Ask Joe to inspect, explain, or plan — chat never grants permission" ${state.chatBusy ? 'disabled' : ''}></textarea>
      <div class="composer-row">
        <span class="composer-hint">${state.chatBusy ? 'Joe is responding…' : 'Enter to send · Shift+Enter for a new line'}</span>
        <button type="submit" class="send-btn" ${state.chatBusy ? 'disabled' : ''}>${state.chatBusy ? 'Responding…' : 'Send ↑'}</button>
      </div>
    </form>
  `;

  const draftPane = draft.eligible ? `
    <div id="draft-composer" class="draft-composer ${mode === 'draft' ? '' : 'hidden'}">
      <textarea id="draft-objective" rows="2" maxlength="500" placeholder="Describe the outcome. Example: Fix the crash when saving an empty note"></textarea>
      <div class="composer-row">
        <span class="composer-hint">${state.health?.model?.localModel ? `Plans with ${escapeHtml(state.health.model.localModel)} (local)` : 'No local model detected — repair drafting needs Ollama running.'}</span>
        <span class="composer-actions">
          <button type="button" class="secondary" id="btn-draft-inspect">Draft Read-Only Work Order</button>
          <button type="button" id="btn-draft-repair">Draft Repair Work Order</button>
          <button type="button" id="btn-draft-build" title="Greenfield build for empty or nearly empty folders">Draft Build Work Order</button>
        </span>
      </div>
      <p class="muted form-hint">A draft records scope and limits — it never authorizes anything by itself. Repair drafts ask the local model to plan the exact files first; you review that scope before authorizing.</p>
    </div>
  ` : '';

  return `
    <div class="composer-dock">
      ${suggestions}
      <div class="composer-card">
        <div class="composer-tabs" role="tablist">
          <button type="button" class="composer-tab ${mode === 'ask' ? 'active' : ''}" data-composer-mode="ask" role="tab" aria-selected="${mode === 'ask'}">Ask Joe</button>
          <button type="button" class="composer-tab ${mode === 'draft' ? 'active' : ''}" data-composer-mode="draft" role="tab" aria-selected="${mode === 'draft'}" ${draft.eligible ? '' : `disabled title="${escapeHtml(draft.reason)}"`}>Draft a Work Order</button>
          ${draft.eligible ? '' : `<span class="composer-locked">Draft locked — ${escapeHtml(draft.reason)}</span>`}
        </div>
        ${askPane}
        ${draftPane}
      </div>
      <p class="chat-guardrail">Read-only by default · scoped work order required · authorization stays separate · no silent scope expansion</p>
    </div>
  `;
}
function renderProject() {
  const p = state.currentProject;
  if (!p) return renderHome();
  const survey = state.latestSurvey;
  const findings = survey?.result?.findings || survey?.findings;
  const hasSurvey = !!(p.latestSurveyId || findings);
  const activeWO = activeProjectWorkOrder();

  return `
    <div class="stream">
      <header class="project-head">
        <div class="project-head-id">
          <h2>${escapeHtml(p.name)}</h2>
          <div class="path muted">${escapeHtml(p.path)}</div>
        </div>
        <div class="row project-head-badges">
          <span class="badge">${escapeHtml(p.workflowStage)}</span>
          <span class="badge condition-${escapeHtml(p.buildCondition || 'unknown')}">${escapeHtml(conditionLabel(p.buildCondition))}</span>
          ${p.lastInspectedAt ? `<span class="muted">Inspected ${new Date(p.lastInspectedAt).toLocaleString()}</span>` : ''}
        </div>
        <div class="row project-head-actions">
          <button type="button" id="btn-inspect">${hasSurvey ? 'Inspect Again' : 'Inspect Build'}${state.busy && state.joeStatus === 'inspecting' ? '…' : ''}</button>
          ${canAcceptProject(p)
            ? `<button type="button" class="secondary" id="btn-accept">Accept Build for Planning</button>` : ''}
          ${activeWO
            ? `<span class="active-work-note">Active: ${escapeHtml(activeWO.id)} · ${escapeHtml(activeWO.status)}</span>` : ''}
          ${survey?.evidenceId || p.latestSurveyId
            ? `<button type="button" class="secondary builder-only" id="btn-export-md">Download Survey Evidence</button>` : ''}
        </div>
      </header>

      ${state.busy && state.joeStatus === 'inspecting' ? `
        <div class="info-box"><span class="spinner"></span> Inspecting build folder (read-only). No files will be changed.</div>
      ` : ''}

      ${renderChat()}

      ${findings ? renderFindings(survey) : `
        <div class="card work-card">
          <h3>Surface review</h3>
          <p class="muted">No survey yet. Press <strong>Inspect Build</strong> for a safe, read-only surface inspection.</p>
        </div>
      `}

      <div class="card work-card" id="work-orders">
        <h3>Work Orders</h3>
        <p class="muted work-orders-note">Authorized work only. Apply currently supports export handoff under <code>.jc/exports/</code> — not source edits.</p>
        ${renderWOList()}
      </div>
    </div>
    ${renderComposer()}
  `;
}

function renderFindings(surveyPayload) {
  const r = surveyPayload.result || surveyPayload;
  const f = r.findings || { working: [], questionable: [], broken: [], mockOrPlaceholder: [], unknown: [] };
  const integrity = r._integrity || surveyPayload._integrity || null;
  const integrityBadge = integrity?.verified
    ? '<span class="badge ok">Evidence hash verified</span>'
    : '<span class="badge warn">Legacy evidence — no stored hash proof</span>';
  const section = (cls, title, items) => `
    <section class="${cls}">
      <h4>${title}</h4>
      ${items?.length ? `<ul>${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '<p class="muted">(none)</p>'}
    </section>`;

  return `
    <div class="card">
      <h3>What this build appears to be</h3>
      <p>${escapeHtml(r.packageSummary?.description || r.projectName || 'Surface identity only — product purpose not fully verified.')}</p>
      <div class="row" style="margin:0.75rem 0">
        <span class="badge condition-${escapeHtml(r.buildCondition || 'unknown')}">${escapeHtml(conditionLabel(r.buildCondition))}</span>
        <span class="badge">${escapeHtml(r.status || '')}</span>
        <span class="muted">${escapeHtml(r.projectType || '')}</span>
        <span class="muted builder-only">${r.summary ? `${r.summary.totalFiles || 0} files` : ''}</span>
        ${integrityBadge}
      </div>
      <div class="findings">
        ${section('working', 'Working', f.working)}
        ${section('questionable', 'Questionable', f.questionable)}
        ${section('broken', 'Broken / blocked', f.broken)}
        ${section('mock', 'Mock or placeholder', f.mockOrPlaceholder)}
        ${section('unknown', 'Unknown', f.unknown)}
      </div>
      <div class="row" style="margin-top:1rem">
        ${canAcceptProject(state.currentProject) ? `<button type="button" class="success" id="btn-accept-inline">Accept Build for Planning</button>` : `<span class="accepted-note">Build accepted · further actions stay governed by work orders</span>`}
        <button type="button" class="secondary" id="btn-back-home-2">Choose Another Build</button>
      </div>
      ${surveyPayload.overviewPath ? `<p class="muted builder-only" style="margin-top:0.75rem;font-size:0.8rem">Overview: ${escapeHtml(surveyPayload.overviewPath)}</p>` : ''}
      ${surveyPayload.evidenceId ? `<p class="muted builder-only" style="font-size:0.8rem">Evidence: ${escapeHtml(surveyPayload.evidenceId)}</p>` : ''}
    </div>
  `;
}

function renderWOList() {
  if (!state.workOrders.length) {
    return `<p class="muted">No work orders yet. Draft one from a survey when you are ready.</p>`;
  }
  const priority = { executing: 0, authorized: 1, draft: 2, completed: 3, failed: 4, rolled_back: 5, cancelled: 6 };
  const ordered = [...state.workOrders].sort((a, b) =>
    (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  );
  return `
    <div class="grid" style="margin-top:0.75rem">
      ${ordered.map(wo => {
        const isActive = state.currentProject?.activeWorkOrderId === wo.id && ['draft', 'authorized', 'executing'].includes(wo.status);
        const reviewType = state.reviewAction?.id === wo.id ? state.reviewAction.type : null;
        const surveyIntegrity = wo.linkedSurveyIntegrity || { verified: false, reason: 'Evidence readiness was not reported' };
        const evidenceReady = surveyIntegrity.verified === true;
        const evidenceStatus = evidenceReady
          ? '<span class="badge ok">Linked survey hash verified</span>'
          : `<span class="badge warn">Authorization blocked: ${escapeHtml(surveyIntegrity.reason)}</span>`;
        const isRepair = (wo.scope?.operations || []).includes('edit_files');
        const completionResults = wo.completion?.acceptanceResults?.length
          ? `<details class="scope-details" ${wo.status === 'rolled_back' || wo.status === 'failed' ? 'open' : ''}><summary>${wo.completion.passed ? 'Verified completion proof' : 'Completion checks (failed — change was rolled back)'}</summary>${wo.completion.acceptanceResults.map(result => `<div><span class="badge ${result.passed ? 'ok' : 'warn'}">${result.passed ? 'Passed' : 'Failed'}</span> ${escapeHtml(result.criterion)} - ${escapeHtml(result.detail)}</div>`).join('')}</details>`
          : '';
        const completionProof = wo.status === 'completed'
          ? (completionResults || '<div class="row"><span class="badge warn">Legacy completion - no evidence-derived acceptance record</span></div>')
          : (wo.status === 'rolled_back' || wo.status === 'failed')
            ? completionResults
            : '';
        const acceptanceChecks = (wo.acceptance || []).map(item =>
          `<li>${item.mandatory ? '<strong>Required:</strong> ' : ''}${escapeHtml(item.criterion)}</li>`
        ).join('');
        let actionReview = '';
        if (reviewType === 'authorize' && wo.status === 'draft') {
          actionReview = `
            <section class="action-review" aria-live="polite">
              <div class="eyebrow">Explicit authorization checkpoint</div>
              <h4>${evidenceReady ? 'Ready for your decision' : 'Fresh evidence required'}</h4>
              <div class="readiness ${evidenceReady ? 'ready' : 'blocked'}">${evidenceStatus}</div>
              <p>${evidenceReady
                ? 'Authorizing permits only the exact paths, operations, and limits shown above. It grants no source-file write permission.'
                : 'This draft is linked to legacy evidence without stored hash proof. Joe will not convert it into permission.'}</p>
              ${acceptanceChecks ? `<div><strong>Mandatory checks after execution:</strong><ul>${acceptanceChecks}</ul></div>` : ''}
              <div class="row">
                ${evidenceReady
                  ? `<button type="button" class="success" data-confirm-authorize="${escapeHtml(wo.id)}">Authorize This Exact Scope</button>`
                  : `<button type="button" data-recover-authorize="${escapeHtml(wo.id)}">Cancel Draft &amp; Run Fresh Inspection</button>`}
                <button type="button" class="secondary" data-close-review="${escapeHtml(wo.id)}">Back Without Authorizing</button>
              </div>
            </section>`;
        }
        if (reviewType === 'apply' && wo.status === 'authorized') {
          actionReview = isRepair ? `
            <section class="action-review" aria-live="polite">
              <div class="eyebrow">Execution checkpoint</div>
              <h4>Run the authorized repair?</h4>
              <p>Joe will snapshot every scoped file first, then write model-generated edits ONLY to the files listed above, within the declared budgets. The project's own build/test scripts verify the change; if verification fails, every file is restored from the snapshot automatically.</p>
              <div class="row">
                <button type="button" class="success" data-confirm-apply="${escapeHtml(wo.id)}">Run Authorized Repair</button>
                <button type="button" class="secondary" data-close-review="${escapeHtml(wo.id)}">Back Without Running</button>
              </div>
            </section>` : `
            <section class="action-review" aria-live="polite">
              <div class="eyebrow">Execution checkpoint</div>
              <h4>Run the authorized export?</h4>
              <p>Joe will write only beneath <code>.jc/exports/</code>. The source build remains read-only.</p>
              <div class="row">
                <button type="button" class="success" data-confirm-apply="${escapeHtml(wo.id)}">Run Authorized Export</button>
                <button type="button" class="secondary" data-close-review="${escapeHtml(wo.id)}">Back Without Running</button>
              </div>
            </section>`;
        }
        if (reviewType === 'cancel' && (wo.status === 'draft' || wo.status === 'authorized')) {
          actionReview = `
            <section class="action-review danger-review" aria-live="polite">
              <div class="eyebrow">Cancellation checkpoint</div>
              <h4>Cancel ${escapeHtml(wo.id)}?</h4>
              <p>This ends its authorization and releases the active Work Order slot. It does not change source files.</p>
              <div class="row">
                <button type="button" class="danger" data-confirm-cancel="${escapeHtml(wo.id)}">Cancel Work Order</button>
                <button type="button" class="secondary" data-close-review="${escapeHtml(wo.id)}">Keep Work Order</button>
              </div>
            </section>`;
        }
        return `
        <div class="card work-order-card ${isActive ? 'active' : ''}" style="margin:0;padding:0.85rem">
          <div class="row" style="justify-content:space-between">
            <strong>${escapeHtml(wo.id)}</strong>
            <span class="row">
              ${isActive ? '<span class="badge ok">Active</span>' : ''}
              <span class="badge">${escapeHtml(wo.status)}</span>
            </span>
          </div>
          <div style="margin:0.45rem 0">${escapeHtml(wo.objective)}</div>
          <details class="scope-details" ${(wo.status === 'draft' || reviewType) ? 'open' : ''}>
            <summary>Scope, limits, and permissions</summary>
            <div><strong>Paths:</strong> ${(wo.scope?.exactPaths || []).map(escapeHtml).join(', ') || 'None declared'}</div>
            <div><strong>Operations:</strong> ${(wo.scope?.operations || []).map(escapeHtml).join(', ') || 'None declared'}</div>
            <div><strong>Limits:</strong> ${escapeHtml(wo.budgets?.maxFiles ?? 'n/a')} files / ${escapeHtml(wo.budgets?.maxChangedLines ?? 'n/a')} changed lines / ${Math.round((wo.budgets?.maxDurationMs || 0) / 1000)} seconds / $${escapeHtml(wo.budgets?.maxCloudCostUsd ?? 0)} cloud</div>
            ${wo.taskSpecific?.assumptions?.length ? `<div><strong>Plan:</strong> ${escapeHtml(wo.taskSpecific.assumptions[0])}</div>` : ''}
            ${wo.taskSpecific?.risks?.length ? `<div><strong>Planned risks:</strong> ${wo.taskSpecific.risks.map(escapeHtml).join('; ')}</div>` : ''}
            <div><strong>Authorization:</strong> ${wo.authorization?.granted ? (wo.authorization.envelopeVersion===1&&wo.authorization.envelopeHash?'Granted explicitly &middot; immutable envelope sealed':'Legacy authorization &middot; execution blocked') : 'Not granted'}</div>
            <div><strong>Evidence readiness:</strong> ${evidenceStatus}</div>
          </details>
          ${completionProof}
          <div class="row" style="margin-top:0.65rem">
            ${wo.status === 'draft' ? `<button type="button" data-review-authorize="${escapeHtml(wo.id)}">Review &amp; Authorize</button>` : ''}
            ${wo.status === 'authorized' ? (wo.authorization?.envelopeVersion===1&&wo.authorization?.envelopeHash ? `<button type="button" data-review-apply="${escapeHtml(wo.id)}">${isRepair ? 'Review Authorized Repair' : 'Review Authorized Export'}</button>` : '<button type="button" disabled>Authorization seal required</button>') : ''}
            ${(wo.status === 'draft' || wo.status === 'authorized') ? `<button type="button" class="secondary" data-review-cancel="${escapeHtml(wo.id)}">Review Cancellation</button>` : ''}
          </div>
          ${actionReview}
        </div>`;
      }).join('')}
    </div>
  `;
}function renderNoSession() {
  return `
    ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}
    <div class="empty-action" style="max-width:32rem;margin:2rem auto">
      <h2 style="margin:0">Session required</h2>
      <p>Open the one-time bootstrap URL printed by the running JoeCoder service. A tokenless page cannot create a session.</p>
      <p>If the link was already used or expired, restart JoeCoder for a fresh URL.</p>
      <button type="button" onclick="location.reload()">Retry after opening bootstrap URL</button>
    </div>
  `;
}


function navigateToSurface(target) {
  if (!target) return;
  if (target === 'register') {
    document.getElementById('home-register')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelector('#register-form input[name="name"]')?.focus();
    return;
  }
  if (target === 'inspect') {
    document.getElementById('btn-inspect')?.focus();
    document.getElementById('btn-inspect')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (target === 'composer') {
    state.composerMode = 'plan';
    render();
    requestAnimationFrame(() => {
      document.getElementById('draft-objective')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('draft-objective')?.focus();
    });
    return;
  }
  if (target === 'permissions') {
    document.querySelector('[data-open-panel="brain"]')?.click();
    return;
  }
  const map = {
    findings: 'findings-panel',
    'work-orders': 'work-orders-panel',
    chat: 'chat-form'
  };
  const id = map[target] || target;
  const el = document.getElementById(id) || document.getElementById('work-orders') || document.querySelector(`[data-nav-target="${target}"]`);
  if (el) {
    if (el.tagName === 'DETAILS') el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus?.();
  }
}

function render() {
  document.body.classList.toggle('guided', state.level === 'guided');
  document.body.classList.toggle('builder', state.level === 'builder');
  document.body.classList.toggle('no-project', !state.currentProject);

  const root = document.getElementById('app');
  if (!state.csrfToken) {
    root.innerHTML = renderTopbar() + `<div id="layout"><div id="main">${renderNoSession()}</div></div>`;
    bindCommon();
    return;
  }

  const main = state.currentProject ? renderProject() : renderHome();
  const layoutCls = [
    state.railCollapsed ? 'rail-collapsed' : '',
    state.currentProject && state.activityOpen ? 'with-activity' : ''
  ].filter(Boolean).join(' ');
  root.innerHTML = `
    ${renderTopbar()}
    <div id="layout" class="${layoutCls}">
      ${renderRail()}
      <main id="main" class="${state.currentProject ? 'project-view' : 'home-view'}">
        ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}
        ${state.notice ? `<div class="ok-box">${escapeHtml(state.notice)}</div>` : ''}
        ${main}
      </main>
      ${renderVoice()}
    </div>
  `;
  bindCommon();
  bindScreen();
  applyControlLocks();
}

function bindCommon() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToSurface(btn.getAttribute('data-nav'));
    });
  });
  const logout = document.getElementById('btn-logout');
  if (logout) logout.addEventListener('click', runLogout);
  document.querySelectorAll('.toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.level = btn.dataset.level;
      localStorage.setItem('jc_ui_level', state.level);
      render();
    });
  });
  document.querySelectorAll('[data-rail-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.railCollapsed = !state.railCollapsed;
      localStorage.setItem('jc_ui_rail', state.railCollapsed ? '1' : '0');
      render();
    });
  });
  document.querySelectorAll('[data-activity-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activityOpen = !state.activityOpen;
      localStorage.setItem('jc_ui_activity', state.activityOpen ? '1' : '0');
      render();
    });
  });
  document.querySelectorAll('[data-composer-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      state.composerMode = btn.dataset.composerMode === 'draft' ? 'draft' : 'ask';
      render();
      const target = state.composerMode === 'draft'
        ? document.getElementById('draft-objective')
        : document.getElementById('chat-input');
      if (target) target.focus();
    });
  });
}

function bindScreen() {
  const browse = document.getElementById('btn-browse');
  if (browse) {
    browse.addEventListener('click', async () => {
      clearMessages();
      try {
        browse.disabled = true;
        browse.textContent = 'Opening…';
        const data = await api('/api/v1/system/pick-folder', { method: 'POST', body: '{}', timeoutMs: 310000 });
        if (data.cancelled || !data.path) return;
        const input = document.getElementById('folder-path');
        if (input) input.value = data.path;
        const nameInput = document.querySelector('#register-form input[name="name"]');
        if (nameInput && !nameInput.value.trim()) {
          const parts = data.path.replace(/\\/g, '/').split('/').filter(Boolean);
          nameInput.value = parts[parts.length - 1] || '';
        }
      } catch (err) {
        showError(formatError(err) + ' You can paste a path if the dialog fails.');
        const input = document.getElementById('folder-path');
        if (input) input.removeAttribute('readonly');
      } finally {
        browse.disabled = false;
        browse.textContent = 'Browse…';
      }
    });
  }

  const reg = document.getElementById('register-form');
  if (reg) {
    reg.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessages();
      const fd = new FormData(reg);
      const body = { name: fd.get('name'), path: fd.get('path') };
      const desc = fd.get('description');
      if (desc) body.description = desc;
      try {
        setBusy(true);
        render();
        const data = await api('/api/v1/projects', { method: 'POST', body: JSON.stringify(body) });
        await refreshProjects();
        showNotice('Build folder registered. Nothing was changed on disk.');
        await openProject(data.project.id);
      } catch (err) {
        showError(err);
      } finally {
        setBusy(false);
        render();
      }
    });
  }

  document.querySelectorAll('[data-open-project]').forEach(card => {
    card.addEventListener('click', () => openProject(card.dataset.openProject));
  });

  const back = () => {
    viewEpoch += 1;
    state.busy = false;
    state.chatBusy = false;
    state.currentProject = null;
    state.latestSurvey = null;
    state.workOrders = [];
    state.events = [];
    state.messages = [];
    state.chatSuggestions = [];
    state.narration = null;
    state.reviewAction = null;
    state.stage = 'choose';
    state.joeStatus = 'waiting';
    stopEventsPoll();
    clearMessages();
    render();
  };
  const b1 = document.getElementById('btn-back-home');
  const b2 = document.getElementById('btn-back-home-2');
  if (b1) b1.addEventListener('click', back);
  if (b2) b2.addEventListener('click', back);

  const chatForm = document.getElementById('chat-form');
  if (chatForm) {
    chatForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('chat-input');
      const content = input?.value?.trim();
      if (content) await runChat(content);
    });
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (!state.chatBusy) chatForm.requestSubmit();
        }
      });
    }
  }

  document.querySelectorAll('[data-chat-action]').forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.dataset.chatAction;
      if (action === 'inspect') await runInspect();
      if (action === 'accept') await runAccept();
      if (action === 'draft_work_order') {
        if (draftEligibility().eligible && state.composerMode !== 'draft') {
          state.composerMode = 'draft';
          render();
        }
        const composer = document.getElementById('draft-composer');
        const input = document.getElementById('draft-objective');
        if (!composer || !input) {
          showError('The draft box is not available right now — resolve the active work order (or accept the build) first.');
          return;
        }
        // Prefill the objective from the user's last chat message when it
        // reads like an actual request rather than a bare command.
        if (!input.value.trim()) {
          const lastUser = [...state.messages].reverse().find(m => m.role === 'user');
          const candidate = (lastUser?.content || '')
            .replace(/\b(please\s+)?(write|draft|create|make|prepare|start|new)\s+(a\s+|the\s+)?work\s*order\b/gi, '')
            .trim();
          if (candidate.length >= 10) input.value = candidate.slice(0, 480);
        }
        composer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
      }
      if (action === 'review_work_orders') document.getElementById('work-orders-panel')?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  const inspect = document.getElementById('btn-inspect');
  if (inspect) inspect.addEventListener('click', runInspect);

  const accept = document.getElementById('btn-accept');
  const accept2 = document.getElementById('btn-accept-inline');
  if (accept) accept.addEventListener('click', runAccept);
  if (accept2) accept2.addEventListener('click', runAccept);

  const draftRepair = document.getElementById('btn-draft-repair');
  if (draftRepair) draftRepair.addEventListener('click', () => runFromSurvey('repair'));
  const draftBuild = document.getElementById('btn-draft-build');
  if (draftBuild) draftBuild.addEventListener('click', () => runFromSurvey('build'));
  const draftInspect = document.getElementById('btn-draft-inspect');
  if (draftInspect) draftInspect.addEventListener('click', () => runFromSurvey('inspect'));

  const exportMd = document.getElementById('btn-export-md');
  if (exportMd) exportMd.addEventListener('click', runExportMd);

  document.querySelectorAll('[data-review-authorize]').forEach(b => b.addEventListener('click', () => openWorkOrderReview('authorize', b.dataset.reviewAuthorize)));
  document.querySelectorAll('[data-confirm-authorize]').forEach(b => b.addEventListener('click', () => runAuthorize(b.dataset.confirmAuthorize)));
  document.querySelectorAll('[data-recover-authorize]').forEach(b => b.addEventListener('click', () => runRecoverAuthorization(b.dataset.recoverAuthorize)));
  document.querySelectorAll('[data-review-apply]').forEach(b => b.addEventListener('click', () => openWorkOrderReview('apply', b.dataset.reviewApply)));
  document.querySelectorAll('[data-confirm-apply]').forEach(b => b.addEventListener('click', () => runApply(b.dataset.confirmApply)));
  document.querySelectorAll('[data-review-cancel]').forEach(b => b.addEventListener('click', () => openWorkOrderReview('cancel', b.dataset.reviewCancel)));
  document.querySelectorAll('[data-confirm-cancel]').forEach(b => b.addEventListener('click', () => runCancel(b.dataset.confirmCancel)));
  document.querySelectorAll('[data-close-review]').forEach(b => b.addEventListener('click', () => closeWorkOrderReview(b.dataset.closeReview)));
}

// ---------- Data ----------
async function refreshProjects() {
  const data = await api('/api/v1/projects');
  state.projects = data.projects || [];
}

async function refreshHealth() {
  try {
    state.health = await api('/health');
  } catch {
    state.health = null;
  }
}

function eventKey(ev) {
  return ev.id || `${ev.ts}|${ev.type}|${ev.what || ''}`;
}

async function refreshEvents(projectId, incremental = false) {
  if (eventsInFlight) return;
  eventsInFlight = true;
  try {
    // Ask only for events newer than the last one we already hold, minus 1 ms
    // so same-millisecond stragglers are re-fetched and deduped by eventKey.
    const lastTs = incremental && state.events.length ? (state.events[state.events.length - 1].ts || 0) : 0;
    const after = lastTs > 0 ? `&after=${lastTs - 1}` : '';
    const data = await api(`/api/v1/projects/${projectId}/events?limit=40${after}`);
    if (state.currentProject?.id !== projectId) return;
    const incoming = data.events || [];
    if (!incremental || !state.events.length) {
      state.events = incoming;
    } else if (incoming.length) {
      const seen = new Set(state.events.map(eventKey));
      for (const ev of incoming) {
        if (!seen.has(eventKey(ev))) state.events.push(ev);
      }
      if (state.events.length > 120) state.events.splice(0, state.events.length - 120);
    }
    const newest = state.events[state.events.length - 1];
    if (state.narration && newest?.ts >= state.narration.ts) state.narration = null;
  } catch {
    // Keep the last trustworthy activity visible through a transient polling failure.
  } finally {
    eventsInFlight = false;
  }
}

function startEventsPoll(projectId) {
  stopEventsPoll();
  eventsTimer = setInterval(async () => {
    if (!state.currentProject || state.currentProject.id !== projectId) return;
    if (eventsInFlight) return;
    await refreshEvents(projectId, true);
    // Soft update voice panel only if still on same project
    const voice = document.getElementById('voice');
    if (voice && state.currentProject?.id === projectId) {
      const tmp = document.createElement('div');
      tmp.innerHTML = renderVoice();
      voice.replaceWith(tmp.firstElementChild);
    }
    const activity = document.querySelector('.activity-card');
    if (activity && state.currentProject?.id === projectId) {
      const tmp = document.createElement('div');
      tmp.innerHTML = renderActivity();
      activity.replaceWith(tmp.firstElementChild);
    }
  }, 1200);
}

function stopEventsPoll() {
  if (eventsTimer) {
    clearInterval(eventsTimer);
    eventsTimer = null;
  }
}

async function openProject(id) {
  clearMessages();
  const epoch = ++viewEpoch;
  try {
    setBusy(true);
    render();
    const data = await api(`/api/v1/projects/${id}`);
    if (epoch !== viewEpoch) return;
    state.currentProject = data.project;
    state.latestSurvey = data.latestSurvey || null;
    state.stage = deriveStage(data.project);
    state.joeStatus = data.latestSurvey ? 'reviewing' : 'waiting';

    const wos = await api(`/api/v1/projects/${id}/work-orders`);
    if (epoch !== viewEpoch) return;
    const all = wos.workOrders || [];
    state.workOrders = all.filter(wo =>
      wo.linkedSurveyId === data.project.latestSurveyId ||
      (wo.scope?.exactPaths || []).includes(data.project.path) ||
      data.project.activeWorkOrderId === wo.id ||
      ['draft', 'authorized', 'executing'].includes(wo.status)
    );
    if (state.reviewAction && !state.workOrders.some(wo =>
      wo.id === state.reviewAction.id && ['draft', 'authorized'].includes(wo.status)
    )) state.reviewAction = null;
    if (!state.workOrders.length && state.level === 'builder') {
      state.workOrders = all.slice(-8);
    }

    try {
      const chat = await api(`/api/v1/projects/${id}/chat`);
      if (epoch !== viewEpoch) return;
      state.messages = chat.messages || [];
      const lastReply = [...state.messages].reverse().find(message => message.role === 'assistant');
      state.chatSuggestions = lastReply?.suggestions || [];
    } catch {
      state.messages = [];
      state.chatSuggestions = [];
    }
    if (epoch !== viewEpoch) return;

    await refreshEvents(id);
    if (epoch !== viewEpoch) return;
    startEventsPoll(id);
    render();
  } catch (err) {
    if (epoch === viewEpoch) showError(err);
  } finally {
    if (epoch === viewEpoch) {
      setBusy(false);
      render();
    }
  }
}

async function runChat(content) {
  const p = state.currentProject;
  if (!p || state.chatBusy) return;
  const epoch = viewEpoch;
  clearMessages();
  beginNarration('I am reading your request and checking the current project state.', 'I am matching your words to the allowed workflow without treating them as authorization.', 'I will answer with the safest useful next action.');
  state.chatBusy = true;
  state.chatSuggestions = [];
  render();
  try {
    const data = await api(`/api/v1/projects/${p.id}/chat`, {
      method: 'POST',
      body: JSON.stringify({ content })
    });
    if (epoch !== viewEpoch) return;
    state.messages = data.messages || [];
    state.chatSuggestions = data.reply?.suggestions || [];
    await refreshEvents(p.id);
  } catch (err) {
    if (epoch !== viewEpoch) return;
    failNarration(err.message);
    state.error = err.message;
  } finally {
    if (epoch === viewEpoch) {
      state.chatBusy = false;
      render();
      const last = document.querySelector('#chat-messages .chat-message:last-child');
      if (last) last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

async function runInspect() {
  const p = state.currentProject;
  if (!p) return;
  const active = activeProjectWorkOrder();
  if (active) {
    focusActiveWork(active, 'Finish or cancel ' + active.id + ' before starting a fresh inspection.');
    return;
  }
  const epoch = viewEpoch;
  clearMessages();
  beginNarration(
    'I am starting a read-only inspection.',
    'I will inventory the build surface without running it or changing its files.',
    'I will report the build shape, findings, and recorded evidence.'
  );
  try {
    setBusy(true, 'inspecting');
    render();
    const data = await api('/api/v1/survey', {
      method: 'POST',
      body: JSON.stringify({ path: p.path, projectId: p.id }),
      timeoutMs: 120000
    });
    const refreshed = await api(`/api/v1/projects/${p.id}`);
    if (epoch !== viewEpoch) return;
    state.latestSurvey = refreshed.latestSurvey || data;
    state.currentProject = refreshed.project;
    state.stage = deriveStage(refreshed.project);
    state.joeStatus = 'reviewing';
    await refreshEvents(p.id);
    showNotice('Surface inspection complete. No files in your build folder were modified.');
    render();
  } catch (err) {
    if (epoch !== viewEpoch) return;
    state.joeStatus = 'blocked';
    failNarration(err.message, 'Correct the access or path problem, then inspect again.');
    showError(err);
  } finally {
    if (epoch === viewEpoch) {
      setBusy(false);
      render();
    }
  }
}

async function runAccept() {
  const p = state.currentProject;
  if (!p) return;
  clearMessages();
  beginNarration(
    'I am checking whether this build can enter planning.',
    'Acceptance selects the build but keeps it read-only.',
    'I will preserve any later workflow state and unlock only the next valid planning step.'
  );
  const epoch = viewEpoch;
  try {
    setBusy(true);
    render();
    const data = await api(`/api/v1/projects/${p.id}/accept`, { method: 'POST', body: '{}' });
    if (epoch !== viewEpoch) return;
    await openProject(p.id);
    showNotice(data.alreadyAccepted
      ? 'This build was already accepted. Its current workflow state was preserved.'
      : 'Build accepted for further work. Still read-only until a work order is authorized.');
  } catch (err) {
    if (epoch !== viewEpoch) return;
    showError(err);
  } finally {
    setBusy(false);
    render();
  }
}

async function runFromSurvey(intent) {
  const p = state.currentProject;
  if (!p?.latestSurveyId) {
    showError('Inspect the build first so a survey exists.');
    return;
  }
  if (state.latestSurvey?._integrity?.verified === false) {
    showError('This survey is legacy evidence without stored hash proof. Run Inspect Again before drafting a Work Order.');
    return;
  }
  const input = document.getElementById('draft-objective');
  const objective = input?.value?.trim();
  if (!objective) {
    showError('Describe the objective first — one or two sentences about the outcome you want.');
    return;
  }
  const mutation = intent === 'repair' || intent === 'build';
  if (mutation && !sourceRepairCapability().enabled) {
    showError(sourceRepairCapability().reason);
    return;
  }
  const epoch = viewEpoch;
  clearMessages();
  try {
    setBusy(true, 'drafting');
    beginNarration(
      intent === 'build'
        ? 'I am asking the local model to plan a greenfield file set for this empty folder.'
        : intent === 'repair'
          ? 'I am asking the local model to plan the exact repair scope.'
          : 'I am drafting a scoped work order from the inspection evidence.',
      mutation
        ? 'The plan proposes exact files and limits; nothing is written and nothing is authorized.'
        : 'This records the objective, allowed paths, operations, limits, and checks; it does not authorize execution.',
      'You will review the complete scope before any authorization is accepted.'
    );
    render();
    await api('/api/v1/work-orders/from-survey', {
      method: 'POST',
      body: JSON.stringify({ surveyId: p.latestSurveyId, objective, intent }),
      timeoutMs: mutation ? 210000 : 30000
    });
    if (epoch !== viewEpoch) return;
    state.stage = 'wo';
    state.composerMode = 'ask';
    await openProject(p.id);
    showNotice(intent === 'build'
      ? 'Build draft created with a model-planned file set. Review exact files and limits, then authorize.'
      : intent === 'repair'
        ? 'Repair draft created with a model-planned file scope. Review the exact files and limits, then authorize.'
        : 'Draft work order created. Authorize it before any apply action.');
    requestAnimationFrame(() => document.getElementById('work-orders-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } catch (err) {
    if (epoch !== viewEpoch) return;
    showError(err);
  } finally {
    setBusy(false);
    render();
  }
}

async function runExportMd() {
  const p = state.currentProject;
  const id = state.latestSurvey?.evidenceId || p?.latestSurveyId;
  if (!id) return;
  try {
    const res = await fetch(`${API}/api/v1/evidence/${id}/export?format=md`, {
      credentials: 'same-origin'
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `survey-${id}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    showError(err);
  }
}

function openWorkOrderReview(type, id) {
  const wo = state.workOrders.find(item => item.id === id);
  if (!wo) return showError('Work order not found in the current project view.');
  const allowed = (type === 'authorize' && wo.status === 'draft') ||
    (type === 'apply' && wo.status === 'authorized') ||
    (type === 'cancel' && ['draft', 'authorized'].includes(wo.status));
  if (!allowed) return showError(`The ${type} review is not available while ${wo.id} is '${wo.status}'.`);

  clearMessages();
  state.reviewAction = { type, id };
  if (type === 'authorize') state.stage = 'approval';
  beginNarration(
    `I opened the ${type} checkpoint for ${wo.id}.`,
    'Nothing has been authorized or executed. I am showing the complete decision in the page.',
    'Review the visible scope, evidence readiness, limits, and exact action before choosing.'
  );
  render();
  requestAnimationFrame(() => (document.getElementById('pipeline-decision') || document.querySelector('.action-review') || document.querySelector('.job-pipeline'))?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}

function closeWorkOrderReview(id) {
  if (state.reviewAction?.id !== id) return;
  state.reviewAction = null;
  state.stage = deriveStage(state.currentProject);
  clearMessages();
  render();
}

async function runAuthorize(id) {
  const wo = state.workOrders.find(item => item.id === id);
  if (!wo) return showError('Work order not found in the current project view.');
  if (state.reviewAction?.type !== 'authorize' || state.reviewAction.id !== id) {
    openWorkOrderReview('authorize', id);
    return;
  }
  if (wo.linkedSurveyIntegrity?.verified !== true) {
    showError('Authorization remains blocked until a fresh inspection produces hash-verified evidence.');
    return;
  }

  const epoch = viewEpoch;
  clearMessages();
  beginNarration(
    `I am validating ${wo.id} before recording authorization.`,
    'I am checking evidence integrity, dependency state, the one-active-work-order rule, and the declared scope.',
    'If every guardrail passes, I will move this same decision forward to the final Run button. Authorizing alone changes no files.'
  );
  try {
    setBusy(true, 'awaiting');
    render();
    const data = await api(`/api/v1/work-orders/${id}/authorize`, {
      method: 'POST',
      body: JSON.stringify({ grantedBy: 'local-operator' })
    });
    if (epoch !== viewEpoch) return;
    if (state.currentProject) await openProject(state.currentProject.id);
    const refreshed = state.workOrders.find(item => item.id === id);
    if (refreshed?.status === 'authorized' && refreshed.authorization?.envelopeVersion === 1 && refreshed.authorization?.envelopeHash) {
      state.reviewAction = { type: 'apply', id };
      state.composerMode = 'agent';
      state.stage = 'complete';
      beginNarration(
        `${wo.id} is authorized. No code has changed.`,
        'The exact plan is locked and cannot be widened by chat or a preset.',
        'The final Run decision is open now. Run it to make the change and perform the recorded checks, or go back without running.'
      );
    } else {
      state.reviewAction = null;
      state.stage = 'approval';
    }
    showNotice(data.alreadyAuthorized
      ? 'This exact Work Order was already authorized. Nothing changed; review the final Run step below.'
      : 'Authorized. Nothing has changed yet. Review the final Run step below.');
  } catch (err) {
    if (epoch !== viewEpoch) return;
    const next = err.code === 'VERIFIED_SURVEY_REQUIRED'
      ? 'Use Cancel Draft & Run Fresh Inspection in the visible checkpoint.'
      : 'Review the reported guardrail before trying again.';
    failNarration(err.message, next);
    showError(err);
  } finally {
    setBusy(false);
    render();
  }
}

async function runRecoverAuthorization(id) {
  const wo = state.workOrders.find(item => item.id === id);
  const p = state.currentProject;
  if (!wo || !p) return showError('The project or Work Order is no longer available.');
  if (state.reviewAction?.type !== 'authorize' || state.reviewAction.id !== id) {
    openWorkOrderReview('authorize', id);
    return;
  }

  const epoch = viewEpoch;
  let cancelled = false;
  clearMessages();
  beginNarration(
    `I am replacing the unverifiable draft ${wo.id} safely.`,
    'I will cancel only this draft, release its active slot, and run a fresh read-only inspection. Source files remain unchanged.',
    'When the new hash-verified findings are ready, you can review them and draft a new Work Order.'
  );
  try {
    setBusy(true, 'inspecting');
    render();
    await api(`/api/v1/work-orders/${id}/cancel`, { method: 'POST', body: '{}' });
    cancelled = true;
    if (epoch !== viewEpoch) return;
    state.reviewAction = null;
    await api('/api/v1/survey', {
      method: 'POST',
      body: JSON.stringify({ path: p.path, projectId: p.id }),
      timeoutMs: 120000
    });
    if (epoch !== viewEpoch) return;
    await openProject(p.id);
    showNotice('Fresh hash-verified inspection recorded. Review the findings, accept the build for planning, then draft a new Work Order.');
  } catch (err) {
    if (epoch !== viewEpoch) return;
    failNarration(
      err.message,
      cancelled
        ? 'The old draft is cancelled. Select Inspect Build to retry the read-only inspection.'
        : 'The draft is still unchanged. Review the error before trying again.'
    );
    showError(err);
  } finally {
    setBusy(false);
    render();
  }
}

async function runApply(id) {
  const wo = state.workOrders.find(item => item.id === id);
  if (!wo) return showError('Work order not found in the current project view.');
  if (state.reviewAction?.type !== 'apply' || state.reviewAction.id !== id) {
    openWorkOrderReview('apply', id);
    return;
  }

  const isRepair = (wo.scope?.operations || []).includes('edit_files');
  if (isRepair && !sourceRepairCapability().enabled) {
    showError(sourceRepairCapability().reason);
    return;
  }
  if (wo.authorization?.envelopeVersion !== 1 || !wo.authorization?.envelopeHash) {
    showError('This legacy authorization has no immutable envelope seal. Cancel it and authorize a fresh Work Order.');
    return;
  }
  const epoch = viewEpoch;
  clearMessages();
  beginNarration(
    isRepair
      ? `I am starting the authorized repair for ${wo.id}.`
      : `I am starting the authorized export for ${wo.id}.`,
    isRepair
      ? 'I will snapshot the scoped files, generate the edits, write within budgets, and verify with the project’s own build/test scripts.'
      : 'The operation is confined to JoeCoder .jc storage; source files remain protected.',
    isRepair
      ? 'If verification fails, every file is restored from the snapshot automatically.'
      : 'I will prepare the export, copy linked evidence, write the summary, and record completion proof.'
  );
  try {
    setBusy(true, 'working');
    render();
    const data = await api(`/api/v1/work-orders/${id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ action: isRepair ? 'apply_edits' : 'export_handoff' }),
      timeoutMs: isRepair ? 640000 : 90000
    });
    if (epoch !== viewEpoch) return;
    const projectId = state.currentProject?.id || null;
    state.lastRunResult = {
      projectId,
      workOrderId: id,
      action: isRepair ? 'apply_edits' : 'export_handoff',
      applied: data.applied || [],
      verification: data.verification || null,
      evidenceId: data.evidenceId || null,
      exportPath: data.exportPath || null,
      completedAt: new Date().toISOString()
    };
    state.reviewAction = null;
    state.stage = 'complete';
    state.joeStatus = 'complete';
    if (state.currentProject) await openProject(state.currentProject.id);
    const verificationItems = data.verification?.items || [];
    const runtimePassed = data.verification?.status === 'passed' && verificationItems.some(item => item.passed && (item.script === 'build' || item.script === 'test'));
    const integrityPassed = verificationItems.some(item => item.passed && item.script === 'file_integrity');
    beginNarration(
      isRepair ? `${wo.id} finished without crossing its approved boundaries.` : `${wo.id} created the authorized handoff package.`,
      isRepair
        ? (runtimePassed
          ? 'The approved files changed and the available project build or tests passed.'
          : integrityPassed
            ? 'The approved files changed and their saved contents were hash-checked. No runnable app build or test was available, so runtime behavior is not proven.'
            : 'The recorded completion checks passed, but no runtime build or test result was returned.')
        : 'The package was written under JoeCoder storage; source files were not changed.',
      'The completion receipt below shows exactly what changed and what the evidence proves.'
    );
    showNotice(isRepair
      ? (runtimePassed
        ? `Repair finished and available project checks passed. Files changed: ${(data.applied || []).map(c => c.relPath).join(', ') || 'see the receipt'}`
        : integrityPassed
          ? `File changes confirmed; runtime still unproven. Files changed: ${(data.applied || []).map(c => c.relPath).join(', ') || 'see the receipt'}`
          : 'Repair finished. Review the completion receipt for the exact level of proof.')
      : `Export handoff complete. Wrote under .jc only: ${data.exportPath || 'see the receipt'}`);
  } catch (err) {
    if (epoch !== viewEpoch) return;
    state.joeStatus = 'blocked';
    failNarration(err.message, 'Review the failed guardrail or export step before trying again.');
    showError(err);
  } finally {
    setBusy(false);
    render();
  }
}

async function runCancel(id) {
  const wo = state.workOrders.find(item => item.id === id);
  if (!wo) return showError('Work order not found in the current project view.');
  if (state.reviewAction?.type !== 'cancel' || state.reviewAction.id !== id) {
    openWorkOrderReview('cancel', id);
    return;
  }

  const epoch = viewEpoch;
  clearMessages();
  beginNarration(
    `I am cancelling ${wo.id}.`,
    'Cancellation removes its authority and releases the active work-order slot.',
    'A different objective will require a new scoped draft.'
  );
  try {
    setBusy(true);
    render();
    await api(`/api/v1/work-orders/${id}/cancel`, { method: 'POST', body: '{}' });
    if (epoch !== viewEpoch) return;
    state.reviewAction = null;
    if (state.currentProject) await openProject(state.currentProject.id);
    showNotice('Work order cancelled. No authority remains from it.');
  } catch (err) {
    if (epoch !== viewEpoch) return;
    failNarration(err.message);
    showError(err);
  } finally {
    setBusy(false);
    render();
  }
}
async function runLogout() {
  try {
    await api('/api/v1/session/logout', { method: 'POST', body: '{}' });
  } catch (err) {
    state.error = err.message;
  } finally {
    viewEpoch += 1;
    stopEventsPoll();
    state.busy = false;
    state.chatBusy = false;
    state.csrfToken = null;
    state.sessionId = null;
    state.currentProject = null;
    state.projects = [];
    state.workOrders = [];
    state.events = [];
    state.messages = [];
    state.reviewAction = null;
    render();
  }
}

async function boot() {
  const active = await loadSession();
  if (!active) {
    render();
    return;
  }
  try {
    await Promise.all([refreshProjects(), refreshHealth()]);
  } catch (err) {
    state.error = err.message;
  }
  render();
}


// ---------- JoeCoder Pro 2.0 workshop shell ----------
Object.assign(state,{threads:[],currentThread:null,brain:null,workshopSettings:null,panel:null,liveTab:localStorage.getItem('jc_live_tab')||'live',narrationDetail:localStorage.getItem('jc_narration_detail')||'normal',speechEnabled:localStorage.getItem('jc_speech')==='1'});
const SOURCE_REPAIR_FALLBACK=Object.freeze({enabled:false,code:'SOURCE_REPAIR_UNKNOWN',reason:'Source repair status unknown until the local session is live.',nextStep:'Start JoeCoder and open Settings to read the live capability record.'});
function sourceRepairCapability(){return state.workshopSettings?.capabilities?.sourceRepair||state.health?.capabilities?.sourceRepair||SOURCE_REPAIR_FALLBACK;}
let detachedLiveWindow=null,lastSpokenKey='';

function currentPreset(){const id=state.currentThread?.presetId||'preset-auto';return state.workshopSettings?.presets?.find(x=>x.id===id)||{id:'preset-auto',name:'Auto'};}
function presetRouteLabel(){const preset=currentPreset(),model=state.health?.model;if(!model?.localModel)return'Guarded fallback ready';const have=new Set(model.localCapabilities||[]),missing=(preset.requiredCapabilities||[]).filter(x=>!have.has(x));return missing.length?'Preset needs '+missing.join(', '):model.localModel+' ready';}
function providerConnectionState(profile){if(profile.provider==='ollama'){const model=state.workshopSettings?.liveProviderStatus?.localModel||state.health?.model?.localModel;return{ready:Boolean(model),label:model?'Running: '+model:'Not running'};}return{ready:Boolean(profile.configured),label:profile.configured?'API key detected':profile.secretEnvVar?'Set '+profile.secretEnvVar:'Unavailable'};}
function prettyStage(x){return({folder_selected:'Ready to inspect',surface_inspection_running:'Inspecting read-only',surface_review_ready:'Review ready',project_accepted:'Ready to plan',work_order_draft:'Plan drafted',awaiting_approval:'Waiting for authorization',approved:'Authorized',executing:'Running authorized work',complete:'Verified work complete',partial:'Partly complete',blocked:'Blocked',cancelled:'Cancelled'})[x]||x||'Ready';}
function liveEvents(){const a=[...state.events].reverse();if(state.liveTab==='decisions')return a.filter(x=>/author|accept|policy|denied|blocked|cancel/i.test(x.type||x.what||''));if(state.liveTab==='files')return a.filter(x=>x.evidenceId||/survey|inspect|export|execution|repair|file/i.test(x.type||x.what||''));return state.liveTab==='log'?a:a.slice(0,12);}
function liveItem(x){return`<article class="live-entry"><div class="live-entry-meta">${x.ts?new Date(x.ts).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'Now'}${x.evidenceId?` &middot; proof ${escapeHtml(x.evidenceId)}`:''}</div><div class="live-entry-title">${escapeHtml(x.what||x.type||'Recorded update')}</div>${state.narrationDetail!=='quiet'&&x.meaning?`<div class="live-entry-meaning">${escapeHtml(x.meaning)}</div>`:''}${state.narrationDetail==='detailed'&&x.next?`<div class="live-entry-next"><strong>Next:</strong> ${escapeHtml(x.next)}</div>`:''}</article>`;}

renderTopbar=function(){const p=state.currentProject,joe=JOE_STATUS[state.joeStatus]||state.joeStatus;return`<div id="topbar"><div class="topbar-left"><button type="button" class="icon-btn" data-rail-toggle>&#9776;</button><div class="brand-lockup"><div class="brand">JoeCoder</div><div class="brand-edition">PRO 2.0</div></div>${p?`<span class="crumb">/</span><span class="crumb-project">${escapeHtml(p.name)}</span>`:''}${state.currentThread?`<span class="crumb">/</span><span class="crumb-thread">${escapeHtml(state.currentThread.title)}</span>`:''}</div><div class="topbar-mid"><span class="chip ${state.busy||state.chatBusy?'busy':'ok'}"><span class="dot"></span>${escapeHtml(state.busy||state.chatBusy?joe+'...':joe)}</span>${p?`<span class="chip quiet">${p.permissions?.writeFiles?'Write grant active':'Read-only'}</span><span class="chip quiet">${escapeHtml(currentPreset().name)} preset</span><span class="chip quiet">${state.health?.model?.localModel?escapeHtml(state.health.model.localModel)+' &middot; local':'Guarded fallback'}</span>`:''}</div><div class="topbar-right">${p?`<button type="button" class="icon-btn ${state.activityOpen?'active':''}" data-activity-toggle>Joe Live</button>`:''}${state.csrfToken?'<button type="button" class="icon-btn" id="btn-logout">End session</button>':''}</div></div>`;};

renderRail=function(){const p=state.currentProject;const projects=state.projects.map(x=>`<div class="rail-project-group ${p?.id===x.id?'active':''}"><button class="rail-project" data-open-project="${escapeHtml(x.id)}"><span class="rail-project-mark">${escapeHtml(x.name[0]||'J')}</span><span class="rail-item-label"><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(prettyStage(x.workflowStage))}</small></span></button>${p?.id===x.id?`<div class="rail-threads">${state.threads.filter(t=>t.status==='active').map(t=>`<button class="rail-thread ${state.currentThread?.id===t.id?'current':''}" data-open-thread="${escapeHtml(t.id)}"><span>#</span><span class="rail-item-label">${escapeHtml(t.title)}</span></button>`).join('')}<button class="rail-thread rail-thread-new" data-open-panel="new-thread"><span>+</span><span class="rail-item-label">New conversation</span></button></div>`:''}</div>`).join('')||'<div class="rail-empty">No projects yet</div>';const presets=(state.workshopSettings?.presets||[]).slice(0,8).map(x=>`<button class="rail-preset ${state.currentThread?.presetId===x.id?'current':''}" data-select-preset="${escapeHtml(x.id)}" title="${escapeHtml(x.description)}"><span>&#9671;</span><span class="rail-item-label">${escapeHtml(x.name)}</span></button>`).join('');return`<aside id="rail" class="${state.railCollapsed?'collapsed':''}"><div class="rail-scroll workshop-rail-scroll"><button class="rail-new" id="btn-back-home"><span class="rail-new-plus">+</span><span class="rail-item-label">Open another project</span></button><h3>Projects &amp; conversations</h3>${projects}${p?`<h3>Job presets</h3>${presets}`:''}</div><div class="rail-footer">${p?'<button class="rail-footer-button" data-open-panel="brain"><span>&#9673;</span><span class="rail-item-label">Project Brain</span></button>':''}<button class="rail-footer-button" data-open-panel="settings"><span>&#9881;</span><span class="rail-item-label">Models &amp; settings</span></button></div></aside>`;};

renderVoice=function(){if(!state.currentProject)return'';const x=state.narration||state.events.at(-1)||{what:'I am ready for your next instruction.',meaning:'Nothing is running. Your project remains read-only.',next:'Tell me the outcome you want.'};const items=liveEvents();return`<aside id="voice" class="${state.activityOpen?'':'hidden'}"><div class="voice-head live-head"><div><h3>Joe Live</h3><span class="voice-sub">Visible work account, not private chain-of-thought.</span></div><div><button class="icon-btn" id="btn-detach-live">&#8599;</button><button class="icon-btn" data-activity-toggle>&times;</button></div></div><div class="live-controls"><button class="speech-toggle ${state.speechEnabled?'active':''}" id="btn-speech">${state.speechEnabled?'Voice on':'Voice off'}</button><select id="narration-detail">${['quiet','normal','detailed'].map(v=>`<option value="${v}" ${state.narrationDetail===v?'selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select></div><nav class="live-tabs">${['live','decisions','files','log'].map(v=>`<button data-live-tab="${v}" class="${state.liveTab===v?'active':''}">${v[0].toUpperCase()+v.slice(1)}</button>`).join('')}</nav><section class="activity-card ${state.busy||state.chatBusy?'working':''}" aria-live="polite"><div class="activity-status"><span class="activity-dot"></span><strong>${state.busy||state.chatBusy?'Working now':'Current truth'}</strong></div><div class="activity-what">${escapeHtml(x.what)}</div>${state.narrationDetail!=='quiet'&&x.meaning?`<div class="activity-meaning">${escapeHtml(x.meaning)}</div>`:''}${state.narrationDetail==='detailed'&&x.next?`<div class="activity-next"><strong>Next:</strong> ${escapeHtml(x.next)}</div>`:''}</section><div class="voice-log">${items.length?items.map(liveItem).join(''):`<div class="voice-empty">No ${escapeHtml(state.liveTab)} entries yet.</div>`}</div></aside>`;};

renderComposer=function(){if(!state.currentProject)return'';const mode=['ask','plan','agent'].includes(state.composerMode)?state.composerMode:'ask',draft=draftEligibility(),active=activeProjectWorkOrder();const options=(state.workshopSettings?.presets||[]).map(x=>`<option value="${escapeHtml(x.id)}" ${x.id===currentPreset().id?'selected':''}>${escapeHtml(x.name)}</option>`).join('');const suggestions=state.chatSuggestions.length?`<div class="chat-suggestions">${state.chatSuggestions.map(x=>`<button class="chip-btn" data-chat-action="${escapeHtml(x.id)}">${escapeHtml(x.label)}</button>`).join('')}</div>`:'';return`<div class="composer-dock">${suggestions}<div class="composer-card"><div class="composer-toolbar"><button class="attach-context" data-open-panel="brain">+</button><select id="composer-preset">${options||'<option>Auto</option>'}</select><span class="model-route">${escapeHtml(presetRouteLabel())}</span><div class="composer-tabs">${['ask','plan','agent'].map(v=>`<button class="composer-tab ${mode===v?'active':''}" data-workshop-mode="${v}">${v[0].toUpperCase()+v.slice(1)}</button>`).join('')}</div></div><form id="chat-form" class="${mode==='ask'?'':'hidden'}"><textarea id="chat-input" rows="2" maxlength="4000" required placeholder="Tell Joe what you want..."></textarea><div class="composer-row"><span class="composer-hint">${state.chatBusy?'Joe is checking the current truth...':'Enter to send &middot; Shift+Enter for a new line'}</span><button type="submit" ${state.chatBusy?'disabled':''}>${state.chatBusy?'Responding...':'Send'}</button></div></form><div id="draft-composer" class="${mode==='plan'?'':'hidden'}">${draft.eligible?`<textarea id="draft-objective" rows="2" maxlength="500" placeholder="Describe the outcome Joe should plan."></textarea><div class="composer-row"><span class="composer-hint">Reviewable scope and checks. Planning is not authorization.</span><span><button class="secondary" id="btn-draft-inspect">Read-only plan</button><button id="btn-draft-repair">Repair plan</button><button id="btn-draft-build" title="Empty folder only">Build plan</button></span></div>`:`<div class="composer-remediation"><strong>Planning is paused.</strong><span>${escapeHtml(draft.reason)}</span></div>`}</div><div class="agent-composer ${mode==='agent'?'':'hidden'}">${active?`<div><strong>${escapeHtml(active.id)}</strong> is ${escapeHtml(active.status)}. Only its declared scope can run.</div><button class="secondary" data-scroll-work-orders>Review guarded controls</button>`:'<div><strong>No authorized work is ready.</strong> Create and review a plan first. Chat never becomes permission.</div><button class="secondary" data-workshop-mode="plan">Go to Plan</button>'}</div></div><p class="chat-guardrail">Conversation guides the objective. Scope, permission, execution, and completion remain separate and evidence-gated.</p></div>`;};




function overlayField(name,label,rows=3){return`<label>${label}</label><textarea name="${name}" rows="${rows}">${escapeHtml(state.brain?.[name]||'')}</textarea>`;}
function brainGuidancePresets(){return Array.isArray(state.workshopSettings?.brainPresets)?state.workshopSettings.brainPresets:[];}
function selectedBrainGuidancePreset(id=state.brain?.guidancePresetId){const presets=brainGuidancePresets();return presets.find(x=>x.id===id)||presets.find(x=>x.id==='brain-preset-exceptional-builder')||presets[0]||null;}
const BRAIN_GUIDANCE_LABELS={purpose:'Outcome discipline',preferences:'How Joe works with you',environment:'Environment truth',architecture:'Architecture discipline',constraints:'Non-negotiable guardrails',decisions:'Decision method',knownIssues:'Issue handling',verifiedTruth:'Proof standard'};
function brainGuidancePreview(preset){if(!preset)return`<section class="brain-guidance-preview" id="brain-guidance-preview"><p class="muted">The built-in guidance catalog is unavailable. Reload JoeCoder before saving.</p></section>`;const guidance=preset.guidance||{},items=Object.entries(BRAIN_GUIDANCE_LABELS).map(([key,label])=>`<article class="brain-guidance-item"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(guidance[key]||'No guidance recorded.').replace(/\n/g,'<br>')}</p></article>`).join('');return`<section class="brain-guidance-preview" id="brain-guidance-preview"><div class="brain-guidance-head"><div><strong>${escapeHtml(preset.name)}</strong><span>${escapeHtml(preset.description)}</span></div><small>Law foundation ${escapeHtml(preset.lawVersion||'current')} &middot; ${escapeHtml(String((preset.lawFamilies||[]).length))} families &middot; ${escapeHtml(String(preset.lawCount||48))} ratified laws</small></div><p><strong>Best for:</strong> ${escapeHtml(preset.recommendedFor||'This project.')}</p><p class="brain-guidance-motivation">${escapeHtml(preset.motivation||'')}</p><details><summary>Review the guidance Joe will follow</summary><div class="brain-guidance-list">${items}</div></details><p class="brain-guidance-safety">Guidance changes how Joe approaches the work. It does not overwrite your notes, authorize a mutation, widen a Work Order, or become evidence.</p></section>`;}
function renderWorkshopOverlay(){if(!state.panel)return'';const close='<button class="overlay-close" data-close-panel>&times;</button>',presets=state.workshopSettings?.presets||[];if(state.panel==='new-thread')return`<div class="overlay-backdrop"><section class="workshop-overlay">${close}<div class="overlay-kicker">New conversation</div><h2>Start a focused line of work</h2><form id="new-thread-form"><label>Name</label><input name="title" maxlength="100" required><label>Objective</label><textarea name="objective" rows="5"></textarea><label>Preset</label><select name="presetId">${presets.map(x=>`<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')}</select><div class="overlay-actions"><button class="secondary" data-close-panel>Cancel</button><button type="submit">Create conversation</button></div></form></section></div>`;if(state.panel==='thread')return`<div class="overlay-backdrop"><section class="workshop-overlay">${close}<h2>Conversation objective</h2><form id="thread-form"><label>Name</label><input name="title" required value="${escapeHtml(state.currentThread?.title||'')}"><label>Objective</label><textarea name="objective" rows="7">${escapeHtml(state.currentThread?.objective||'')}</textarea><div class="overlay-actions"><button class="secondary" data-close-panel>Cancel</button><button type="submit">Save</button></div></form></section></div>`;if(state.panel==='brain'){const brainPresets=brainGuidancePresets(),selected=selectedBrainGuidancePreset();return`<div class="overlay-backdrop"><section class="workshop-overlay overlay-wide">${close}<div class="overlay-kicker">Project-scoped memory</div><h2>Project Brain</h2><p class="muted">Durable context with freshness and evidence awareness. Notes guide Joe; they do not become proof.</p><form id="brain-form" class="brain-grid"><section class="brain-guidance-picker"><label for="brain-guidance-preset">How Joe should work on this project</label><select id="brain-guidance-preset" name="guidancePresetId" required>${brainPresets.map(x=>`<option value="${escapeHtml(x.id)}" ${x.id===selected?.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}</select><p class="muted">Choose the operating emphasis. Every choice keeps the same truth, scope, permission, safety, rollback, testing, delivery, and communication laws.</p>${brainGuidancePreview(selected)}</section>${overlayField('purpose','Purpose')}${overlayField('preferences','Your preferences')}${overlayField('environment','Environment')}${overlayField('architecture','Architecture',5)}${overlayField('constraints','Constraints',4)}${overlayField('decisions','Decisions and rejected approaches',5)}${overlayField('knownIssues','Known issues',4)}${overlayField('verifiedTruth','Current verified truth (linked evidence required)',5)}<div class="brain-proof"><strong>Evidence links</strong><span>${state.brain?.evidenceIds?.length?state.brain.evidenceIds.map(escapeHtml).join(', '):'No evidence explicitly linked yet'}</span></div><div class="overlay-actions"><button type="button" class="secondary" data-close-panel>Cancel</button><button type="submit" ${selected?'':'disabled'}>Save Project Brain</button></div></form></section></div>`;}const providers=state.workshopSettings?.providers||[];return`<div class="overlay-backdrop"><section class="workshop-overlay overlay-wide">${close}<div class="overlay-kicker">JoeCoder settings</div><h2>Models, privacy, and behavior</h2><div class="settings-section"><h3>Model connections</h3>${providers.map(x=>{const connection=providerConnectionState(x);return`<div class="provider-row"><div><strong>${escapeHtml(x.displayName)}</strong><span>${escapeHtml(x.kind)} &middot; ${escapeHtml(x.defaultModel||'automatic')}</span></div><span class="connection-state ${connection.ready?'ready':''}">${escapeHtml(connection.label)}</span></div>`;}).join('')}<p class="settings-rule">Secrets stay in environment variables. Cloud remains blocked until an explicit Work Order budget allows it.</p></div><div class="settings-section"><h3>Job presets</h3><div class="preset-grid">${presets.map(x=>`<article class="preset-card"><strong>${escapeHtml(x.name)}</strong><p>${escapeHtml(x.description)}</p><small>${escapeHtml(x.taskKind)} &middot; ${escapeHtml(x.privacyMode)} &middot; needs ${escapeHtml((x.requiredCapabilities||[]).join(', ')||'standard chat')}</small></article>`).join('')}</div></div><div class="settings-section"><h3>Joe Live</h3><label class="setting-check"><input type="checkbox" id="settings-speech" ${state.speechEnabled?'checked':''}> Read responses aloud</label><select id="settings-narration">${['quiet','normal','detailed'].map(v=>`<option value="${v}" ${state.narrationDetail===v?'selected':''}>${v}</option>`).join('')}</select><label class="setting-check"><input type="checkbox" id="settings-builder" ${state.level==='builder'?'checked':''}> Show technical evidence details</label></div><div class="overlay-actions"><button data-close-panel>Done</button></div></section></div>`;}

const renderWorkshopOverlayBeforeCapabilities = renderWorkshopOverlay;
renderWorkshopOverlay = function renderWorkshopOverlayWithCapabilities() {
  const html = renderWorkshopOverlayBeforeCapabilities();
  if (state.panel !== 'settings') return html;
  const cap = sourceRepairCapability();
  const status = cap.enabled ? 'Certified' : (cap.code === 'SOURCE_REPAIR_UNKNOWN' ? 'Unknown' : 'Safety hold');
  const evidence = Array.isArray(cap.evidenceIds) && cap.evidenceIds.length
    ? '<p class="settings-rule">Evidence: ' + escapeHtml(cap.evidenceIds.slice(0, 4).join(', ')) + (cap.certifiedAt ? ' · certified ' + escapeHtml(cap.certifiedAt) : '') + '</p>'
    : '';
  const card = '<div class="settings-section"><h3>Capabilities</h3><div class="provider-row"><div><strong>Source repair</strong><span>' + escapeHtml(cap.code || '') + ' — ' + escapeHtml(cap.reason) + '</span></div><span class="connection-state ' + (cap.enabled ? 'ready' : '') + '">' + status + '</span></div><p class="settings-rule">' + escapeHtml(cap.nextStep || '') + '</p>' + evidence + '</div>';
  return html.replace('<div class="settings-section"><h3>Model connections</h3>', card + '<div class="settings-section"><h3>Model connections</h3>');
};
const renderWorkshopOverlayBeforeSettingsPolish = renderWorkshopOverlay;
renderWorkshopOverlay = function renderHighContrastSettingsOverlay() {
  let html = renderWorkshopOverlayBeforeSettingsPolish();
  if (state.panel !== 'settings') return html;
  const liveControls = '<div class="settings-section settings-actions"><h3>Joe Live</h3>' +
    '<p class="settings-rule">Choose how Joe presents the visible work account. These display preferences do not change permissions.</p>' +
    '<div class="settings-link-list">' +
      '<button type="button" class="settings-link-button ' + (state.speechEnabled ? 'active' : '') + '" id="settings-speech" aria-pressed="' + String(state.speechEnabled) + '">' +
        '<span><strong>Read responses aloud</strong><small>Speak Joe\'s visible progress and replies.</small></span>' +
        '<span class="settings-link-state">' + (state.speechEnabled ? 'On' : 'Off') + ' <b aria-hidden="true">&rsaquo;</b></span>' +
      '</button>' +
      '<button type="button" class="settings-link-button" id="settings-narration" aria-label="Change narration detail. Current setting: ' + escapeHtml(state.narrationDetail) + '">' +
        '<span><strong>Narration detail</strong><small>Cycle between quiet, normal, and detailed updates.</small></span>' +
        '<span class="settings-link-state">' + escapeHtml(state.narrationDetail[0].toUpperCase() + state.narrationDetail.slice(1)) + ' <b aria-hidden="true">&rsaquo;</b></span>' +
      '</button>' +
      '<button type="button" class="settings-link-button ' + (state.level === 'builder' ? 'active' : '') + '" id="settings-builder" aria-pressed="' + String(state.level === 'builder') + '">' +
        '<span><strong>Technical evidence details</strong><small>Show or hide the deeper builder-level records.</small></span>' +
        '<span class="settings-link-state">' + (state.level === 'builder' ? 'Shown' : 'Hidden') + ' <b aria-hidden="true">&rsaquo;</b></span>' +
      '</button>' +
    '</div></div>';
  html = html.replace('<section class="workshop-overlay overlay-wide">', '<section class="workshop-overlay overlay-wide settings-overlay" aria-labelledby="settings-title">');
  html = html.replace('<h2>Models, privacy, and behavior</h2>', '<h2 id="settings-title">Models, privacy, and behavior</h2><p class="settings-intro">Connection truth, guarded capabilities, and how Joe keeps you informed.</p>');
  html = html.replace(/<div class="settings-section"><h3>Joe Live<\/h3>[\s\S]*?<\/div><div class="overlay-actions">/, liveControls + '<div class="overlay-actions settings-done">');
  return html;
};

function speakJoe(text,force=false){if((!state.speechEnabled&&!force)||!('speechSynthesis'in window)||!text)return;const key=String(text).slice(0,500);if(!force&&key===lastSpokenKey)return;lastSpokenKey=key;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(String(text).replace(/\bEVC-[a-zA-Z0-9-]+\b/g,'the recorded evidence'));u.rate=1;u.pitch=.95;window.speechSynthesis.speak(u);}
function syncDetachedLive(){if(!detachedLiveWindow||detachedLiveWindow.closed)return;const x=state.narration||state.events.at(-1)||{what:'Joe is ready.',meaning:'Nothing is running.'};detachedLiveWindow.document.body.innerHTML=`<main><div class="k">JOE LIVE</div><h1>${escapeHtml(x.what)}</h1><p>${escapeHtml(x.meaning||'')}</p>${liveEvents().slice(0,10).map(liveItem).join('')}</main>`;}
function detachJoeLive(){detachedLiveWindow=window.open('','JoeCoderJoeLive','popup=yes,width=430,height=720,resizable=yes,scrollbars=yes');if(!detachedLiveWindow)return showError('The Joe Live window was blocked. Allow pop-ups and try again.');detachedLiveWindow.document.write('<!doctype html><title>Joe Live</title><style>body{margin:0;background:#1b1a18;color:#ece9e3;font:15px/1.55 Segoe UI,sans-serif}main{padding:28px}.k{color:#d4a373;font-size:11px;letter-spacing:.16em}.live-entry{padding:15px 0;border-top:1px solid #393632}.live-entry-meta{font-size:11px;color:#99948a}.live-entry-title{font-weight:600}.live-entry-meaning{color:#c9c5bc}</style><body></body>');detachedLiveWindow.document.close();syncDetachedLive();}

async function refreshWorkshopProject(projectId,preferred){const[a,b,c]=await Promise.all([api(`/api/v1/projects/${projectId}/threads`),api(`/api/v1/projects/${projectId}/brain`),api('/api/v1/workshop/settings')]);state.threads=a.threads||[];state.brain=b.brain;state.workshopSettings=c;const wanted=preferred||localStorage.getItem(`jc_thread_${projectId}`)||a.selectedThreadId;state.currentThread=state.threads.find(x=>x.id===wanted)||state.threads[0]||null;if(state.currentThread){const d=await api(`/api/v1/projects/${projectId}/threads/${state.currentThread.id}/chat`);state.messages=d.messages||[];state.chatSuggestions=[...state.messages].reverse().find(x=>x.role==='assistant')?.suggestions||[];localStorage.setItem(`jc_thread_${projectId}`,state.currentThread.id);}}
async function openThread(id){if(!state.currentProject||id===state.currentThread?.id)return;try{const d=await api(`/api/v1/projects/${state.currentProject.id}/threads/${id}/chat`);state.currentThread=d.thread;state.messages=d.messages||[];state.chatSuggestions=[...state.messages].reverse().find(x=>x.role==='assistant')?.suggestions||[];localStorage.setItem(`jc_thread_${state.currentProject.id}`,id);}catch(e){state.error=e.message;}render();}
async function setThreadPreset(id){if(!state.currentProject||!state.currentThread||id===state.currentThread.presetId)return;try{const d=await api(`/api/v1/projects/${state.currentProject.id}/threads/${state.currentThread.id}`,{method:'PATCH',body:JSON.stringify({presetId:id})});state.currentThread=d.thread;state.threads=state.threads.map(x=>x.id===d.thread.id?d.thread:x);showNotice(`${currentPreset().name} is guiding this conversation. It did not grant permission.`);}catch(e){state.error=e.message;}render();}
async function runThreadChat(content){const p=state.currentProject,t=state.currentThread;if(!p||!t||state.chatBusy)return;const epoch=viewEpoch;clearMessages();beginNarration('I am checking your request against the current project truth.','I am separating guidance from anything that would require permission.','I will answer with a safe, useful next step.');state.chatBusy=true;render();try{const d=await api(`/api/v1/projects/${p.id}/threads/${t.id}/chat`,{method:'POST',body:JSON.stringify({content})});if(epoch!==viewEpoch)return;state.currentThread=d.thread||t;state.messages=d.messages||[];state.chatSuggestions=d.reply?.suggestions||[];speakJoe(d.reply?.content||'');await refreshEvents(p.id);}catch(e){if(epoch!==viewEpoch)return;failNarration(e.message);state.error=e.message;}finally{if(epoch===viewEpoch){state.chatBusy=false;render();document.querySelector('#chat-messages .chat-message:last-child')?.scrollIntoView({behavior:'smooth'});}}}

function bindWorkshopControls(){document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=(e)=>{e.preventDefault();navigateToSurface(b.getAttribute('data-nav'));});document.querySelectorAll('[data-open-panel]').forEach(b=>b.onclick=()=>{state.panel=b.dataset.openPanel;render();});document.querySelectorAll('[data-close-panel]').forEach(b=>b.onclick=e=>{e.preventDefault();state.panel=null;render();});document.querySelectorAll('[data-open-thread]').forEach(b=>b.onclick=()=>openThread(b.dataset.openThread));document.querySelectorAll('[data-select-preset]').forEach(b=>b.onclick=()=>setThreadPreset(b.dataset.selectPreset));document.querySelectorAll('[data-live-tab]').forEach(b=>b.onclick=()=>{state.liveTab=b.dataset.liveTab;localStorage.setItem('jc_live_tab',state.liveTab);render();});document.querySelectorAll('[data-workshop-mode]').forEach(b=>b.onclick=()=>{state.composerMode=b.dataset.workshopMode;render();});document.querySelectorAll('[data-scroll-work-orders]').forEach(b=>b.onclick=()=>document.getElementById('work-orders-panel')?.scrollIntoView({behavior:'smooth'}));document.getElementById('composer-preset')?.addEventListener('change',e=>setThreadPreset(e.target.value));document.getElementById('btn-speech')?.addEventListener('click',()=>{state.speechEnabled=!state.speechEnabled;localStorage.setItem('jc_speech',state.speechEnabled?'1':'0');if(state.speechEnabled)speakJoe('Joe voice is on.',true);else window.speechSynthesis?.cancel();render();});document.getElementById('narration-detail')?.addEventListener('change',e=>{state.narrationDetail=e.target.value;localStorage.setItem('jc_narration_detail',state.narrationDetail);render();});document.getElementById('btn-detach-live')?.addEventListener('click',detachJoeLive);
document.getElementById('new-thread-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const d=await api(`/api/v1/projects/${state.currentProject.id}/threads`,{method:'POST',body:JSON.stringify({title:f.get('title'),objective:f.get('objective'),presetId:f.get('presetId')})});state.panel=null;await refreshWorkshopProject(state.currentProject.id,d.thread.id);render();}catch(x){state.error=x.message;render();}});
document.getElementById('thread-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const d=await api(`/api/v1/projects/${state.currentProject.id}/threads/${state.currentThread.id}`,{method:'PATCH',body:JSON.stringify({title:f.get('title'),objective:f.get('objective')})});state.currentThread=d.thread;state.threads=state.threads.map(x=>x.id===d.thread.id?d.thread:x);state.panel=null;render();}catch(x){state.error=x.message;render();}});
document.getElementById('brain-guidance-preset')?.addEventListener('change',e=>{const preview=document.getElementById('brain-guidance-preview'),preset=selectedBrainGuidancePreset(e.target.value);if(preview)preview.outerHTML=brainGuidancePreview(preset);});document.getElementById('brain-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),v=n=>f.get(n)||'',linked=[...new Set([...(state.brain?.evidenceIds||[]),state.latestSurvey?.evidenceId].filter(Boolean))];try{state.brain=(await api(`/api/v1/projects/${state.currentProject.id}/brain`,{method:'PUT',body:JSON.stringify({guidancePresetId:v('guidancePresetId'),purpose:v('purpose'),preferences:v('preferences'),environment:v('environment'),architecture:v('architecture'),constraints:v('constraints'),decisions:v('decisions'),knownIssues:v('knownIssues'),verifiedTruth:v('verifiedTruth'),evidenceIds:linked,freshnessAt:state.currentProject.lastInspectedAt||state.brain?.freshnessAt||null})})).brain;state.panel=null;showNotice((selectedBrainGuidancePreset(state.brain.guidancePresetId)?.name||'Project Brain')+' guidance saved. Notes remain context; evidence remains the source of truth.');render();}catch(x){state.error=x.message;render();}});
document.getElementById('settings-speech')?.addEventListener('click',()=>{state.speechEnabled=!state.speechEnabled;localStorage.setItem('jc_speech',state.speechEnabled?'1':'0');if(!state.speechEnabled)window.speechSynthesis?.cancel();render();});document.getElementById('settings-narration')?.addEventListener('click',()=>{const levels=['quiet','normal','detailed'],current=Math.max(0,levels.indexOf(state.narrationDetail));state.narrationDetail=levels[(current+1)%levels.length];localStorage.setItem('jc_narration_detail',state.narrationDetail);render();});document.getElementById('settings-builder')?.addEventListener('click',()=>{state.level=state.level==='builder'?'guided':'builder';localStorage.setItem('jc_ui_level',state.level);render();});}

const legacyOpenProjectWorkshop=openProject;openProject=async function(id){state.threads=[];state.currentThread=null;state.brain=null;state.panel=null;await legacyOpenProjectWorkshop(id);if(!state.currentProject||state.currentProject.id!==id)return;try{await refreshWorkshopProject(id);}catch(e){state.error=`The project opened, but its conversation workspace could not load: ${e.message}`;}render();};
runChat=async function(content){if(state.currentThread)return runThreadChat(content);};
const legacyRenderWorkshop=render;render=function(){legacyRenderWorkshop();if(state.csrfToken){document.getElementById('app')?.insertAdjacentHTML('beforeend',renderWorkshopOverlay());bindWorkshopControls();syncDetachedLive();}};


const legacyRefreshHealthWorkshop = refreshHealth;
refreshHealth = async function refreshHealthWorkshop() {
  await legacyRefreshHealthWorkshop();
  if (state.csrfToken) {
    try { state.workshopSettings = await api('/api/v1/workshop/settings'); }
    catch { state.workshopSettings = null; }
  }
};

// ---------- Active Work Order UX correction ----------

function workshopMessageHtml(message) {
  return '<div class="chat-message ' + (message.role === 'user' ? 'user' : 'assistant') + '"><div class="chat-role">' +
    (message.role === 'user' ? 'You' : 'Joe') + '</div><div class="chat-body">' + escapeHtml(message.content) + '</div></div>';
}
function shortWorkPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || normalized || 'unnamed file';
}
function plainAcceptanceText(criterion) {
  const value = String(criterion || '').toLowerCase();
  if (value.includes('scope')) return 'Only the approved files and actions were used';
  if (value.includes('budget')) return 'The change stayed inside the approved size and time limits';
  if (value.includes('runtime') || value.includes('build/test')) return 'Available project build and test checks did not fail';
  if (value.includes('hash') || value.includes('evidence')) return 'The saved result and its evidence were checked for integrity';
  if (value.includes('snapshot')) return 'A recovery copy existed before any file was changed';
  return criterion || 'The recorded completion check passed';
}
function renderPlainWorkPlan(workOrder, phase) {
  const paths = workOrder.scope?.exactPaths || workOrder.scope?.paths || [];
  const repair = (workOrder.scope?.operations || []).includes('edit_files');
  const names = paths.length
    ? paths.map(path => '<code title="' + escapeHtml(path) + '">' + escapeHtml(shortWorkPath(path)) + '</code>').join(', ')
    : 'no source files';
  const checks = (workOrder.acceptance || []).filter(item => item.mandatory).map(item =>
    '<li>' + escapeHtml(plainAcceptanceText(item.criterion)) + '</li>'
  ).join('');
  const steps = repair
    ? '<li><strong>Protect:</strong> Make a recovery copy of every approved file before editing.</li>' +
      '<li><strong>Change:</strong> Work only on ' + paths.length + ' approved file' + (paths.length === 1 ? '' : 's') + ': ' + names + '.</li>' +
      '<li><strong>Check:</strong> Run the project\'s available build and tests. If none exist, confirm the written files by hash and say clearly that app behavior is still unproven.</li>' +
      '<li><strong>Recover:</strong> If a required check fails, restore the original files automatically and mark the job failed.</li>'
    : '<li><strong>Collect:</strong> Gather the approved findings and linked evidence.</li>' +
      '<li><strong>Create:</strong> Write the handoff package only inside JoeCoder\'s <code>.jc/exports</code> folder.</li>' +
      '<li><strong>Protect:</strong> Leave the app\'s source files unchanged.</li>' +
      '<li><strong>Check:</strong> Verify the package evidence and record a completion receipt.</li>';
  const phaseNote = phase === 'authorize'
    ? '<div class="plain-plan-note"><strong>Authorize is permission, not execution.</strong> Pressing Authorize does not change any files. It locks this plan and unlocks one final Run button.</div>'
    : '<div class="plain-plan-note ready"><strong>Nothing has changed yet.</strong> Press ' + (repair ? 'Run and check this fix' : 'Create and check handoff') + ' to begin this exact plan.</div>';
  return '<div class="plain-work-plan"><div class="plain-plan-outcome"><span>Requested outcome</span><strong>' +
    escapeHtml(workOrder.objective || (repair ? 'Complete the recorded fix.' : 'Create the recorded handoff.')) +
    '</strong></div><ol>' + steps + '</ol>' + (checks ? '<details><summary>What must be true before Joe calls this complete</summary><ul>' + checks + '</ul></details>' : '') + phaseNote + '</div>';
}
function clientVerificationProofLevel(verification) {
  if (!verification || verification.status === 'failed') return verification?.status === 'failed' ? 'failed' : 'none';
  const items = verification.items || [];
  const runtime = items.filter(item => item.script === 'build' || item.script === 'test');
  if (runtime.length && runtime.every(item => item.passed)) return 'runtime';
  if (items.some(item => item.script === 'file_integrity' && item.passed)) return 'integrity';
  return 'none';
}
function renderRunCompletion(project) {
  const result = state.lastRunResult;
  if (!result || result.projectId !== project.id) return '';
  const workOrder = state.workOrders.find(item => item.id === result.workOrderId);
  if (!workOrder || workOrder.status !== 'completed') return '';
  const repair = result.action === 'apply_edits';
  const verification = result.verification || {};
  const items = verification.items || [];
  const proofLevel = repair ? clientVerificationProofLevel(verification) : 'runtime';
  const runtimePassed = proofLevel === 'runtime';
  const integrityPassed = proofLevel === 'integrity';
  const changed = (result.applied || []).map(item => item.relPath).filter(Boolean);
  const completedAt = Date.parse(result.completedAt || workOrder.completion?.decidedAt || '');
  const compact = Number.isFinite(completedAt) && state.messages.some(message => Date.parse(message.createdAt || '') > completedAt);
  const title = !repair
    ? 'Handoff created and verified'
    : runtimePassed
      ? 'Fix finished - available project checks passed'
      : integrityPassed
        ? 'Files changed and confirmed - runtime still unproven'
        : 'File operation finished - proof needs review';
  const proofLabel = !repair
    ? 'Handoff verified'
    : runtimePassed
      ? 'Runtime verified'
      : integrityPassed
        ? 'Files confirmed'
        : 'Needs review';
  const proof = !repair
    ? 'Joe wrote the authorized handoff under .jc only and left source files unchanged.'
    : runtimePassed
      ? 'The approved files were changed, and every available build or test that ran passed.'
      : integrityPassed
        ? 'The approved files were changed and hash-confirmed. No runnable build or test proved application behavior.'
        : verification.detail || 'The file operation returned without sufficient runtime proof.';
  const itemRows = items.map(item => '<li class="' + (item.passed ? 'passed' : 'failed') + '"><strong>' +
    escapeHtml(item.script === 'file_integrity' ? 'Saved-file integrity' : item.script + ' check') + ':</strong> ' +
    escapeHtml(item.passed ? 'passed' : 'failed') + (item.root ? ' (' + escapeHtml(item.root) + ')' : '') + '</li>').join('');
  const acceptanceRows = (workOrder.completion?.acceptanceResults || []).map(item => '<li class="' + (item.passed ? 'passed' : 'failed') + '">' +
    escapeHtml(plainAcceptanceText(item.criterion)) + ': <strong>' + (item.passed ? 'passed' : 'failed') + '</strong></li>').join('');
  const body = '<p>' + escapeHtml(proof) + '</p>' +
    (changed.length ? '<div class="completion-files"><strong>Files changed:</strong> ' + changed.map(path => '<code title="' + escapeHtml(path) + '">' + escapeHtml(shortWorkPath(path)) + '</code>').join(', ') + '</div>' : '') +
    (result.exportPath ? '<div class="completion-files"><strong>Handoff location:</strong> <code>' + escapeHtml(result.exportPath) + '</code></div>' : '') +
    (itemRows ? '<details ' + (compact ? '' : 'open') + '><summary>Checks Joe actually ran</summary><ul>' + itemRows + '</ul></details>' : '') +
    (acceptanceRows ? '<details><summary>All recorded completion rules</summary><ul>' + acceptanceRows + '</ul></details>' : '') +
    (result.evidenceId ? '<p class="completion-evidence">Evidence receipt: <code>' + escapeHtml(result.evidenceId) + '</code></p>' : '');
  const badgeClass = runtimePassed || !repair ? 'ok' : integrityPassed ? 'warn' : 'warn';
  if (compact) {
    return '<details class="run-completion compact"><summary><span><small>Recorded result</small><strong>' + escapeHtml(title) +
      '</strong></span><span class="badge ' + badgeClass + '">' + escapeHtml(proofLabel) + ' &middot; View proof</span></summary><div class="run-completion-body">' + body + '</div></details>';
  }
  return '<section class="run-completion" aria-live="polite"><div class="run-completion-head"><div><div class="eyebrow">Recorded result</div><h3>' +
    escapeHtml(title) + '</h3></div><span class="badge ' + badgeClass + '">' + escapeHtml(proofLabel) + '</span></div>' + body + '</section>';
}function renderWorkshopConversation() {
  if (!state.currentProject) return '';
  const recent = state.messages.slice(-6), older = state.messages.slice(0, -6);
  const messages = recent.length ? recent.map(workshopMessageHtml).join('') :
    '<div class="chat-message assistant"><div class="chat-role">Joe</div><div class="chat-body">Tell me what you want to understand, build, or repair. Conversation shapes the objective; guarded checkpoints control permission and execution.</div></div>';
  const history = older.length ? '<details class="earlier-conversation"><summary>Show ' + older.length + ' earlier messages</summary><div class="chat-messages">' + older.map(workshopMessageHtml).join('') + '</div></details>' : '';
  return '<section class="chat-stream workshop-conversation"><div class="conversation-section-head"><h2>Recent conversation</h2>' + history +
    '</div><div id="chat-messages" class="chat-messages" aria-live="polite">' + messages + '</div></section>';
}
function activeScopeHtml(workOrder) {
  const ops = workOrder.scope?.operations || [], paths = workOrder.scope?.exactPaths || workOrder.scope?.paths || [], limits = workOrder.budgets || {};
  return '<details class="active-resolution-scope"><summary>See exact scope and limits</summary><div><strong>Operations:</strong> ' +
    (ops.length ? ops.map(escapeHtml).join(', ') : 'None recorded') + '</div><div><strong>Paths:</strong> ' +
    (paths.length ? paths.map(escapeHtml).join(', ') : 'No source paths') + '</div><div><strong>Limits:</strong> ' +
    escapeHtml([limits.maxFiles != null ? limits.maxFiles + ' files' : '', limits.maxDurationMs != null ? Math.round(limits.maxDurationMs / 1000) + ' seconds' : '',
      limits.maxCloudCostUsd != null ? '$' + limits.maxCloudCostUsd + ' cloud' : ''].filter(Boolean).join(' / ') || 'Recorded limits only') + '</div></details>';
}
function renderActiveResolution(workOrder) {
  if (!workOrder) return '';
  const repair = (workOrder.scope?.operations || []).includes('edit_files');
  const review = state.reviewAction?.id === workOrder.id ? state.reviewAction.type : null;
  const evidence = workOrder.linkedSurveyIntegrity || { verified: false, reason: 'Evidence readiness was not reported.' };
  const authorizationSealed = workOrder.authorization?.envelopeVersion === 1 && Boolean(workOrder.authorization?.envelopeHash);
  let controls = '';
  const repairHold = repair && !sourceRepairCapability().enabled;
  if (workOrder.status === 'authorized' && !authorizationSealed && review !== 'cancel') {
    controls = '<section class="active-resolution-decision danger-review" aria-live="polite"><div class="eyebrow">Legacy authorization blocked</div><h3>A fresh immutable grant is required</h3><p>This Work Order was authorized before envelope sealing. It cannot execute because its exact scope, limits, evidence, and project identity were not sealed together.</p><div class="active-resolution-actions"><button class="secondary" data-review-cancel="' +
      escapeHtml(workOrder.id) + '">Review Cancellation</button></div></section>';
  } else if (repairHold) {
    const cancel = ['draft', 'authorized'].includes(workOrder.status) ? '<button class="secondary" data-review-cancel="' +
      escapeHtml(workOrder.id) + '">Review Cancellation</button>' : '';
    controls = '<section class="active-resolution-decision danger-review" aria-live="polite"><div class="eyebrow">Source repair safety hold</div><h3>This repair cannot run</h3><p>' +
      escapeHtml(sourceRepairCapability().reason) + '</p><p>' + escapeHtml(sourceRepairCapability().nextStep || '') +
      '</p><div class="active-resolution-actions">' + cancel + '</div></section>';
  } else if (review === 'apply' && workOrder.status === 'authorized') {
    controls = '<section class="active-resolution-decision" aria-live="polite"><div class="eyebrow">Final execution checkpoint</div><h3>' +
      (repair ? 'Ready to run and check this fix' : 'Ready to create and check this handoff') + '</h3>' + renderPlainWorkPlan(workOrder, 'run') +
      '<div class="active-resolution-actions"><button class="success" data-confirm-apply="' + escapeHtml(workOrder.id) + '">' +
      (repair ? 'Run and Check This Fix' : 'Create and Check Handoff') + '</button><button class="secondary" data-close-review="' +
      escapeHtml(workOrder.id) + '">Back Without Running</button></div></section>';
  } else if (review === 'cancel' && ['draft', 'authorized'].includes(workOrder.status)) {
    controls = '<section class="active-resolution-decision danger-review" aria-live="polite"><h3>Cancel ' + escapeHtml(workOrder.id) +
      '?</h3><p>This releases the active slot and removes its permission. It does not change source files.</p><div class="active-resolution-actions">' +
      '<button class="danger" data-confirm-cancel="' + escapeHtml(workOrder.id) + '">Cancel This Work Order</button><button class="secondary" data-close-review="' +
      escapeHtml(workOrder.id) + '">Keep It Active</button></div></section>';
  } else if (review === 'authorize' && workOrder.status === 'draft') {
    controls = '<section class="active-resolution-decision" aria-live="polite"><h3>' + (evidence.verified ? 'Authorize only this recorded plan?' : 'Fresh evidence is required') +
      '</h3>' + (evidence.verified ? renderPlainWorkPlan(workOrder, 'authorize') : '<p>' + escapeHtml(evidence.reason) + '</p>') +
      '<div class="active-resolution-actions">' + (evidence.verified ?
        '<button class="success" data-confirm-authorize="' + escapeHtml(workOrder.id) + '">Authorize This Plan</button>' :
        '<button data-recover-authorize="' + escapeHtml(workOrder.id) + '">Cancel Draft &amp; Run Fresh Inspection</button>') +
      '<button class="secondary" data-close-review="' + escapeHtml(workOrder.id) + '">Back Without Authorizing</button></div></section>';
  } else {
    const main = workOrder.status === 'authorized' ? '<button class="success" data-review-apply="' + escapeHtml(workOrder.id) + '">Review &amp; ' +
      (repair ? 'Run Repair' : 'Create Export') + '</button>' : workOrder.status === 'draft' ?
      '<button class="success" data-review-authorize="' + escapeHtml(workOrder.id) + '">Review &amp; Authorize</button>' :
      '<span class="active-running">Joe is completing the recorded work now.</span>';
    const cancel = ['draft', 'authorized'].includes(workOrder.status) ? '<button class="secondary" data-review-cancel="' +
      escapeHtml(workOrder.id) + '">Review Cancellation</button>' : '';
    controls = '<div class="active-resolution-actions">' + main + cancel + '</div>';
  }
  return '<section id="active-work-resolution" class="active-resolution-card"><div class="active-resolution-top"><div><div class="active-resolution-kicker">One guarded step is waiting</div>' +
    '<h2>Finish ' + escapeHtml(workOrder.id) + ' first</h2><p>' + escapeHtml(workOrder.objective || 'Complete the recorded Work Order.') +
    '</p></div><span class="badge ok">' + escapeHtml(workOrder.status) + '</span></div><p class="active-resolution-explanation">' +
    'Joe is waiting for one decision, not looping. Fresh inspection waits, and a new plan stays unavailable until this Work Order is finished or cancelled.</p>' +
    activeScopeHtml(workOrder) + controls + '</section>';
}
function focusActiveWork(workOrder, message) {
  if (!workOrder) return;
  state.error = null; state.notice = message || workOrder.id + ' is the current guarded step.'; state.composerMode = 'agent';
  beginNarration('I am holding the workspace at ' + workOrder.id + '.', 'I have not started another inspection or changed the build.',
    'Review the visible Work Order, then run its exact scope or cancel it.');
  render();
  requestAnimationFrame(() => document.getElementById('active-work-resolution')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
const runInspectBeforeActiveUX = runInspect;
runInspect = async function runInspectFromWorkshop() {
  const active = activeProjectWorkOrder();
  if (active) return focusActiveWork(active, 'Finish or cancel ' + active.id + ' before starting a fresh inspection.');
  return runInspectBeforeActiveUX();
};
openWorkOrderReview = function openWorkshopWorkOrderReview(type, id) {
  const workOrder = state.workOrders.find(item => item.id === id);
  if (!workOrder) return showError('Work Order not found in this project.');
  if (type === 'apply' && (workOrder.scope?.operations || []).includes('edit_files') && !sourceRepairCapability().enabled) {
    return showError(sourceRepairCapability().reason);
  }  const allowed = (type === 'authorize' && workOrder.status === 'draft') || (type === 'apply' && workOrder.status === 'authorized') ||
    (type === 'cancel' && ['draft', 'authorized'].includes(workOrder.status));
  if (!allowed) return showError('That decision is unavailable while ' + workOrder.id + ' is ' + workOrder.status + '.');
  clearMessages(); state.reviewAction = { type, id }; state.composerMode = 'agent';
  beginNarration('I opened the ' + type + ' decision for ' + workOrder.id + '.', 'Nothing has run and no permission has changed.',
    'Review the exact scope and choose the clearly labelled action.');
  render();
  requestAnimationFrame(() => document.getElementById('active-work-resolution')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
};
const renderComposerBeforeRepairGate = renderComposer;
renderComposer = function renderComposerWithRepairGate() {
  const html = renderComposerBeforeRepairGate(), cap = sourceRepairCapability();
  if (cap.enabled) {
    return html;
  }
  const heldRepair = '<button type="button" id="btn-draft-repair" disabled title="' + escapeHtml(cap.reason) + '">Source repair unavailable</button>';
  const heldBuild = '<button type="button" id="btn-draft-build" disabled title="' + escapeHtml(cap.reason) + '">Build unavailable</button>';
  return html
    .replace(/<button[^>]*id="btn-draft-repair"[^>]*>[\s\S]*?<\/button>/g, heldRepair)
    .replace(/<button[^>]*id="btn-draft-build"[^>]*>[\s\S]*?<\/button>/g, heldBuild)
    .replace('</div><div class="agent-composer', '<p class="muted form-hint">' + escapeHtml(cap.reason) + ' ' + escapeHtml(cap.nextStep || '') + '</p></div><div class="agent-composer');
};
const renderComposerBeforeActiveUX = renderComposer;
renderComposer = function renderWorkshopComposerV2() {
  const active = activeProjectWorkOrder();
  if (!active) return renderComposerBeforeActiveUX();
  const mode = ['ask', 'plan', 'agent'].includes(state.composerMode) ? state.composerMode : 'agent';
  const options = (state.workshopSettings?.presets || []).map(item => '<option value="' + escapeHtml(item.id) + '" ' +
    (item.id === currentPreset().id ? 'selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('');
  return '<div class="composer-dock"><div class="chat-suggestions active-route"><button class="chip-btn" data-continue-active="' +
    escapeHtml(active.id) + '">Continue ' + escapeHtml(active.id) + '</button><span>New inspection and planning wait until this is resolved.</span></div>' +
    '<div class="composer-card"><div class="composer-toolbar"><button class="attach-context" data-open-panel="brain">+</button><select id="composer-preset">' +
    (options || '<option>Auto</option>') + '</select><span class="model-route">Current route: ' + escapeHtml(active.id) + '</span><div class="composer-tabs">' +
    ['ask', 'plan', 'agent'].map(value => '<button class="composer-tab ' + (mode === value ? 'active' : '') + '" data-workshop-mode="' + value + '">' +
      (value === 'ask' ? 'Ask Joe' : value[0].toUpperCase() + value.slice(1)) + '</button>').join('') + '</div></div>' +
    '<form id="chat-form" class="' + (mode === 'ask' ? '' : 'hidden') + '"><textarea id="chat-input" rows="2" maxlength="4000" required placeholder="Ask Joe what is happening or what comes next..."></textarea>' +
    '<div class="composer-row"><span class="composer-hint">' + (state.chatBusy ? 'Joe is checking the current truth...' : 'Enter to send &middot; Shift+Enter for a new line') +
    '</span><button ' + (state.chatBusy ? 'disabled' : '') + '>' + (state.chatBusy ? 'Responding...' : 'Send') + '</button></div></form>' +
    '<div id="draft-composer" class="' + (mode === 'plan' ? '' : 'hidden') + '"><div class="composer-remediation"><div><strong>Planning waits for ' +
    escapeHtml(active.id) + '.</strong><span>Finish or cancel the current Work Order before creating another plan.</span></div><button data-continue-active="' +
    escapeHtml(active.id) + '">Continue Work Order</button></div></div><div class="agent-composer ' + (mode === 'agent' ? '' : 'hidden') + '"><div><strong>' +
    escapeHtml(active.id) + '</strong> is the only executable path. Joe stays inside its recorded scope.</div><button data-continue-active="' +
    escapeHtml(active.id) + '">Review Next Decision</button></div></div><p class="chat-guardrail">Conversation guides the objective. Scope, permission, execution, and completion remain separate and evidence-gated.</p></div>';
};

const AUTO_JOB_STAGE_ORDER = [
  { id: 'chat', label: 'Understand' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'plan', label: 'Plan' },
  { id: 'authorize', label: 'Protect' },
  { id: 'run', label: 'Change' },
  { id: 'check', label: 'Verify' }
];

function inferAutoJobIntent(objective, survey) {
  const text = String(objective || '').toLowerCase();
  const asksForChange = /\b(fix|repair|change|update|refactor|redesign|replace|remove|add|implement|improve|finish|complete|wire|connect|correct|build|create|scaffold)\b/.test(text);
  const asksForReadOnly = /\b(inspect|review|audit|analy[sz]e|assess|survey|explain|investigate|diagnose|report|find bugs|look for bugs)\b/.test(text);
  if (asksForReadOnly && !asksForChange) return 'inspect';
  const totalFiles = Number(survey?.summary?.totalFiles ?? survey?.result?.summary?.totalFiles ?? 999999);
  const asksForNewBuild = /\b(build|create|scaffold|start|new app|new site|from scratch)\b/.test(text);
  return totalFiles === 0 && asksForNewBuild ? 'build' : 'repair';
}

function autoJobProjectStillOpen(projectId) {
  if (state.currentProject?.id !== projectId) {
    throw new Error('The automatic job stopped because you left its project. Return to the project to review its current recorded state.');
  }
}

function setAutoJobStage(stage, message, what, meaning, next) {
  if (!state.autoJob) return;
  state.autoJob = { ...state.autoJob, stage, message };
  if (what) beginNarration(what, meaning || message, next || 'Joe will stop if a guardrail cannot be proven.');
  render();
}

function renderAutoJobStatus() {
  const job = state.autoJob;
  if (!job || job.status === 'done') return '';
  const currentIndex = AUTO_JOB_STAGE_ORDER.findIndex(item => item.id === job.stage);
  const steps = AUTO_JOB_STAGE_ORDER.map((item, index) => {
    const stepState = job.status === 'failed' && index === currentIndex
      ? 'failed'
      : index < currentIndex
        ? 'done'
        : index === currentIndex
          ? 'current'
          : 'waiting';
    return '<div class="auto-job-step ' + stepState + '"><span>' + (index + 1) + '</span><strong>' + escapeHtml(item.label) + '</strong></div>';
  }).join('');
  return '<section class="auto-job-status ' + (job.status === 'failed' ? 'failed' : '') + '" aria-live="polite">' +
    '<div class="auto-job-head"><div><div class="eyebrow">Joe automatic job</div><h2>' +
    escapeHtml(job.status === 'failed' ? 'Stopped safely' : 'Handling the job') + '</h2></div><span class="badge ' +
    (job.status === 'failed' ? 'warn' : 'ok') + '">' + escapeHtml(job.status === 'failed' ? 'Needs review' : 'Working') + '</span></div>' +
    '<p class="auto-job-objective">' + escapeHtml(job.objective) + '</p><div class="auto-job-steps">' + steps + '</div>' +
    '<p class="auto-job-message">' + escapeHtml(job.message || 'Joe is moving through the guarded stages.') + '</p>' +
    '<p class="auto-job-boundary">One objective, one sealed Work Order, one mutation attempt. Scope cannot expand. Failed checks stop and restore the snapshot.</p></section>';
}

async function refreshAutoJobProject(projectId) {
  const data = await api('/api/v1/projects/' + projectId);
  autoJobProjectStillOpen(projectId);
  state.currentProject = data.project;
  state.latestSurvey = data.latestSurvey || null;
  return data;
}

async function runAutomatedJob(requestedObjective, activeWorkOrderId = null) {
  const project = state.currentProject;
  const thread = state.currentThread;
  if (!project || !thread) return showError('Open a project conversation before starting an automatic job.');
  if (state.autoJob?.running) return showNotice('Joe is already handling this job.');
  const active = activeWorkOrderId
    ? state.workOrders.find(item => item.id === activeWorkOrderId)
    : activeProjectWorkOrder();
  if (active && !activeWorkOrderId) {
    return showError('A guarded job is already active. Tell Joe to continue, or use Resume job, so it completes that recorded scope instead of starting another.');
  }

  let objective = String(active?.objective || requestedObjective || '').trim();
  if (!objective) return showError('Tell Joe the outcome you want, then press Send.');
  if (objective.length > 500) return showError('Keep the automatic job request under 500 characters so its authorization stays precise.');
  const projectId = project.id;
  let workOrder = active || null;
  let result = null;

  clearMessages();
  state.lastRunResult = null;
  state.reviewAction = null;
  state.autoJob = {
    running: true,
    status: 'running',
    stage: workOrder ? 'authorize' : 'chat',
    objective,
    message: workOrder ? 'Taking over the existing bounded Work Order.' : 'Recording your objective in this conversation.'
  };
  state.busy = true;
  state.chatBusy = true;
  state.joeStatus = 'working';
  beginNarration(
    workOrder ? 'I am taking over the current Work Order.' : 'I am taking responsibility for this bounded job.',
    'Your Send action authorizes Joe to move through the guarded stages for this one clear work request without asking at every checkpoint.',
    'I will stop on missing evidence, unsafe scope, unavailable capability, failed verification, or incomplete rollback.'
  );
  render();

  try {
    if (!workOrder) {
      setAutoJobStage('chat', 'Recording the objective and checking it against current project truth.',
        'I am recording your request in the project conversation.',
        'The work request supplies the objective and an explicit one-job grant; server guardrails still control every permitted operation.',
        'Next I will establish fresh evidence if the project needs it.');
      const chat = await api('/api/v1/projects/' + projectId + '/threads/' + thread.id + '/chat', {
        method: 'POST',
        body: JSON.stringify({ content: objective }),
        timeoutMs: 30000
      });
      autoJobProjectStillOpen(projectId);
      state.currentThread = chat.thread || thread;
      state.messages = chat.messages || [];
      state.chatSuggestions = chat.reply?.suggestions || [];

      const needsInspection = !state.currentProject.latestSurveyId ||
        state.latestSurvey?._integrity?.verified === false ||
        ['folder_selected', 'complete', 'partial', 'blocked', 'cancelled'].includes(state.currentProject.workflowStage);
      setAutoJobStage('inspect',
        needsInspection ? 'Reading the build without changing it.' : 'Using the current verified inspection.',
        needsInspection ? 'I am running a fresh read-only inspection.' : 'I found a current verified inspection.',
        needsInspection ? 'This establishes the file inventory and project revision before planning.' : 'The recorded evidence is still current for this project revision.',
        'Next I will accept the observed build for bounded planning.');
      if (needsInspection) {
        await api('/api/v1/survey', {
          method: 'POST',
          body: JSON.stringify({ path: project.path, projectId }),
          timeoutMs: 120000
        });
        autoJobProjectStillOpen(projectId);
      }
      await refreshAutoJobProject(projectId);

      setAutoJobStage('plan', 'Selecting the safe job type and asking the configured model route for an exact plan.',
        'I am accepting the inspected build and planning the smallest complete job.',
        'Acceptance stays read-only. The model may propose files, but server guardrails decide whether that scope is valid.',
        'A valid plan will be sealed to this objective before execution.');
      const accepted = await api('/api/v1/projects/' + projectId + '/accept', { method: 'POST', body: '{}' });
      autoJobProjectStillOpen(projectId);
      if (accepted.project) state.currentProject = accepted.project;
      const intent = inferAutoJobIntent(objective, state.latestSurvey);
      const draft = await api('/api/v1/work-orders/from-survey', {
        method: 'POST',
        body: JSON.stringify({ surveyId: state.currentProject.latestSurveyId, objective, intent }),
        timeoutMs: intent === 'inspect' ? 30000 : 210000
      });
      autoJobProjectStillOpen(projectId);
      workOrder = draft.workOrder;
      if (!workOrder?.id) throw new Error('Joe did not receive a valid Work Order from the planning stage.');
    }

    setAutoJobStage('authorize', 'Sealing the exact scope and recording your one-job automatic grant.',
      'I am validating and sealing the Work Order.',
      'The grant is evidence-linked to this project, conversation, exact objective, scope, budgets, and one attempt.',
      'If the sealed envelope is valid, I will run it without another approval prompt.');
    if (workOrder.status === 'draft') {
      const authorization = await api('/api/v1/work-orders/' + workOrder.id + '/authorize', {
        method: 'POST',
        body: JSON.stringify({
          grantedBy: 'local-operator:auto-job',
          automationGrant: {
            mode: 'bounded_auto_job',
            projectId,
            threadId: thread.id,
            objective: workOrder.objective,
            maxAttempts: 1
          }
        })
      });
      autoJobProjectStillOpen(projectId);
      workOrder = authorization.workOrder;
    }
    if (workOrder.status !== 'authorized') {
      throw new Error('Automatic execution requires a successfully sealed authorized Work Order; current status is ' + workOrder.status + '.');
    }

    const repair = (workOrder.scope?.operations || []).includes('edit_files');
    setAutoJobStage('run', repair ? 'Protecting the approved files, making the change, and running project checks.' : 'Creating the approved handoff without changing source files.',
      repair ? 'I am running the sealed repair now.' : 'I am creating the sealed read-only handoff now.',
      repair ? "Joe snapshots first, writes only approved files, and uses the project's available build and tests." : 'All output stays under JoeCoder protected storage.',
      repair ? 'Failed verification triggers restoration before Joe reports the result.' : 'Completion still requires verified handoff evidence.');
    result = await api('/api/v1/work-orders/' + workOrder.id + '/apply', {
      method: 'POST',
      body: JSON.stringify({ action: repair ? 'apply_edits' : 'export_handoff' }),
      timeoutMs: repair ? 640000 : 90000
    });
    autoJobProjectStillOpen(projectId);

    setAutoJobStage('check', 'Reading the completion evidence and reporting only what was actually proven.',
      'The authorized action finished. I am checking its recorded proof.',
      'Completion is derived from mandatory evidence; it is never declared just because the process returned.',
      'I will show the files, checks, and evidence receipt in the workspace.');
    const proofLevel = repair ? clientVerificationProofLevel(result.verification) : 'runtime';
    state.lastRunResult = {
      projectId,
      workOrderId: workOrder.id,
      action: repair ? 'apply_edits' : 'export_handoff',
      applied: result.applied || [],
      verification: result.verification || null,
      evidenceId: result.evidenceId || null,
      exportPath: result.exportPath || null,
      completedAt: new Date().toISOString()
    };
    await openProject(projectId);
    state.reviewAction = null;
    state.stage = 'complete';
    state.joeStatus = repair && proofLevel !== 'runtime' ? 'waiting' : 'complete';
    state.autoJob = {
      running: false,
      status: 'done',
      stage: 'check',
      objective,
      message: proofLevel === 'runtime' || !repair
        ? 'The bounded job finished with its proof receipt.'
        : 'The file change finished, but runtime behavior remains unproven.'
    };
    beginNarration(
      !repair
        ? 'I created and verified the bounded handoff.'
        : proofLevel === 'runtime'
          ? 'I finished the bounded automatic job with passing runtime checks.'
          : proofLevel === 'integrity'
            ? 'I finished the authorized file change; runtime behavior remains unproven.'
            : 'I finished the file operation without enough runtime proof.',
      !repair
        ? 'The handoff stayed under JoeCoder storage and source files remained unchanged.'
        : proofLevel === 'runtime'
          ? 'The available project build or tests passed after the approved changes.'
          : 'The changed files were hash-checked, but no runnable build or test proved the application behavior.',
      proofLevel === 'runtime' || !repair
        ? 'Continue chatting about the result or describe the next job.'
        : 'Review the recorded files, then add or run a real build/test before treating the product as verified.'
    );
    showNotice(proofLevel === 'runtime' || !repair
      ? 'Bounded job finished with verified proof. Keep chatting with Joe.'
      : 'File change recorded; runtime remains unproven. Review the proof in the conversation.');
  } catch (error) {
    try {
      if (state.currentProject?.id === projectId) await openProject(projectId);
    } catch {}
    const rolledBack = error?.details?.rolledBack === true;
    const rollbackIncomplete = error?.code === 'ROLLBACK_INCOMPLETE' || error?.details?.rollbackRequired === true;
    state.autoJob = {
      running: false,
      status: 'failed',
      stage: state.autoJob?.stage || 'check',
      objective,
      message: rollbackIncomplete
        ? 'Joe stopped. Complete rollback could not be proven, so further automatic mutation is blocked.'
        : rolledBack
          ? 'Joe stopped and restored the pre-job snapshot.'
          : 'Joe stopped before it could prove safe completion.'
    };
    state.joeStatus = 'blocked';
    failNarration(
      error.message,
      rollbackIncomplete
        ? 'Review the reported recovery evidence before any further mutation.'
        : rolledBack
          ? 'The original files were restored. Review the failed check before trying a new bounded job.'
          : 'Review the visible guardrail result; Joe will not widen the job or silently continue.'
    );
    showError(error);
  } finally {
    state.busy = false;
    state.chatBusy = false;
    render();
  }
}

// Automatic jobs enter through the same Send action as normal conversation.
// The smart-chat renderer below keeps the guarded engine behind one prompt.
/** Ordered job pipeline — one primary action at a time. */
function isLegacyBlocked(wo) {
  if (!wo || wo.status !== 'authorized') return false;
  const a = wo.authorization || {};
  return !(a.envelopeVersion === 1 && a.envelopeHash);
}
// ---------- Conversation-first project workspace ----------

function shouldAutoHandle(content) {
  const text = String(content || '').trim().toLowerCase().replace(/\b(?:staus|stauts|statsu)\b/g, 'status');
  if (!text) return false;

  const informational = /^(what|why|how|when|where|who|which|did|does|is|are|am|was|were|tell me|explain|summari[sz]e|status|show me the status)( |$)/;
  const statusIntent = /\bstatus\b|\bwhere (?:are|is)\b|\bwhat(?:'s| is) (?:happening|next|left)\b/;
  const planOnly = /^\s*(?:plan|outline|propose|map out|help me plan)\b/;
  const action = /(^|[^a-z])(fix|repair|change|update|refactor|redesign|replace|remove|add|make|solve|address|implement|improve|refine|polish|finish|complete|wire|connect|correct|debug|resolve|build|create|scaffold|code|develop|design|write|edit|modify|install|upgrade|migrate|configure|set up|setup|optimi[sz]e|clean up|test|run|execute)([^a-z]|$)/;
  const readOnlyCommand = /^(inspect|review|audit|analy[sz]e|assess|survey|investigate|diagnose|find bugs|look for bugs|check (the )?(build|app|site|code|tests?|wiring|ui|files?))( |$)/;
  const continuation = /^(proceed|continue|go ahead|do it|handle it|finish it|resume|keep going)( |$)/;

  if (informational.test(text) || statusIntent.test(text) || planOnly.test(text)) return false;
  if (continuation.test(text)) return Boolean(activeProjectWorkOrder());
  if (readOnlyCommand.test(text)) return true;
  if (/^(can|could|would|will) you( |$)/.test(text) && action.test(text)) return true;
  if (text.endsWith('?')) return false;
  return action.test(text);
}
renderAutoJobStatus = function renderCompactAutoJobStatus() {
  const job = state.autoJob;
  if (!job || job.status === 'done') return '';
  const index = Math.max(0, AUTO_JOB_STAGE_ORDER.findIndex(item => item.id === job.stage));
  const step = AUTO_JOB_STAGE_ORDER[index] || AUTO_JOB_STAGE_ORDER[0];
  const percent = Math.round(((index + (job.status === 'failed' ? 0 : 0.45)) / AUTO_JOB_STAGE_ORDER.length) * 100);
  const failed = job.status === 'failed';
  return '<section class="codex-job-status ' + (failed ? 'failed' : '') + '" aria-live="polite">' +
    '<div class="codex-job-status-line"><span class="activity-dot"></span><strong>' +
    escapeHtml(failed ? 'Joe stopped safely' : step.label + ' - Joe is working') + '</strong><span>' +
    escapeHtml(failed ? 'Review needed' : 'Step ' + (index + 1) + ' of ' + AUTO_JOB_STAGE_ORDER.length) + '</span></div>' +
    '<p>' + escapeHtml(job.message || 'Working through the guarded job.') + '</p>' +
    '<div class="codex-progress" aria-hidden="true"><span style="width:' + Math.max(4, Math.min(100, percent)) + '%"></span></div>' +
    '<details><summary>Safety boundary</summary><div>One objective, one sealed Work Order, one attempt. Joe cannot widen scope. Failed checks stop the job and trigger restoration.</div></details>' +
    '</section>';
};

function renderCodexConversation() {
  const project = state.currentProject;
  if (!project) return '';
  const visible = state.messages.slice(-80);
  const omitted = Math.max(0, state.messages.length - visible.length);
  const completion = renderRunCompletion(project);
  const completedAt = Date.parse(state.lastRunResult?.completedAt || '');
  let completionInserted = false;
  let transcript = visible.map(message => {
    const messageTime = Date.parse(message.createdAt || '');
    const beforeMessage = completion && !completionInserted && Number.isFinite(completedAt) && Number.isFinite(messageTime) && messageTime > completedAt
      ? (completionInserted = true, completion)
      : '';
    return beforeMessage + workshopMessageHtml(message);
  }).join('');
  if (completion && !completionInserted) transcript += completion;
  const intro = '<div class="chat-message assistant codex-intro"><div class="chat-role">Joe</div><div class="chat-body">' +
    'Tell me the outcome you want. I will inspect what is there, plan the smallest complete job, make only bounded changes, run the available checks, and report what was actually proven. Ask a question anytime - questions do not start work.' +
    '</div></div>';
  return '<section class="codex-conversation" aria-label="Conversation">' +
    (omitted ? '<p class="codex-older-note">' + omitted + ' older messages remain in this conversation.</p>' : '') +
    '<div id="chat-messages" class="chat-messages" aria-live="polite">' +
    (transcript || intro) +
    '</div></section>';
}
function renderCodexActiveJob(workOrder) {
  if (!workOrder || state.autoJob?.running) return '';
  const repair = (workOrder.scope?.operations || []).includes('edit_files');
  const blocked = isLegacyBlocked(workOrder) || (repair && !sourceRepairCapability().enabled);
  const status = workOrder.status === 'draft'
    ? 'Planned and waiting'
    : workOrder.status === 'authorized'
      ? 'Protected and ready'
      : 'In progress';
  const action = blocked
    ? '<button type="button" class="secondary" data-open-details>Review safety hold</button>'
    : workOrder.status === 'executing'
      ? '<button type="button" class="secondary" data-refresh-project>Refresh status</button>'
      : '<button type="button" class="codex-resume" data-resume-auto="' + escapeHtml(workOrder.id) + '">Resume job</button>';
  return '<section class="codex-active-job"><div><span>Current job - ' + escapeHtml(workOrder.id) + ' - ' +
    escapeHtml(status) + '</span><strong>' + escapeHtml(workOrder.objective || 'Complete the recorded job.') +
    '</strong></div><div class="codex-active-actions">' + action +
    '<button type="button" class="secondary" data-open-details>Details</button></div></section>';
}

function renderCodexDetails(project, survey) {
  const findings = survey?.result?.findings || survey?.findings;
  const open = state.reviewAction ? ' open' : '';
  return '<details id="project-details" class="codex-details"' + open + '><summary><span>Details</span><small>Inspection, Work Orders, checks, and evidence</small></summary>' +
    '<div class="codex-details-body"><section><div class="codex-details-head"><h2>Inspection</h2>' +
    (!project.latestSurveyId ? '<button type="button" id="btn-inspect">Inspect build</button>' : '<button type="button" class="secondary" id="btn-inspect">Inspect again</button>') +
    '</div>' + (findings ? renderFindings(survey) : '<p class="muted">No inspection evidence yet. Joe will inspect automatically when a work request needs it.</p>') +
    (survey?.evidenceId || project.latestSurveyId ? '<button class="text-button builder-only" id="btn-export-md">Download inspection evidence</button>' : '') +
    '</section><section><div class="codex-details-head"><h2>Work Orders and proof</h2><small>' + state.workOrders.length +
    ' recorded</small></div>' + renderWOList() + '</section></div></details>';
}

function renderCodexComposer() {
  if (!state.currentProject) return '';
  const options = (state.workshopSettings?.presets || []).map(item =>
    '<option value="' + escapeHtml(item.id) + '" ' + (item.id === currentPreset().id ? 'selected' : '') + '>' +
    escapeHtml(item.name) + '</option>'
  ).join('');
  const busy = state.chatBusy || state.autoJob?.running;
  const active = activeProjectWorkOrder();
  const helper = active
    ? 'Joe will answer questions normally. A clear work command resumes ' + active.id + ' inside its recorded scope.'
    : 'Questions stay read-only. A clear work request grants one bounded job; Joe handles inspection, planning, protection, changes, and checks.';
  return '<div class="codex-composer-dock"><form id="chat-form" class="codex-composer">' +
    '<div class="codex-composer-tools"><button type="button" class="attach-context" data-open-panel="brain" title="Add Project Brain context" aria-label="Open Project Brain">+</button>' +
    '<select id="composer-preset" aria-label="Job preset">' + (options || '<option>Auto</option>') + '</select>' +
    '<span class="model-route">' + escapeHtml(presetRouteLabel()) + '</span></div>' +
    '<textarea id="chat-input" rows="3" maxlength="4000" required aria-label="Message Joe" placeholder="Ask Joe anything, or describe what you want changed..." ' +
    (busy ? 'disabled' : '') + '></textarea>' +
    '<div class="codex-composer-footer"><span>' + escapeHtml(busy ? 'Joe is handling the current step...' : helper) + '</span>' +
    '<button type="submit" class="codex-send" ' + (busy ? 'disabled' : '') + '>' + (busy ? 'Working...' : 'Send') + '</button></div>' +
    '</form></div>';
}

renderComposer = renderCodexComposer;

renderProject = function renderConversationFirstProject() {
  const project = state.currentProject;
  if (!project) return renderHome();
  const survey = state.latestSurvey;
  const active = activeProjectWorkOrder();
  const evidence = project.lastInspectedAt
    ? 'Checked ' + new Date(project.lastInspectedAt).toLocaleString()
    : 'Not inspected yet';

  return '<div class="codex-scroll"><div class="stream codex-stream"><header class="codex-project-head"><div><div class="conversation-kicker">' +
    escapeHtml(project.name) + '</div><h1>' + escapeHtml(state.currentThread?.title || 'Project conversation') +
    '</h1><button class="objective-button" data-open-panel="thread">' +
    escapeHtml(state.currentThread?.objective || 'Set a conversation objective') +
    '</button></div><div class="codex-project-actions"><button type="button" class="secondary" data-open-panel="brain">Project Brain</button>' +
    '<button type="button" class="secondary" data-open-details>Details</button></div></header>' +
    '<div class="codex-context"><span>' + escapeHtml(conditionLabel(project.buildCondition)) + '</span><span>' +
    escapeHtml(evidence) + '</span><span>' + escapeHtml(currentPreset().name) + '</span><span>' +
    escapeHtml(active ? active.id + ' ' + active.status : 'No active job') + '</span></div>' +
    renderAutoJobStatus() + renderCodexActiveJob(active) + renderCodexConversation() +
    renderCodexDetails(project, survey) + '</div></div>' + renderComposer();
};

runChat = async function runSmartChat(content) {
  const request = String(content || '').trim();
  if (!request) return;
  if (!shouldAutoHandle(request)) return runThreadChat(request);
  const active = activeProjectWorkOrder();
  return runAutomatedJob(request, active?.id || null);
};

const bindWorkshopControlsBeforeSmartChat = bindWorkshopControls;
bindWorkshopControls = function bindConversationFirstControls() {
  bindWorkshopControlsBeforeSmartChat();

  document.querySelectorAll('[data-resume-auto]').forEach(button => {
    button.addEventListener('click', () => void runAutomatedJob('', button.dataset.resumeAuto));
  });
  document.querySelectorAll('[data-open-details]').forEach(button => {
    button.addEventListener('click', () => {
      const details = document.getElementById('project-details');
      if (!details) return;
      details.open = true;
      details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  document.querySelectorAll('[data-refresh-project]').forEach(button => {
    button.addEventListener('click', () => {
      if (state.currentProject?.id) void openProject(state.currentProject.id);
    });
  });
};

// ---------- Read-only workspace Explorer ----------

function freshExplorerState() {
  return {
    open: true,
    expanded: { '': true },
    listings: {},
    loadingPaths: {},
    query: '',
    searchResults: null,
    selectedPath: null,
    preview: null,
    previewLoading: false,
    previewError: null,
    error: null
  };
}

state.fileExplorer = freshExplorerState();
let explorerSearchTimer = null;

function explorerState() {
  if (!state.fileExplorer) state.fileExplorer = freshExplorerState();
  return state.fileExplorer;
}

function explorerPathLabel(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) || state.currentProject?.name || 'Files';
}

function explorerFileKind(entry) {
  if (entry.protected) return 'lock';
  const ext = String(entry.extension || '').replace('.', '').toLowerCase();
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'html', 'css', 'scss', 'vue', 'svelte'].includes(ext)) return 'code';
  if (['json', 'yaml', 'yml', 'toml', 'ini', 'xml'].includes(ext)) return 'data';
  if (['md', 'txt', 'rst'].includes(ext)) return 'text';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return 'image';
  return 'file';
}

function explorerFileStatus(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  const active = activeProjectWorkOrder();
  const scoped = (active?.scope?.exactPaths || active?.scope?.paths || []).some(item =>
    String(item || '').replace(/\\/g, '/').toLowerCase() === normalized
  );
  if (scoped) return 'scoped';
  const changed = (state.lastRunResult?.applied || []).some(item =>
    String(item.relPath || item.path || '').replace(/\\/g, '/').toLowerCase() === normalized
  );
  return changed ? 'changed' : '';
}

function formatExplorerSize(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return Math.round(value / 1024) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

async function loadExplorerDirectory(relativePath = '', force = false) {
  const projectId = state.currentProject?.id;
  if (!projectId) return;
  const explorer = explorerState();
  const pathKey = String(relativePath || '').replace(/\\/g, '/');
  if (!force && explorer.listings[pathKey]) return;
  explorer.loadingPaths[pathKey] = true;
  explorer.error = null;
  render();
  try {
    const data = await api('/api/v1/projects/' + projectId + '/files?path=' + encodeURIComponent(pathKey));
    if (state.currentProject?.id !== projectId) return;
    explorer.listings[pathKey] = data;
  } catch (error) {
    if (state.currentProject?.id !== projectId) return;
    explorer.error = formatError(error);
  } finally {
    delete explorer.loadingPaths[pathKey];
    if (state.currentProject?.id === projectId) render();
  }
}

async function searchExplorer(query) {
  const projectId = state.currentProject?.id;
  if (!projectId) return;
  const explorer = explorerState();
  const normalized = String(query || '').trim().slice(0, 120);
  explorer.query = normalized;
  explorer.error = null;
  if (!normalized) {
    explorer.searchResults = null;
    render();
    return;
  }
  explorer.loadingPaths.search = true;
  render();
  try {
    const data = await api('/api/v1/projects/' + projectId + '/files?q=' + encodeURIComponent(normalized));
    if (state.currentProject?.id !== projectId || explorer.query !== normalized) return;
    explorer.searchResults = data;
  } catch (error) {
    if (state.currentProject?.id !== projectId) return;
    explorer.error = formatError(error);
  } finally {
    delete explorer.loadingPaths.search;
    if (state.currentProject?.id === projectId) {
      render();
      requestAnimationFrame(() => {
        const input = document.getElementById('explorer-search');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
    }
  }
}

async function loadExplorerPreview(relativePath) {
  const projectId = state.currentProject?.id;
  if (!projectId) return;
  const explorer = explorerState();
  explorer.selectedPath = relativePath;
  explorer.preview = null;
  explorer.previewError = null;
  explorer.previewLoading = true;
  render();
  try {
    const data = await api('/api/v1/projects/' + projectId + '/files/preview?path=' + encodeURIComponent(relativePath));
    if (state.currentProject?.id !== projectId || explorer.selectedPath !== relativePath) return;
    explorer.preview = data.preview;
  } catch (error) {
    if (state.currentProject?.id !== projectId || explorer.selectedPath !== relativePath) return;
    explorer.previewError = formatError(error);
  } finally {
    if (state.currentProject?.id === projectId && explorer.selectedPath === relativePath) {
      explorer.previewLoading = false;
      render();
    }
  }
}

function renderExplorerFile(entry, depth, searchResult = false) {
  const protectedFile = entry.protected === true;
  const status = explorerFileStatus(entry.path);
  const indent = Math.min(18, Math.max(0, depth)) * 12 + 8;
  const label = searchResult ? entry.path : entry.name;
  const glyph = protectedFile ? '&#128274;' : explorerFileKind(entry) === 'code' ? '&lt;&gt;' : '&#8226;';
  return '<button type="button" class="explorer-row explorer-file ' +
    (explorerState().selectedPath === entry.path ? 'selected ' : '') +
    (status ? status + ' ' : '') + '" data-explorer-file="' + escapeHtml(entry.path) + '" style="padding-left:' +
    indent + 'px" ' + (protectedFile ? 'disabled title="Potential secret - preview blocked"' : 'title="' + escapeHtml(entry.path) + '"') + '>' +
    '<span class="explorer-glyph kind-' + escapeHtml(explorerFileKind(entry)) + '">' + glyph + '</span>' +
    '<span class="explorer-name">' + escapeHtml(label) + '</span>' +
    (status ? '<span class="explorer-state-dot" title="' + escapeHtml(status) + '"></span>' : '') +
    '</button>';
}

function renderExplorerBranch(directory = '', depth = 0) {
  const explorer = explorerState();
  const listing = explorer.listings[directory];
  if (!listing) {
    return explorer.loadingPaths[directory]
      ? '<div class="explorer-loading" style="padding-left:' + (depth * 12 + 10) + 'px">Reading folder...</div>'
      : '';
  }
  if (!listing.entries.length) {
    return '<div class="explorer-empty" style="padding-left:' + (depth * 12 + 10) + 'px">Empty folder</div>';
  }
  return listing.entries.map(entry => {
    if (entry.type === 'file') return renderExplorerFile(entry, depth);
    const expanded = explorer.expanded[entry.path] === true;
    const indent = Math.min(18, Math.max(0, depth)) * 12 + 8;
    return '<div class="explorer-folder-wrap"><button type="button" class="explorer-row explorer-folder" data-explorer-folder="' +
      escapeHtml(entry.path) + '" aria-expanded="' + expanded + '" style="padding-left:' + indent + 'px" title="' +
      escapeHtml(entry.path) + '"><span class="explorer-chevron">' + (expanded ? '&#9662;' : '&#9656;') +
      '</span><span class="explorer-folder-icon">&#9633;</span><span class="explorer-name">' + escapeHtml(entry.name) +
      '</span></button>' + (expanded ? '<div>' + renderExplorerBranch(entry.path, depth + 1) + '</div>' : '') + '</div>';
  }).join('');
}

function renderExplorerSearchResults() {
  const explorer = explorerState();
  if (explorer.loadingPaths.search) return '<div class="explorer-loading">Searching project...</div>';
  const result = explorer.searchResults;
  if (!result) return '';
  if (!result.entries.length) return '<div class="explorer-empty">No matching files</div>';
  return '<div class="explorer-search-results">' +
    result.entries.map(entry => renderExplorerFile(entry, 0, true)).join('') +
    (result.truncated ? '<div class="explorer-limit">First 200 matches shown</div>' : '') + '</div>';
}

function renderExplorerRail() {
  if (!state.currentProject) return '';
  const explorer = explorerState();
  const root = explorer.listings[''];
  const count = root?.entries?.length || 0;
  return '<section class="rail-explorer ' + (explorer.open ? 'open' : '') + '" aria-label="Project files">' +
    '<div class="rail-explorer-head"><button type="button" data-explorer-toggle aria-expanded="' + explorer.open +
    '"><span class="explorer-chevron">' + (explorer.open ? '&#9662;' : '&#9656;') + '</span><strong>Files</strong><small>' +
    escapeHtml(explorerPathLabel('')) + '</small></button><button type="button" class="explorer-refresh" data-explorer-refresh title="Refresh files" aria-label="Refresh files">&#8635;</button></div>' +
    (explorer.open ? '<div class="rail-explorer-body"><div class="explorer-search-wrap"><span>&#128269;</span><input id="explorer-search" type="search" maxlength="120" value="' +
      escapeHtml(explorer.query) + '" placeholder="Find a file" aria-label="Find a project file"></div>' +
      (explorer.error ? '<div class="explorer-error">' + escapeHtml(explorer.error) + '</div>' : '') +
      '<div class="explorer-tree" role="tree">' +
      (explorer.query ? renderExplorerSearchResults() :
        (root ? renderExplorerBranch('', 0) : '<div class="explorer-loading">Reading project files...</div>')) +
      '</div><div class="explorer-boundary">Live read-only view - not inspection evidence' +
      (count ? ' - ' + count + ' root items' : '') + '</div></div>' : '') +
    '</section>';
}

function renderExplorerPreview() {
  const explorer = explorerState();
  if (!state.currentProject || !explorer.selectedPath) return '';
  const preview = explorer.preview;
  const title = preview?.path || explorer.selectedPath;
  let body = '';
  if (explorer.previewLoading) {
    body = '<div class="file-preview-message">Reading the file safely...</div>';
  } else if (explorer.previewError) {
    body = '<div class="file-preview-message error"><strong>Preview unavailable</strong><p>' +
      escapeHtml(explorer.previewError) + '</p></div>';
  } else if (preview) {
    body = (preview.truncated ? '<div class="file-preview-warning">Large file - showing the first 256 KB.</div>' : '') +
      '<pre class="file-preview-code" tabindex="0"><code>' + escapeHtml(preview.content) + '</code></pre>';
  }
  return '<div class="file-preview-backdrop" data-close-file-preview><aside class="file-preview-drawer" aria-label="Read-only file preview">' +
    '<header><div><span class="file-preview-kicker">Read-only preview</span><h2 title="' + escapeHtml(title) + '">' +
    escapeHtml(title) + '</h2><p>' + (preview ? escapeHtml(formatExplorerSize(preview.size) + ' - ' + preview.lineCount + ' lines') : 'No source changes are possible here') +
    '</p></div><div class="file-preview-actions">' +
    (preview ? '<button type="button" class="secondary" data-ask-file="' + escapeHtml(preview.path) + '">Ask Joe about this file</button>' : '') +
    '<button type="button" class="icon-btn" data-close-file-preview aria-label="Close file preview">&times;</button></div></header>' +
    body + '<footer>Preview content is live context, not proof. Joe still requires inspection evidence and a sealed Work Order before changes.</footer>' +
    '</aside></div>';
}

const renderRailBeforeExplorer = renderRail;
renderRail = function renderRailWithExplorer() {
  const html = renderRailBeforeExplorer();
  if (!state.currentProject) return html;
  return html.replace('<div class="rail-footer">', renderExplorerRail() + '<div class="rail-footer">');
};

const renderProjectBeforeExplorer = renderProject;
renderProject = function renderProjectWithExplorerPreview() {
  return renderProjectBeforeExplorer() + renderExplorerPreview();
};

const openProjectBeforeExplorer = openProject;
openProject = async function openProjectWithExplorer(id) {
  state.fileExplorer = freshExplorerState();
  await openProjectBeforeExplorer(id);
  if (state.currentProject?.id === id) await loadExplorerDirectory('');
};

const isEscapeControlBeforeExplorer = isEscapeControl;
isEscapeControl = function isExplorerControlAvailable(control) {
  if (control.closest('.rail-explorer') || control.closest('.file-preview-drawer')) return true;
  return isEscapeControlBeforeExplorer(control);
};

const bindWorkshopControlsBeforeExplorer = bindWorkshopControls;
bindWorkshopControls = function bindExplorerControls() {
  bindWorkshopControlsBeforeExplorer();

  document.querySelector('[data-explorer-toggle]')?.addEventListener('click', () => {
    const explorer = explorerState();
    explorer.open = !explorer.open;
    render();
    if (explorer.open && !explorer.listings['']) void loadExplorerDirectory('');
  });
  document.querySelector('[data-explorer-refresh]')?.addEventListener('click', () => {
    const explorer = explorerState();
    explorer.listings = {};
    explorer.searchResults = null;
    explorer.error = null;
    void loadExplorerDirectory('', true);
  });
  document.querySelectorAll('[data-explorer-folder]').forEach(button => {
    button.addEventListener('click', () => {
      const explorer = explorerState();
      const pathValue = button.dataset.explorerFolder || '';
      const opening = explorer.expanded[pathValue] !== true;
      explorer.expanded[pathValue] = opening;
      render();
      if (opening && !explorer.listings[pathValue]) void loadExplorerDirectory(pathValue);
    });
  });
  document.querySelectorAll('[data-explorer-file]').forEach(button => {
    button.addEventListener('click', () => void loadExplorerPreview(button.dataset.explorerFile));
  });

  const search = document.getElementById('explorer-search');
  search?.addEventListener('input', () => {
    const value = search.value;
    explorerState().query = value;
    clearTimeout(explorerSearchTimer);
    explorerSearchTimer = setTimeout(() => void searchExplorer(value), 260);
  });
  search?.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    clearTimeout(explorerSearchTimer);
    explorerState().query = '';
    explorerState().searchResults = null;
    render();
  });

  document.querySelectorAll('[data-close-file-preview]').forEach(control => {
    control.addEventListener('click', event => {
      if (control.classList.contains('file-preview-backdrop') && event.target !== control) return;
      const explorer = explorerState();
      explorer.selectedPath = null;
      explorer.preview = null;
      explorer.previewError = null;
      render();
    });
  });
  document.querySelector('.file-preview-drawer')?.addEventListener('click', event => event.stopPropagation());
  document.querySelector('[data-ask-file]')?.addEventListener('click', buttonEvent => {
    const relativePath = buttonEvent.currentTarget.dataset.askFile;
    const explorer = explorerState();
    explorer.selectedPath = null;
    explorer.preview = null;
    explorer.previewError = null;
    render();
    requestAnimationFrame(() => {
      const input = document.getElementById('chat-input');
      if (!input) return;
      input.value = 'Explain ' + relativePath + ' and how it fits this project.';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });
};
// ---------- Durable server-owned Joe jobs ----------
let serverJobPollTimer = null;
let serverJobLastOrdinal = -1;

function mapServerJob(job) {
  const stageMap = { understand: 'chat', inspect: 'inspect', plan: 'plan', authorize: 'authorize', run: 'run', verify: 'check', complete: 'check', blocked: 'check' };
  return {
    id: job.id,
    serverOwned: true,
    serverStatus: job.status,
    running: job.status === 'queued' || job.status === 'running',
    status: job.status === 'failed' || job.status === 'interrupted' ? 'failed' : job.status === 'completed' ? 'done' : 'running',
    stage: stageMap[job.stage] || 'chat',
    objective: job.objective,
    message: job.message,
    workOrderId: job.workOrderId || null,
    errorCode: job.errorCode || null,
    errorMessage: job.errorMessage || null,
    result: job.result || null,
    startedAt: job.startedAt || job.createdAt || null
  };
}

function stopServerJobPoll() {
  if (serverJobPollTimer) clearTimeout(serverJobPollTimer);
  serverJobPollTimer = null;
}

async function refreshServerJob(jobId, projectId) {
  try {
    const data = await api('/api/v1/agent-jobs/' + jobId + '?after=' + serverJobLastOrdinal);
    if (state.currentProject?.id !== projectId) {
      stopServerJobPoll();
      return;
    }
    const job = data.job;
    state.autoJob = mapServerJob(job);
    const events = data.events || [];
    if (events.length) {
      serverJobLastOrdinal = events[events.length - 1].ordinal;
      const latest = events[events.length - 1];
      beginNarration(latest.what, latest.meaning, latest.next);
    }
    state.busy = job.status === 'queued' || job.status === 'running';
    state.chatBusy = state.busy;
    state.joeStatus = state.busy ? 'working' : job.status === 'completed' ? 'complete' : 'blocked';
    if (job.status === 'completed') {
      stopServerJobPoll();
      state.lastRunResult = job.result || null;
      state.autoJob = null;
      await openProjectBeforeServerJobs(projectId);
      showNotice('Joe completed the bounded job. Review the recorded result and proof in this conversation.');
      return;
    }
    if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted') {
      stopServerJobPoll();
      state.busy = false;
      state.chatBusy = false;
      render();
      return;
    }
    render();
    serverJobPollTimer = setTimeout(() => void refreshServerJob(jobId, projectId), 900);
  } catch (error) {
    if (state.currentProject?.id !== projectId) return stopServerJobPoll();
    state.busy = false;
    state.chatBusy = false;
    state.error = formatError(error);
    render();
    serverJobPollTimer = setTimeout(() => void refreshServerJob(jobId, projectId), 2500);
  }
}

async function startFollowingServerJob(job) {
  stopServerJobPoll();
  serverJobLastOrdinal = -1;
  state.autoJob = mapServerJob(job);
  state.busy = true;
  state.chatBusy = true;
  state.joeStatus = 'working';
  beginNarration(
    'I am handling this job on the server.',
    'The job continues inside its sealed limits even if this page is refreshed or closed.',
    'I will report each meaningful stage and stop on a proven blocker.'
  );
  render();
  await refreshServerJob(job.id, job.projectId);
}

runAutomatedJob = async function runDurableAutomatedJob(requestedObjective, activeWorkOrderId = null) {
  const project = state.currentProject;
  const thread = state.currentThread;
  if (!project || !thread) return showError('Open a project conversation before starting a job.');
  const active = activeWorkOrderId ? state.workOrders.find(item => item.id === activeWorkOrderId) : activeProjectWorkOrder();
  const objective = String(active?.objective || requestedObjective || '').trim();
  if (!objective) return showError('Tell Joe the outcome you want, then press Send.');
  if (objective.length > 500) return showError('Keep this job under 500 characters so its authorization remains exact.');
  clearMessages();
  try {
    const data = await api('/api/v1/projects/' + project.id + '/threads/' + thread.id + '/agent-jobs', {
      method: 'POST',
      body: JSON.stringify({ objective, activeWorkOrderId: active?.id || null })
    });
    await startFollowingServerJob(data.job);
  } catch (error) {
    state.busy = false;
    state.chatBusy = false;
    showError(formatError(error));
  }
};

const renderAutoJobStatusBeforeServerJobs = renderAutoJobStatus;
renderAutoJobStatus = function renderServerOwnedJobStatus() {
  const job = state.autoJob;
  if (!job?.serverOwned) return renderAutoJobStatusBeforeServerJobs();
  const currentIndex = Math.max(0, AUTO_JOB_STAGE_ORDER.findIndex(item => item.id === job.stage));
  const steps = AUTO_JOB_STAGE_ORDER.map((item, index) => {
    const cls = index < currentIndex ? 'done' : index === currentIndex ? (job.status === 'failed' ? 'failed' : 'active') : '';
    return '<div class="auto-job-step ' + cls + '"><span>' + (index + 1) + '</span><strong>' + escapeHtml(item.label) + '</strong></div>';
  }).join('');
  const interrupted = job.serverStatus === 'interrupted';
  const failed = job.status === 'failed';
  return '<section class="auto-job-status ' + (failed ? 'failed' : '') + '" aria-live="polite">' +
    '<div class="auto-job-head"><div><div class="eyebrow">Joe server job</div><h2>' + escapeHtml(interrupted ? 'Ready to resume' : failed ? 'Stopped safely' : 'Handling the job') + '</h2></div>' +
    '<span class="badge ' + (failed ? 'warn' : 'ok') + '">' + escapeHtml(interrupted ? 'Interrupted' : failed ? 'Needs review' : 'Working') + '</span></div>' +
    '<p class="auto-job-objective">' + escapeHtml(job.objective) + '</p><div class="auto-job-steps">' + steps + '</div>' +
    '<p class="auto-job-message">' + escapeHtml(job.errorMessage || job.message || 'Joe is working.') + '</p>' +
    (interrupted ? '<button type="button" data-resume-server-job="' + escapeHtml(job.id) + '">Resume job</button>' : '') +
    '<p class="auto-job-boundary">Server-owned and durable. One objective, one sealed Work Order, bounded correction, verification, and rollback.</p></section>';
};

const openProjectBeforeServerJobs = openProject;
openProject = async function openProjectWithServerJob(id) {
  await openProjectBeforeServerJobs(id);
  if (state.currentProject?.id !== id) return;
  try {
    const data = await api('/api/v1/projects/' + id + '/agent-jobs');
    const job = data.activeJob;
    if (!job) {
      state.autoJob = null;
      return render();
    }
    state.autoJob = mapServerJob(job);
    if (job.status === 'queued' || job.status === 'running') void startFollowingServerJob(job);
    else render();
  } catch {
    // Project truth still loads even if durable job history is temporarily unavailable.
  }
};

const bindWorkshopControlsBeforeServerJobs = bindWorkshopControls;
bindWorkshopControls = function bindServerJobControls() {
  bindWorkshopControlsBeforeServerJobs();
  document.querySelector('[data-resume-server-job]')?.addEventListener('click', async event => {
    const id = event.currentTarget.dataset.resumeServerJob;
    try {
      const data = await api('/api/v1/agent-jobs/' + id + '/resume', { method: 'POST', body: '{}' });
      await startFollowingServerJob(data.job);
    } catch (error) {
      showError(formatError(error));
    }
  });
};

// ---------- Definitive Automatic / Ask / Plan experience ----------
function renderAutomaticComposer() {
  if (!state.currentProject) return '';
  const mode = ['automatic', 'ask', 'plan'].includes(state.composerMode) ? state.composerMode : 'automatic';
  const options = (state.workshopSettings?.presets || []).map(item =>
    '<option value="' + escapeHtml(item.id) + '" ' + (item.id === currentPreset().id ? 'selected' : '') + '>' + escapeHtml(item.name) + '</option>'
  ).join('');
  const running = Boolean(state.autoJob?.running);
  const modeHelp = mode === 'automatic'
    ? (running ? 'Joe is working. Questions remain available; use Stop if your next message would change the job.' : 'One clear request starts one bounded job. Joe inspects, plans, protects, changes, checks, and reports.')
    : mode === 'ask'
      ? 'Read-only conversation. No job or file change can start in Ask mode.'
      : 'Read-only planning. Joe can propose an approach, but cannot start or authorize work.';
  return '<div class="codex-composer-dock"><form id="chat-form" class="codex-composer">' +
    '<div class="codex-composer-tools"><button type="button" class="attach-context" data-open-panel="brain" title="Project Brain" aria-label="Open Project Brain">+</button>' +
    '<select id="composer-preset" aria-label="Job preset">' + (options || '<option>Auto</option>') + '</select>' +
    '<span class="model-route">' + escapeHtml(presetRouteLabel()) + '</span>' +
    '<div class="agent-mode-switch" role="tablist" aria-label="Joe mode">' +
    [['automatic','Automatic'],['ask','Ask'],['plan','Plan']].map(item => '<button type="button" role="tab" aria-selected="' + (mode === item[0]) + '" class="' + (mode === item[0] ? 'active' : '') + '" data-agent-mode="' + item[0] + '">' + item[1] + '</button>').join('') +
    '</div></div>' +
    '<textarea id="chat-input" rows="3" maxlength="4000" required aria-label="Message Joe" placeholder="Ask a question or describe the outcome you want..."></textarea>' +
    '<div class="codex-composer-footer"><span>' + escapeHtml(modeHelp) + '</span><button type="submit" class="codex-send">Send</button></div>' +
    '</form></div>';
}
renderComposer = renderAutomaticComposer;

renderCodexActiveJob = function renderAutomaticLegacyWork(workOrder) {
  if (!workOrder || state.autoJob?.running) return '';
  return '<section class="codex-active-job"><div><span>Recorded job - ' + escapeHtml(workOrder.id) + '</span><strong>' +
    escapeHtml(workOrder.objective || 'Continue the recorded job.') + '</strong><small>Send a clear work request in Automatic mode and Joe will continue only this recorded scope.</small></div>' +
    '<button type="button" class="secondary" data-open-details>Open proof</button></section>';
};

const renderStatusBeforeAutomaticCutover = renderAutoJobStatus;
renderAutoJobStatus = function renderAutomaticJobStatus() {
  const job = state.autoJob;
  if (!job?.serverOwned) return renderStatusBeforeAutomaticCutover();
  const running = job.serverStatus === 'queued' || job.serverStatus === 'running';
  const interrupted = job.serverStatus === 'interrupted';
  const failed = job.serverStatus === 'failed' || job.serverStatus === 'cancelled';
  const startedAt = Number(job.startedAt || 0);
  const elapsed = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) + 's' : 'starting';
  const phase = ({ chat: 'Understanding the request', inspect: 'Inspecting without changes', plan: 'Planning the smallest complete job', authorize: 'Protecting the exact job boundary', run: 'Changing only protected files', check: 'Checking the result' })[job.stage] || 'Working';
  const narration = state.narration || {};
  const files = (job.result?.applied || []).map(item => item.relPath || item.path).filter(Boolean);
  return '<section class="automatic-job-card ' + (failed ? 'failed' : '') + '" aria-live="polite">' +
    '<div class="automatic-job-head"><div><span class="activity-dot"></span><strong>' + escapeHtml(interrupted ? 'Interrupted safely' : failed ? 'Stopped safely' : phase) + '</strong></div><span>' + escapeHtml(elapsed) + '</span></div>' +
    '<p class="automatic-job-objective">' + escapeHtml(job.objective) + '</p>' +
    '<div class="automatic-job-account"><div><b>Doing now</b><span>' + escapeHtml(job.errorMessage || job.message || narration.what || phase) + '</span></div>' +
    (narration.meaning ? '<div><b>Why it matters</b><span>' + escapeHtml(narration.meaning) + '</span></div>' : '') +
    (files.length ? '<div><b>Files touched</b><span>' + files.map(escapeHtml).join(', ') + '</span></div>' : '') +
    '<div><b>Next</b><span>' + escapeHtml(narration.next || (running ? 'Continue inside the recorded boundary.' : 'Review the recorded result.')) + '</span></div></div>' +
    '<div class="automatic-job-actions">' +
    (running ? '<button type="button" class="secondary danger-link" data-stop-server-job="' + escapeHtml(job.id) + '">Stop</button>' : '') +
    (interrupted ? '<button type="button" data-resume-server-job="' + escapeHtml(job.id) + '">Resume</button>' : '') +
    '</div></section>';
};

runChat = async function runModeAwareChat(content) {
  const request = String(content || '').trim();
  if (!request) return;
  const mode = ['automatic', 'ask', 'plan'].includes(state.composerMode) ? state.composerMode : 'automatic';
  if (mode !== 'automatic') return runThreadChat(request);
  if (state.autoJob?.running) {
    if (shouldAutoHandle(request)) {
      showNotice('Joe is already completing the current bounded job. Stop it before replacing the objective; questions can still be sent now.');
      return;
    }
    return runThreadChat(request);
  }
  return shouldAutoHandle(request) ? runAutomatedJob(request, activeProjectWorkOrder()?.id || null) : runThreadChat(request);
};

const bindControlsBeforeAutomaticCutover = bindWorkshopControls;
bindWorkshopControls = function bindAutomaticControls() {
  bindControlsBeforeAutomaticCutover();
  document.querySelectorAll('[data-agent-mode]').forEach(button => button.addEventListener('click', () => {
    state.composerMode = button.dataset.agentMode;
    localStorage.setItem('jc_composer_mode', state.composerMode);
    render();
    requestAnimationFrame(() => document.getElementById('chat-input')?.focus());
  }));
  document.querySelector('[data-stop-server-job]')?.addEventListener('click', async event => {
    const id = event.currentTarget.dataset.stopServerJob;
    try {
      const data = await api('/api/v1/agent-jobs/' + id + '/stop', { method: 'POST', body: '{}' });
      state.autoJob = mapServerJob(data.job);
      beginNarration('I received your stop request.', 'I will stop at the next safe boundary so an atomic file write is never torn in half.', 'Wait for the cancelled receipt.');
      render();
    } catch (error) { showError(formatError(error)); }
  });
};
boot();

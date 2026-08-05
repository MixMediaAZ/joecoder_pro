export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const DATABASE_SCHEMA_VERSION = 5;
export const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK(length(checksum) = 64),
  applied_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS runtime_metadata (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY CHECK(id GLOB 'proj-*'),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  canonical_path TEXT NOT NULL UNIQUE CHECK(length(trim(canonical_path)) > 0),
  description TEXT,
  workflow_stage TEXT NOT NULL CHECK(workflow_stage IN (
    'no_project','folder_selected','surface_inspection_running','surface_review_ready',
    'project_accepted','work_order_draft','awaiting_approval','approved','executing',
    'complete','partial','blocked','cancelled'
  )),
  build_condition TEXT NOT NULL CHECK(build_condition IN (
    'unknown','needs_inspection','looks_healthy','partly_working',
    'significant_problems','cannot_assess'
  )),
  execution_mode TEXT NOT NULL CHECK(execution_mode IN ('supervised','checkpoint','auto')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_inspected_at INTEGER,
  latest_survey_id TEXT,
  active_work_order_id TEXT,
  overview_path TEXT,
  record_version INTEGER NOT NULL DEFAULT 1 CHECK(record_version >= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS project_permissions (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  read_files INTEGER NOT NULL CHECK(read_files IN (0,1)),
  write_files INTEGER NOT NULL CHECK(write_files IN (0,1)),
  install_deps INTEGER NOT NULL CHECK(install_deps IN (0,1)),
  run_app INTEGER NOT NULL CHECK(run_app IN (0,1)),
  run_tests INTEGER NOT NULL CHECK(run_tests IN (0,1)),
  git_commit INTEGER NOT NULL CHECK(git_commit IN (0,1)),
  git_push INTEGER NOT NULL CHECK(git_push IN (0,1)),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY CHECK(id GLOB 'JC*-M*-*'),
  project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  plan_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'draft','authorized','executing','completed','failed','rolled_back','cancelled'
  )),
  intent TEXT NOT NULL CHECK(intent IN ('build','survey','repair','inspect','export')),
  objective TEXT NOT NULL CHECK(length(trim(objective)) > 0),
  dependency_completion_state TEXT NOT NULL CHECK(dependency_completion_state IN (
    'none_required','pending','satisfied','blocked'
  )),
  linked_survey_id TEXT,
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  budgets_json TEXT NOT NULL CHECK(json_valid(budgets_json)),
  risk_json TEXT CHECK(risk_json IS NULL OR json_valid(risk_json)),
  task_specific_json TEXT CHECK(task_specific_json IS NULL OR json_valid(task_specific_json)),
  donor_disposition_json TEXT CHECK(donor_disposition_json IS NULL OR json_valid(donor_disposition_json)),
  stop_loss_json TEXT CHECK(stop_loss_json IS NULL OR json_valid(stop_loss_json)),
  completion_json TEXT CHECK(completion_json IS NULL OR json_valid(completion_json)),
  authorization_required INTEGER NOT NULL CHECK(authorization_required IN (0,1)),
  authorization_granted INTEGER NOT NULL CHECK(authorization_granted IN (0,1)),
  authorization_granted_at TEXT,
  authorization_granted_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  record_version INTEGER NOT NULL DEFAULT 1 CHECK(record_version >= 1)
) STRICT;

CREATE INDEX IF NOT EXISTS work_orders_project_status_idx
  ON work_orders(project_id, status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_work_order_per_project_idx
  ON work_orders(project_id)
  WHERE project_id IS NOT NULL AND status IN ('authorized','executing');

CREATE TABLE IF NOT EXISTS work_order_dependencies (
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  required_state TEXT NOT NULL DEFAULT 'completed' CHECK(required_state = 'completed'),
  verified_evidence_required INTEGER NOT NULL DEFAULT 1 CHECK(verified_evidence_required IN (0,1)),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  PRIMARY KEY(work_order_id, depends_on_id),
  CHECK(work_order_id <> depends_on_id)
) STRICT;

CREATE TABLE IF NOT EXISTS work_order_acceptance (
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  acceptance_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  criterion TEXT NOT NULL CHECK(length(trim(criterion)) > 0),
  mandatory INTEGER NOT NULL CHECK(mandatory IN (0,1)),
  PRIMARY KEY(work_order_id, acceptance_id),
  UNIQUE(work_order_id, ordinal)
) STRICT;

CREATE TABLE IF NOT EXISTS work_order_evidence (
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'supporting' CHECK(role IN (
    'linked_survey','supporting','completion','violation','routing','rollback'
  )),
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  PRIMARY KEY(work_order_id, evidence_id),
  UNIQUE(work_order_id, ordinal)
) STRICT;

CREATE TABLE IF NOT EXISTS acceptance_results (
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  acceptance_id TEXT NOT NULL,
  criterion TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK(passed IN (0,1)),
  detail TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
  decided_at TEXT NOT NULL,
  PRIMARY KEY(work_order_id, acceptance_id)
) STRICT;

CREATE TABLE IF NOT EXISTS evidence_records (
  id TEXT PRIMARY KEY CHECK(id GLOB 'EVC-*'),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  work_order_id TEXT,
  evidence_type TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  content_hash TEXT CHECK(content_hash IS NULL OR length(content_hash) = 64),
  integrity_state TEXT NOT NULL CHECK(integrity_state IN (
    'verified','legacy_unverified','missing','corrupt'
  )),
  payload_size_bytes INTEGER NOT NULL CHECK(payload_size_bytes >= 0),
  created_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS evidence_project_created_idx
  ON evidence_records(project_id, created_at);
CREATE INDEX IF NOT EXISTS evidence_work_order_idx
  ON evidence_records(work_order_id, created_at);

CREATE TABLE IF NOT EXISTS event_log (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_hash TEXT NOT NULL UNIQUE CHECK(length(event_hash) = 64),
  previous_hash TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  work_order_id TEXT,
  event_type TEXT NOT NULL CHECK(length(trim(event_type)) > 0),
  occurred_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  integrity_state TEXT NOT NULL CHECK(integrity_state IN ('verified_chain','legacy_unverified'))
) STRICT;

CREATE INDEX IF NOT EXISTS event_project_sequence_idx
  ON event_log(project_id, sequence);
CREATE INDEX IF NOT EXISTS event_work_order_sequence_idx
  ON event_log(work_order_id, sequence);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY CHECK(id GLOB 'msg-*'),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL CHECK(length(trim(content)) > 0),
  suggestions_json TEXT CHECK(suggestions_json IS NULL OR json_valid(suggestions_json)),
  created_at TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  UNIQUE(project_id, ordinal)
) STRICT;

CREATE INDEX IF NOT EXISTS conversation_project_created_idx
  ON conversation_messages(project_id, created_at);

CREATE TABLE IF NOT EXISTS session_audit (
  session_id TEXT PRIMARY KEY CHECK(session_id GLOB 'sess-*'),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT,
  CHECK(expires_at > created_at)
) STRICT;

CREATE TABLE IF NOT EXISTS authorization_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES session_audit(session_id) ON DELETE SET NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  scope_hash TEXT NOT NULL CHECK(length(scope_hash) = 64),
  UNIQUE(work_order_id, granted_at)
) STRICT;

CREATE TABLE IF NOT EXISTS idempotency_records (
  session_id TEXT NOT NULL REFERENCES session_audit(session_id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL CHECK(length(key_hash) = 64),
  method TEXT NOT NULL,
  route_path TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  response_status INTEGER,
  response_hash TEXT CHECK(response_hash IS NULL OR length(response_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(session_id, key_hash)
) STRICT;

CREATE TABLE IF NOT EXISTS recovery_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
  phase TEXT NOT NULL,
  recovery_state TEXT NOT NULL CHECK(recovery_state IN (
    'committed','resumable','rollback_required','recovered','failed'
  )),
  payload_hash TEXT CHECK(payload_hash IS NULL OR length(payload_hash) = 64),
  detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS policy_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  work_order_id TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
  capability TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('allow','deny','unavailable','unknown')),
  reason TEXT NOT NULL,
  inputs_hash TEXT NOT NULL CHECK(length(inputs_hash) = 64),
  evidence_id TEXT,
  decided_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS job_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK(attempt_number >= 1),
  state TEXT NOT NULL CHECK(state IN (
    'started','committed','failed','cancelled','rollback_required','rolled_back'
  )),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  hypothesis TEXT,
  evidence_id TEXT,
  UNIQUE(work_order_id, attempt_number)
) STRICT;

CREATE TABLE IF NOT EXISTS budget_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  attempt_number INTEGER,
  elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK(elapsed_ms >= 0),
  files_changed INTEGER NOT NULL DEFAULT 0 CHECK(files_changed >= 0),
  changed_lines INTEGER NOT NULL DEFAULT 0 CHECK(changed_lines >= 0),
  network_bytes INTEGER NOT NULL DEFAULT 0 CHECK(network_bytes >= 0),
  tokens INTEGER NOT NULL DEFAULT 0 CHECK(tokens >= 0),
  compute_units REAL NOT NULL DEFAULT 0 CHECK(compute_units >= 0),
  cloud_cost_usd REAL NOT NULL DEFAULT 0 CHECK(cloud_cost_usd >= 0),
  observed_at INTEGER NOT NULL
) STRICT;
`;
export const WORKSHOP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_threads (
  id TEXT PRIMARY KEY CHECK(id GLOB 'thread-*'),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  objective TEXT NOT NULL DEFAULT '',
  preset_id TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_message_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS project_threads_project_updated_idx
  ON project_threads(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS thread_messages (
  id TEXT PRIMARY KEY CHECK(id GLOB 'msg-*'),
  thread_id TEXT NOT NULL REFERENCES project_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL CHECK(length(trim(content)) > 0),
  suggestions_json TEXT CHECK(suggestions_json IS NULL OR json_valid(suggestions_json)),
  created_at TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  UNIQUE(thread_id, ordinal)
) STRICT;
CREATE INDEX IF NOT EXISTS thread_messages_thread_created_idx
  ON thread_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS project_brain (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT '',
  preferences TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  architecture TEXT NOT NULL DEFAULT '',
  constraints_text TEXT NOT NULL DEFAULT '',
  decisions TEXT NOT NULL DEFAULT '',
  known_issues TEXT NOT NULL DEFAULT '',
  verified_truth TEXT NOT NULL DEFAULT '',
  evidence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_ids_json)),
  freshness_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS model_presets (
  id TEXT PRIMARY KEY CHECK(id GLOB 'preset-*'),
  name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) > 0),
  description TEXT NOT NULL,
  task_kind TEXT NOT NULL,
  privacy_mode TEXT NOT NULL CHECK(privacy_mode IN ('local_only','local_first','authorized_cloud')),
  quality_priority INTEGER NOT NULL CHECK(quality_priority BETWEEN 1 AND 5),
  speed_priority INTEGER NOT NULL CHECK(speed_priority BETWEEN 1 AND 5),
  cost_priority INTEGER NOT NULL CHECK(cost_priority BETWEEN 1 AND 5),
  required_capabilities_json TEXT NOT NULL CHECK(json_valid(required_capabilities_json)),
  built_in INTEGER NOT NULL CHECK(built_in IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS provider_profiles (
  id TEXT PRIMARY KEY CHECK(id GLOB 'provider-*'),
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('local','cloud')),
  endpoint TEXT,
  default_model TEXT,
  secret_env_var TEXT,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, display_name)
) STRICT;

CREATE TABLE IF NOT EXISTS routing_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  thread_id TEXT REFERENCES project_threads(id) ON DELETE SET NULL,
  preset_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  task_kind TEXT NOT NULL,
  succeeded INTEGER NOT NULL CHECK(succeeded IN (0,1)),
  latency_ms INTEGER NOT NULL CHECK(latency_ms >= 0),
  cloud_cost_usd REAL NOT NULL DEFAULT 0 CHECK(cloud_cost_usd >= 0),
  evidence_id TEXT,
  detail TEXT NOT NULL DEFAULT '',
  recorded_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS routing_outcomes_lookup_idx
  ON routing_outcomes(task_kind, preset_id, succeeded, recorded_at DESC);
`;

export const MIGRATIONS: Migration[] = [
    {
        version: 1,
        name: 'initial_governance_and_recovery_schema',
        sql: INITIAL_SCHEMA_SQL
    },
    {
        version: 2,
        name: 'conversation_first_workshop_schema',
        sql: WORKSHOP_SCHEMA_SQL
    },
    {
        version: 3,
        name: 'project_brain_guidance_preset',
        sql: `
ALTER TABLE project_brain ADD COLUMN guidance_preset_id TEXT NOT NULL
  DEFAULT 'brain-preset-exceptional-builder'
  CHECK(guidance_preset_id GLOB 'brain-preset-*');
`
    },
    {
        version: 4,
        name: 'durable_agent_jobs',
        sql: `
CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY CHECK(id GLOB 'job-*'),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES project_threads(id) ON DELETE CASCADE,
  objective TEXT NOT NULL CHECK(length(trim(objective)) > 0),
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','interrupted','cancelled')),
  stage TEXT NOT NULL CHECK(stage IN ('understand','inspect','plan','authorize','run','verify','complete','blocked')),
  intent TEXT CHECK(intent IS NULL OR intent IN ('inspect','repair','build','export')),
  work_order_id TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
  message TEXT NOT NULL DEFAULT '',
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  error_message TEXT,
  resume_count INTEGER NOT NULL DEFAULT 0 CHECK(resume_count >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS agent_jobs_project_updated_idx ON agent_jobs(project_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_one_active_per_project ON agent_jobs(project_id) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS agent_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  stage TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('progress','decision','result','failure')),
  what TEXT NOT NULL,
  meaning TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(job_id, ordinal)
) STRICT;
CREATE INDEX IF NOT EXISTS agent_job_events_job_ordinal_idx ON agent_job_events(job_id, ordinal);
`
    },
    {
        version: 5,
        name: 'journaled_agent_runtime',
        sql: `
ALTER TABLE agent_jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'mutating'
  CHECK(mode IN ('mutating','read_only'));
ALTER TABLE agent_jobs ADD COLUMN terminal_state TEXT
  CHECK(terminal_state IS NULL OR terminal_state IN (
    'completed','completed_with_limits','blocked_for_user','failed_safe','cancelled','interrupted'
  ));
ALTER TABLE agent_jobs ADD COLUMN runtime_state_json TEXT NOT NULL DEFAULT '{}'
  CHECK(json_valid(runtime_state_json));
ALTER TABLE agent_jobs ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0 CHECK(state_version >= 0);
ALTER TABLE agent_jobs ADD COLUMN stop_requested INTEGER NOT NULL DEFAULT 0 CHECK(stop_requested IN (0,1));
ALTER TABLE agent_jobs ADD COLUMN last_heartbeat_at INTEGER;

DROP INDEX IF EXISTS agent_jobs_one_active_per_project;
CREATE UNIQUE INDEX agent_jobs_one_active_mutating_per_project
  ON agent_jobs(project_id)
  WHERE mode='mutating' AND status IN ('queued','running');

CREATE TABLE IF NOT EXISTS agent_job_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  kind TEXT NOT NULL CHECK(kind IN (
    'turn','tool_request','tool_result','plan_revision','budget','checkpoint','verification','terminal','decision'
  )),
  stage TEXT NOT NULL,
  action_key TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)),
  evidence_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(job_id, ordinal),
  UNIQUE(job_id, kind, action_key)
) STRICT;
CREATE INDEX agent_job_journal_job_ordinal_idx ON agent_job_journal(job_id, ordinal);

CREATE TABLE IF NOT EXISTS agent_job_checkpoints (
  job_id TEXT PRIMARY KEY REFERENCES agent_jobs(id) ON DELETE CASCADE,
  state_version INTEGER NOT NULL CHECK(state_version >= 0),
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  last_completed_action TEXT,
  committed_at INTEGER NOT NULL
) STRICT;

ALTER TABLE idempotency_records ADD COLUMN response_json TEXT
  CHECK(response_json IS NULL OR json_valid(response_json));
ALTER TABLE idempotency_records ADD COLUMN completed_at INTEGER;
CREATE UNIQUE INDEX idempotency_records_global_key_idx ON idempotency_records(key_hash);
`
    }
];
export const REQUIRED_TABLES = [
    'schema_migrations',
    'runtime_metadata',
    'projects',
    'project_permissions',
    'work_orders',
    'work_order_dependencies',
    'work_order_acceptance',
    'work_order_evidence',
    'acceptance_results',
    'evidence_records',
    'event_log',
    'conversation_messages',
    'session_audit',
    'authorization_grants',
    'idempotency_records',
    'recovery_checkpoints',
    'policy_decisions',
    'job_attempts',
    'budget_ledger',
    'project_threads',
    'thread_messages',
    'project_brain',
    'model_presets',
    'provider_profiles',
    'routing_outcomes',
    'agent_jobs',
    'agent_job_events',
    'agent_job_journal',
    'agent_job_checkpoints'
] as const;
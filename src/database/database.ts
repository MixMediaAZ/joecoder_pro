import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import type { ChatMessage } from '../chat.js';
import type { Project, WorkOrder } from '../types.js';
import { DATABASE_SCHEMA_VERSION, MIGRATIONS, REQUIRED_TABLES } from './schema.js';

export interface RuntimeDatabaseStatus {
  available: boolean;
  mode: 'transactional_shadow';
  path: string | null;
  schemaVersion: number;
  integrity: 'ok' | 'failed' | 'not_initialized';
  journalMode: 'wal';
  tableCount: number;
  lastError: string | null;
}

export interface EvidenceDatabaseRecord {
  id: string;
  projectId: string | null;
  workOrderId: string | null;
  type: string;
  filePath: string;
  contentHash: string | null;
  integrityState: 'verified' | 'legacy_unverified' | 'missing' | 'corrupt';
  payloadSizeBytes: number;
  createdAt: number;
  observedAt: number;
}

export interface EventDatabaseRecord {
  hash: string;
  previousHash: string | null;
  projectId: string | null;
  workOrderId: string | null;
  type: string;
  occurredAt: number;
  payload: unknown;
  integrityState: 'verified_chain' | 'legacy_unverified';
}

let database: DatabaseSync | null = null;
let status: RuntimeDatabaseStatus = {
  available: false,
  mode: 'transactional_shadow',
  path: null,
  schemaVersion: 0,
  integrity: 'not_initialized',
  journalMode: 'wal',
  tableCount: 0,
  lastError: null
};

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function bool(value: boolean | undefined): number {
  return value ? 1 : 0;
}

function requiredDatabase(): DatabaseSync {
  if (!database) throw new Error('DATABASE_NOT_INITIALIZED');
  return database;
}

function transaction<T>(operation: (db: DatabaseSync) => T): T {
  const db = requiredDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function quickCheck(db: DatabaseSync): string {
  const row = db.prepare('PRAGMA quick_check').get();
  return String(row?.quick_check ?? row?.['quick_check'] ?? 'unknown');
}

function appliedSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get();
  return Number(row?.user_version ?? 0);
}

function listTableNames(db: DatabaseSync): string[] {
  return db.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map((row) => String(row.name));
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL CHECK(length(checksum) = 64),
      applied_at INTEGER NOT NULL
    ) STRICT;
  `);

  for (const migration of MIGRATIONS) {
    const checksum = sha256(migration.sql);
    const applied = db.prepare(
      'SELECT name, checksum FROM schema_migrations WHERE version = ?'
    ).get(migration.version);
    if (applied) {
      if (applied.name !== migration.name || applied.checksum !== checksum) {
        throw new Error(`DATABASE_MIGRATION_DRIFT version=${migration.version}`);
      }
      continue;
    }

    transaction((transactionDb) => {
      transactionDb.exec(migration.sql);
      transactionDb.prepare(
        'INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES(?,?,?,?)'
      ).run(migration.version, migration.name, checksum, Date.now());
      transactionDb.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

export async function initializeDatabase(dataDirectory: string): Promise<RuntimeDatabaseStatus> {
  if (database) return getDatabaseStatus();
  await fs.mkdir(dataDirectory, { recursive: true });
  const location = path.join(dataDirectory, 'joecoder.sqlite3');
  try {
    const db = new DatabaseSync(location);
    database = db;
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA busy_timeout = 5000');
    migrate(db);
    seedWorkshopDefaults(db);

    const tables = listTableNames(db);
    const missing = REQUIRED_TABLES.filter((table) => !tables.includes(table));
    if (missing.length) throw new Error(`DATABASE_REQUIRED_TABLES_MISSING: ${missing.join(', ')}`);
    const integrity = quickCheck(db);
    if (integrity !== 'ok') throw new Error(`DATABASE_QUICK_CHECK_FAILED: ${integrity}`);
    const version = appliedSchemaVersion(db);
    if (version !== DATABASE_SCHEMA_VERSION) {
      throw new Error(`DATABASE_SCHEMA_VERSION_MISMATCH: ${version}`);
    }

    status = {
      available: true,
      mode: 'transactional_shadow',
      path: location,
      schemaVersion: version,
      integrity: 'ok',
      journalMode: 'wal',
      tableCount: tables.length,
      lastError: null
    };
    setRuntimeMetadata('database_status', status);
    return getDatabaseStatus();
  } catch (error) {
    try {
      database?.close();
    } catch {}
    database = null;
    status = {
      available: false,
      mode: 'transactional_shadow',
      path: location,
      schemaVersion: 0,
      integrity: 'failed',
      journalMode: 'wal',
      tableCount: 0,
      lastError: error instanceof Error ? error.message : String(error)
    };
    throw error;
  }
}

export function getDatabaseStatus(): RuntimeDatabaseStatus {
  return { ...status };
}

export function closeDatabase(): void {
  if (!database) return;
  database.close();
  database = null;
  status = {
    ...status,
    available: false,
    integrity: 'not_initialized'
  };
}

export function setRuntimeMetadata(key: string, value: unknown): void {
  requiredDatabase().prepare(`
    INSERT INTO runtime_metadata(key, value_json, updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
  `).run(key, json(value), Date.now());
}

export function upsertProject(project: Project): void {
  transaction((db) => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO projects(
        id,name,canonical_path,description,workflow_stage,build_condition,execution_mode,
        created_at,updated_at,last_inspected_at,latest_survey_id,active_work_order_id,
        overview_path,record_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        canonical_path=excluded.canonical_path,
        description=excluded.description,
        workflow_stage=excluded.workflow_stage,
        build_condition=excluded.build_condition,
        execution_mode=excluded.execution_mode,
        updated_at=excluded.updated_at,
        last_inspected_at=excluded.last_inspected_at,
        latest_survey_id=excluded.latest_survey_id,
        active_work_order_id=excluded.active_work_order_id,
        overview_path=excluded.overview_path,
        record_version=projects.record_version+1
    `).run(
      project.id,
      project.name,
      path.resolve(project.path),
      project.description ?? null,
      project.workflowStage,
      project.buildCondition,
      project.executionMode ?? 'checkpoint',
      project.createdAt,
      now,
      project.lastInspectedAt ?? null,
      project.latestSurveyId ?? null,
      project.activeWorkOrderId ?? null,
      project.overviewPath ?? null
    );

    const permissions = project.permissions ?? {
      readFiles: true,
      writeFiles: false,
      installDeps: false,
      runApp: false,
      runTests: false,
      gitCommit: false,
      gitPush: false
    };
    db.prepare(`
      INSERT INTO project_permissions(
        project_id,read_files,write_files,install_deps,run_app,run_tests,git_commit,git_push,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET
        read_files=excluded.read_files,
        write_files=excluded.write_files,
        install_deps=excluded.install_deps,
        run_app=excluded.run_app,
        run_tests=excluded.run_tests,
        git_commit=excluded.git_commit,
        git_push=excluded.git_push,
        updated_at=excluded.updated_at
    `).run(
      project.id,
      bool(permissions.readFiles),
      bool(permissions.writeFiles),
      bool(permissions.installDeps),
      bool(permissions.runApp),
      bool(permissions.runTests),
      bool(permissions.gitCommit),
      bool(permissions.gitPush),
      now
    );
  });
}

export function upsertWorkOrder(workOrder: WorkOrder, projectId: string | null): void {
  transaction((db) => {
    db.prepare(`
      INSERT INTO work_orders(
        id,project_id,plan_version,status,intent,objective,dependency_completion_state,
        linked_survey_id,scope_json,budgets_json,risk_json,task_specific_json,
        donor_disposition_json,stop_loss_json,completion_json,authorization_required,
        authorization_granted,authorization_granted_at,authorization_granted_by,
        created_at,updated_at,record_version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id,
        plan_version=excluded.plan_version,
        status=excluded.status,
        intent=excluded.intent,
        objective=excluded.objective,
        dependency_completion_state=excluded.dependency_completion_state,
        linked_survey_id=excluded.linked_survey_id,
        scope_json=excluded.scope_json,
        budgets_json=excluded.budgets_json,
        risk_json=excluded.risk_json,
        task_specific_json=excluded.task_specific_json,
        donor_disposition_json=excluded.donor_disposition_json,
        stop_loss_json=excluded.stop_loss_json,
        completion_json=excluded.completion_json,
        authorization_required=excluded.authorization_required,
        authorization_granted=excluded.authorization_granted,
        authorization_granted_at=excluded.authorization_granted_at,
        authorization_granted_by=excluded.authorization_granted_by,
        updated_at=excluded.updated_at,
        record_version=work_orders.record_version+1
    `).run(
      workOrder.id,
      projectId,
      workOrder.planVersion,
      workOrder.status,
      workOrder.intent,
      workOrder.objective,
      workOrder.dependencyCompletionState,
      workOrder.linkedSurveyId,
      json(workOrder.scope),
      json(workOrder.budgets),
      workOrder.risk ? json(workOrder.risk) : null,
      workOrder.taskSpecific ? json(workOrder.taskSpecific) : null,
      workOrder.donorDisposition ? json(workOrder.donorDisposition) : null,
      workOrder.stopLoss ? json(workOrder.stopLoss) : null,
      workOrder.completion ? json(workOrder.completion) : null,
      bool(workOrder.authorization.required),
      bool(workOrder.authorization.granted),
      workOrder.authorization.grantedAt,
      workOrder.authorization.grantedBy,
      workOrder.createdAt,
      workOrder.updatedAt
    );

    db.prepare('DELETE FROM work_order_dependencies WHERE work_order_id=?').run(workOrder.id);
    for (const dependencyId of workOrder.dependsOn) {
      db.prepare(`
        INSERT INTO work_order_dependencies(
          work_order_id,depends_on_id,required_state,verified_evidence_required,reason
        ) VALUES(?,?,?,?,?)
      `).run(
        workOrder.id,
        dependencyId,
        'completed',
        1,
        `Runtime dependency ${dependencyId} must be completed with verified evidence.`
      );
    }

    db.prepare('DELETE FROM work_order_acceptance WHERE work_order_id=?').run(workOrder.id);
    workOrder.acceptance.forEach((acceptance, ordinal) => {
      db.prepare(`
        INSERT INTO work_order_acceptance(
          work_order_id,acceptance_id,ordinal,criterion,mandatory
        ) VALUES(?,?,?,?,?)
      `).run(workOrder.id, acceptance.id, ordinal, acceptance.criterion, bool(acceptance.mandatory));
    });

    db.prepare('DELETE FROM work_order_evidence WHERE work_order_id=?').run(workOrder.id);
    workOrder.evidenceIds.forEach((evidenceId, ordinal) => {
      const role = evidenceId === workOrder.linkedSurveyId ? 'linked_survey' : 'supporting';
      db.prepare(`
        INSERT INTO work_order_evidence(work_order_id,evidence_id,role,ordinal)
        VALUES(?,?,?,?)
      `).run(workOrder.id, evidenceId, role, ordinal);
    });

    db.prepare('DELETE FROM acceptance_results WHERE work_order_id=?').run(workOrder.id);
    for (const result of workOrder.completion?.acceptanceResults ?? []) {
      db.prepare(`
        INSERT INTO acceptance_results(
          work_order_id,acceptance_id,criterion,passed,detail,evidence_ids_json,decided_at
        ) VALUES(?,?,?,?,?,?,?)
      `).run(
        workOrder.id,
        result.id,
        result.criterion,
        bool(result.passed),
        result.detail,
        json(result.evidenceIds),
        workOrder.completion!.decidedAt
      );
    }

    if (workOrder.authorization.granted && workOrder.authorization.grantedAt) {
      db.prepare(`
        INSERT OR IGNORE INTO authorization_grants(
          work_order_id,session_id,granted_by,granted_at,expires_at,revoked_at,scope_hash
        ) VALUES(?,?,?,?,?,?,?)
      `).run(
        workOrder.id,
        null,
        workOrder.authorization.grantedBy ?? 'unknown',
        workOrder.authorization.grantedAt,
        null,
        null,
        workOrder.authorization.envelopeHash ?? sha256(json(workOrder.scope))
      );
    }
  });
}

export function upsertEvidenceRecord(record: EvidenceDatabaseRecord): void {
  requiredDatabase().prepare(`
    INSERT INTO evidence_records(
      id,project_id,work_order_id,evidence_type,file_path,content_hash,integrity_state,
      payload_size_bytes,created_at,observed_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      project_id=COALESCE(excluded.project_id,evidence_records.project_id),
      work_order_id=COALESCE(excluded.work_order_id,evidence_records.work_order_id),
      evidence_type=excluded.evidence_type,
      file_path=excluded.file_path,
      content_hash=excluded.content_hash,
      integrity_state=excluded.integrity_state,
      payload_size_bytes=excluded.payload_size_bytes,
      observed_at=excluded.observed_at
  `).run(
    record.id,
    record.projectId,
    record.workOrderId,
    record.type,
    record.filePath,
    record.contentHash,
    record.integrityState,
    record.payloadSizeBytes,
    record.createdAt,
    record.observedAt
  );
}

export function insertEventRecord(record: EventDatabaseRecord): void {
  requiredDatabase().prepare(`
    INSERT OR IGNORE INTO event_log(
      event_hash,previous_hash,project_id,work_order_id,event_type,occurred_at,payload_json,integrity_state
    ) VALUES(?,?,?,?,?,?,?,?)
  `).run(
    record.hash,
    record.previousHash,
    record.projectId,
    record.workOrderId,
    record.type,
    record.occurredAt,
    json(record.payload),
    record.integrityState
  );
}

export function replaceConversation(projectId: string, messages: ChatMessage[]): void {
  transaction((db) => {
    db.prepare('DELETE FROM conversation_messages WHERE project_id=?').run(projectId);
    messages.forEach((message, ordinal) => {
      db.prepare(`
        INSERT INTO conversation_messages(
          id,project_id,role,content,suggestions_json,created_at,ordinal
        ) VALUES(?,?,?,?,?,?,?)
      `).run(
        message.id,
        projectId,
        message.role,
        message.content,
        message.suggestions ? json(message.suggestions) : null,
        message.createdAt,
        ordinal
      );
    });
  });
}

export function recordSessionCreated(session: {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}): void {
  requiredDatabase().prepare(`
    INSERT INTO session_audit(session_id,created_at,last_seen_at,expires_at,ended_at,end_reason)
    VALUES(?,?,?,?,NULL,NULL)
    ON CONFLICT(session_id) DO UPDATE SET
      last_seen_at=excluded.last_seen_at,
      expires_at=excluded.expires_at
  `).run(session.id, session.createdAt, session.lastSeenAt, session.expiresAt);
}

export function recordSessionEnded(sessionId: string, reason: string): void {
  requiredDatabase().prepare(`
    UPDATE session_audit SET ended_at=?, end_reason=? WHERE session_id=?
  `).run(Date.now(), reason, sessionId);
}

export function recordIdempotencyUse(input: {
  sessionId: string;
  key: string;
  method: string;
  routePath: string;
  requestHash: string;
  createdAt: number;
  expiresAt: number;
}): void {
  requiredDatabase().prepare(`
    INSERT INTO idempotency_records(
      session_id,key_hash,method,route_path,request_hash,response_status,response_hash,
      created_at,expires_at
    ) VALUES(?,?,?,?,?,NULL,NULL,?,?)
  `).run(
    input.sessionId,
    sha256(input.key),
    input.method,
    input.routePath,
    input.requestHash,
    input.createdAt,
    input.expiresAt
  );
}

export function recordRecoveryCheckpoint(input: {
  workOrderId: string | null;
  phase: string;
  state: 'committed' | 'resumable' | 'rollback_required' | 'recovered' | 'failed';
  detail: unknown;
}): void {
  const detailJson = json(input.detail);
  requiredDatabase().prepare(`
    INSERT INTO recovery_checkpoints(
      work_order_id,phase,recovery_state,payload_hash,detail_json,created_at
    ) VALUES(?,?,?,?,?,?)
  `).run(
    input.workOrderId,
    input.phase,
    input.state,
    sha256(detailJson),
    detailJson,
    Date.now()
  );
}

export function verifyDatabase(): {
  ok: boolean;
  quickCheck: string;
  foreignKeyViolations: number;
  schemaVersion: number;
  tables: string[];
} {
  const db = requiredDatabase();
  const quick = quickCheck(db);
  const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all().length;
  const tables = listTableNames(db);
  return {
    ok:
      quick === 'ok' &&
      foreignKeyViolations === 0 &&
      appliedSchemaVersion(db) === DATABASE_SCHEMA_VERSION &&
      REQUIRED_TABLES.every((table) => tables.includes(table)),
    quickCheck: quick,
    foreignKeyViolations,
    schemaVersion: appliedSchemaVersion(db),
    tables
  };
}

export async function backupDatabase(destination: string): Promise<{
  path: string;
  sizeBytes: number;
  sha256: string;
}> {
  const db = requiredDatabase();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await sqliteBackup(db, destination);
  const bytes = await fs.readFile(destination);
  return { path: destination, sizeBytes: bytes.length, sha256: sha256(bytes) };
}

export function databaseCounts(): Record<string, number> {
  const db = requiredDatabase();
  const result: Record<string, number> = {};
  for (const table of REQUIRED_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    result[table] = Number(row?.count ?? 0);
  }
  return result;
}

export interface ProjectThread {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  presetId: string;
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number | null;
}

export interface ProjectBrain {
  projectId: string;
  guidancePresetId: string;
  purpose: string;
  preferences: string;
  environment: string;
  architecture: string;
  constraints: string;
  decisions: string;
  knownIssues: string;
  verifiedTruth: string;
  evidenceIds: string[];
  freshnessAt: number | null;
  updatedAt: number;
}

export interface ModelPreset {
  id: string;
  name: string;
  description: string;
  taskKind: string;
  privacyMode: 'local_only' | 'local_first' | 'authorized_cloud';
  qualityPriority: number;
  speedPriority: number;
  costPriority: number;
  requiredCapabilities: string[];
  builtIn: boolean;
}

const BUILT_IN_PRESETS: ModelPreset[] = [
  { id: 'preset-auto', name: 'Auto', description: 'Joe routes by task needs, declared capabilities, privacy, live provider health, and permitted cost.', taskKind: 'auto', privacyMode: 'local_first', qualityPriority: 4, speedPriority: 3, costPriority: 3, requiredCapabilities: [], builtIn: true },
  { id: 'preset-visual-ui', name: 'Visual UI', description: 'Prioritizes visual reasoning, screenshots, interaction quality, and frontend implementation.', taskKind: 'visual_ui', privacyMode: 'local_first', qualityPriority: 5, speedPriority: 2, costPriority: 2, requiredCapabilities: ['vision', 'code', 'tools'], builtIn: true },
  { id: 'preset-frontend-polish', name: 'Frontend Polish', description: 'Focuses on responsive behavior, accessibility, wiring, and finish quality.', taskKind: 'frontend', privacyMode: 'local_first', qualityPriority: 5, speedPriority: 3, costPriority: 2, requiredCapabilities: ['code', 'tools'], builtIn: true },
  { id: 'preset-backend-repair', name: 'Backend Repair', description: 'Favors diagnosis, tests, safe patches, and evidence-backed recovery.', taskKind: 'backend_repair', privacyMode: 'local_first', qualityPriority: 5, speedPriority: 2, costPriority: 3, requiredCapabilities: ['code', 'tools'], builtIn: true },
  { id: 'preset-quick-repair', name: 'Quick Repair', description: 'Uses a narrow scope and fast verification for contained defects.', taskKind: 'repair', privacyMode: 'local_first', qualityPriority: 3, speedPriority: 5, costPriority: 4, requiredCapabilities: ['code', 'tools'], builtIn: true },
  { id: 'preset-deep-refactor', name: 'Deep Refactor', description: 'Prioritizes architecture, broad context, regression protection, and staged change.', taskKind: 'refactor', privacyMode: 'local_first', qualityPriority: 5, speedPriority: 1, costPriority: 2, requiredCapabilities: ['code', 'long_context', 'tools'], builtIn: true },
  { id: 'preset-architecture', name: 'Architecture', description: 'Explores system boundaries, dependencies, tradeoffs, and durable plans.', taskKind: 'architecture', privacyMode: 'local_first', qualityPriority: 5, speedPriority: 2, costPriority: 2, requiredCapabilities: ['long_context'], builtIn: true },
  { id: 'preset-investigate', name: 'Investigate', description: 'Stays read-only while gathering evidence and testing competing explanations.', taskKind: 'investigate', privacyMode: 'local_first', qualityPriority: 5, speedPriority: 2, costPriority: 4, requiredCapabilities: ['tools'], builtIn: true },
  { id: 'preset-ship', name: 'Ship', description: 'Emphasizes acceptance checks, release readiness, handoff, and proof of completion.', taskKind: 'ship', privacyMode: 'local_first', qualityPriority: 5, speedPriority: 3, costPriority: 2, requiredCapabilities: ['code', 'tools'], builtIn: true },
  { id: 'preset-local-only', name: 'Local Only', description: 'Confines all model work to an available local provider.', taskKind: 'auto', privacyMode: 'local_only', qualityPriority: 3, speedPriority: 3, costPriority: 5, requiredCapabilities: [], builtIn: true },
  { id: 'preset-maximum-quality', name: 'Maximum Quality', description: 'Optimizes for result quality and verification over latency.', taskKind: 'auto', privacyMode: 'authorized_cloud', qualityPriority: 5, speedPriority: 1, costPriority: 1, requiredCapabilities: ['long_context', 'tools'], builtIn: true },
  { id: 'preset-windows-app', name: 'Windows App', description: 'Prioritizes Windows behavior, packaging, paths, permissions, and native UX.', taskKind: 'windows_app', privacyMode: 'local_first', qualityPriority: 5, speedPriority: 2, costPriority: 3, requiredCapabilities: ['code', 'tools'], builtIn: true },
  { id: 'preset-audio-music', name: 'Audio & Music', description: 'Optimizes for realtime audio, signal flow, musical UX, and performance.', taskKind: 'audio', privacyMode: 'local_first', qualityPriority: 5, speedPriority: 2, costPriority: 2, requiredCapabilities: ['code', 'long_context'], builtIn: true },
  { id: 'preset-3d-cad', name: '3D / CAD', description: 'Prioritizes geometry, rendering, spatial interaction, and performance.', taskKind: '3d', privacyMode: 'local_first', qualityPriority: 5, speedPriority: 2, costPriority: 2, requiredCapabilities: ['vision', 'code', 'tools'], builtIn: true }
];

function seedWorkshopDefaults(db: DatabaseSync): void {
  const now = Date.now();
  const insertPreset = db.prepare(`
    INSERT INTO model_presets(
      id,name,description,task_kind,privacy_mode,quality_priority,speed_priority,cost_priority,
      required_capabilities_json,built_in,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,description=excluded.description,task_kind=excluded.task_kind,
      privacy_mode=excluded.privacy_mode,quality_priority=excluded.quality_priority,
      speed_priority=excluded.speed_priority,cost_priority=excluded.cost_priority,
      required_capabilities_json=excluded.required_capabilities_json,updated_at=excluded.updated_at
  `);
  for (const preset of BUILT_IN_PRESETS) {
    insertPreset.run(
      preset.id, preset.name, preset.description, preset.taskKind, preset.privacyMode,
      preset.qualityPriority, preset.speedPriority, preset.costPriority,
      json(preset.requiredCapabilities), 1, now, now
    );
  }
  const providers = [
    ['provider-ollama', 'ollama', 'Ollama on this computer', 'local', process.env.JC_OLLAMA_URL || 'http://127.0.0.1:11434', process.env.JC_OLLAMA_MODEL || null, null],
    ['provider-anthropic', 'anthropic', 'Anthropic', 'cloud', process.env.JC_ANTHROPIC_URL || 'https://api.anthropic.com', process.env.JC_ANTHROPIC_MODEL || 'claude-opus-5', 'ANTHROPIC_API_KEY']
  ] as const;
  const insertProvider = db.prepare(`
    INSERT INTO provider_profiles(
      id,provider,display_name,kind,endpoint,default_model,secret_env_var,enabled,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      endpoint=excluded.endpoint,default_model=excluded.default_model,
      secret_env_var=excluded.secret_env_var,enabled=excluded.enabled,updated_at=excluded.updated_at
  `);
  for (const provider of providers) {
    const configured = provider[3] === 'local' || Boolean(provider[6] && process.env[provider[6]]);
    insertProvider.run(...provider, configured ? 1 : 0, now, now);
  }
}

function threadFromRow(row: Record<string, unknown>): ProjectThread {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    objective: String(row.objective || ''),
    presetId: String(row.preset_id || 'preset-auto'),
    status: String(row.status) as ProjectThread['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastMessageAt: row.last_message_at == null ? null : Number(row.last_message_at)
  };
}

export function listProjectThreads(projectId: string): ProjectThread[] {
  return requiredDatabase().prepare(`
    SELECT * FROM project_threads WHERE project_id=? ORDER BY status='active' DESC, updated_at DESC
  `).all(projectId).map((row) => threadFromRow(row as Record<string, unknown>));
}

export function createProjectThread(input: {
  projectId: string;
  title: string;
  objective?: string;
  presetId?: string;
}): ProjectThread {
  const now = Date.now();
  const id = `thread-${randomBytes(8).toString('hex')}`;
  requiredDatabase().prepare(`
    INSERT INTO project_threads(id,project_id,title,objective,preset_id,status,created_at,updated_at,last_message_at)
    VALUES(?,?,?,?,?,'active',?,?,NULL)
  `).run(id, input.projectId, input.title.trim(), input.objective?.trim() || '', input.presetId || 'preset-auto', now, now);
  return getProjectThread(input.projectId, id)!;
}


export function ensureProjectThread(projectId: string, projectName: string): ProjectThread {
  const existing = listProjectThreads(projectId).find((thread) => thread.status === 'active');
  if (existing) return existing;
  const created = createProjectThread({ projectId, title: `${projectName} workspace`, presetId: 'preset-auto' });
  const legacy = requiredDatabase().prepare(`
    SELECT id,role,content,suggestions_json,created_at FROM conversation_messages
    WHERE project_id=? ORDER BY ordinal
  `).all(projectId).map((row) => ({
    id: String(row.id),
    role: String(row.role) as ChatMessage['role'],
    content: String(row.content),
    ...(row.suggestions_json ? { suggestions: JSON.parse(String(row.suggestions_json)) } : {}),
    createdAt: String(row.created_at)
  }));
  if (legacy.length) replaceThreadConversation(created.id, legacy);
  return created;
}

export function getProjectThread(projectId: string, threadId: string): ProjectThread | null {
  const row = requiredDatabase().prepare(
    'SELECT * FROM project_threads WHERE id=? AND project_id=?'
  ).get(threadId, projectId);
  return row ? threadFromRow(row as Record<string, unknown>) : null;
}

export function updateProjectThread(projectId: string, threadId: string, changes: {
  title?: string;
  objective?: string;
  presetId?: string;
  status?: 'active' | 'archived';
}): ProjectThread | null {
  const current = getProjectThread(projectId, threadId);
  if (!current) return null;
  requiredDatabase().prepare(`
    UPDATE project_threads SET title=?, objective=?, preset_id=?, status=?, updated_at=?
    WHERE id=? AND project_id=?
  `).run(
    changes.title?.trim() || current.title,
    changes.objective?.trim() ?? current.objective,
    changes.presetId || current.presetId,
    changes.status || current.status,
    Date.now(),
    threadId,
    projectId
  );
  return getProjectThread(projectId, threadId);
}

export function loadThreadConversation(threadId: string): ChatMessage[] {
  return requiredDatabase().prepare(`
    SELECT id,role,content,suggestions_json,created_at FROM thread_messages
    WHERE thread_id=? ORDER BY ordinal
  `).all(threadId).map((row) => ({
    id: String(row.id),
    role: String(row.role) as ChatMessage['role'],
    content: String(row.content),
    ...(row.suggestions_json ? { suggestions: JSON.parse(String(row.suggestions_json)) } : {}),
    createdAt: String(row.created_at)
  }));
}

export function replaceThreadConversation(threadId: string, messages: ChatMessage[]): void {
  transaction((db) => {
    db.prepare('DELETE FROM thread_messages WHERE thread_id=?').run(threadId);
    const insert = db.prepare(`
      INSERT INTO thread_messages(id,thread_id,role,content,suggestions_json,created_at,ordinal)
      VALUES(?,?,?,?,?,?,?)
    `);
    messages.forEach((message, ordinal) => insert.run(
      message.id, threadId, message.role, message.content,
      message.suggestions ? json(message.suggestions) : null, message.createdAt, ordinal
    ));
    const last = messages.at(-1);
    db.prepare('UPDATE project_threads SET updated_at=?,last_message_at=? WHERE id=?')
      .run(Date.now(), last ? Date.parse(last.createdAt) || Date.now() : null, threadId);
  });
}

export function getProjectBrain(projectId: string): ProjectBrain {
  const row = requiredDatabase().prepare('SELECT * FROM project_brain WHERE project_id=?').get(projectId);
  if (!row) {
    const now = Date.now();
    requiredDatabase().prepare('INSERT INTO project_brain(project_id,updated_at) VALUES(?,?)').run(projectId, now);
    return getProjectBrain(projectId);
  }
  return {
    projectId: String(row.project_id),
    guidancePresetId: String(row.guidance_preset_id || 'brain-preset-exceptional-builder'),
    purpose: String(row.purpose || ''),
    preferences: String(row.preferences || ''),
    environment: String(row.environment || ''),
    architecture: String(row.architecture || ''),
    constraints: String(row.constraints_text || ''),
    decisions: String(row.decisions || ''),
    knownIssues: String(row.known_issues || ''),
    verifiedTruth: String(row.verified_truth || ''),
    evidenceIds: JSON.parse(String(row.evidence_ids_json || '[]')),
    freshnessAt: row.freshness_at == null ? null : Number(row.freshness_at),
    updatedAt: Number(row.updated_at)
  };
}

export function saveProjectBrain(projectId: string, brain: Omit<ProjectBrain, 'projectId' | 'updatedAt'>): ProjectBrain {
  requiredDatabase().prepare(`
    INSERT INTO project_brain(
      project_id,guidance_preset_id,purpose,preferences,environment,architecture,constraints_text,
      decisions,known_issues,verified_truth,evidence_ids_json,freshness_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET
      guidance_preset_id=excluded.guidance_preset_id,
      purpose=excluded.purpose,preferences=excluded.preferences,environment=excluded.environment,
      architecture=excluded.architecture,constraints_text=excluded.constraints_text,
      decisions=excluded.decisions,known_issues=excluded.known_issues,
      verified_truth=excluded.verified_truth,evidence_ids_json=excluded.evidence_ids_json,
      freshness_at=excluded.freshness_at,updated_at=excluded.updated_at
  `).run(
    projectId, brain.guidancePresetId, brain.purpose, brain.preferences, brain.environment, brain.architecture,
    brain.constraints, brain.decisions, brain.knownIssues, brain.verifiedTruth,
    json(brain.evidenceIds), brain.freshnessAt, Date.now()
  );
  return getProjectBrain(projectId);
}

export function listModelPresets(): ModelPreset[] {
  return requiredDatabase().prepare('SELECT * FROM model_presets ORDER BY built_in DESC, name').all().map((row) => ({
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    taskKind: String(row.task_kind),
    privacyMode: String(row.privacy_mode) as ModelPreset['privacyMode'],
    qualityPriority: Number(row.quality_priority),
    speedPriority: Number(row.speed_priority),
    costPriority: Number(row.cost_priority),
    requiredCapabilities: JSON.parse(String(row.required_capabilities_json)),
    builtIn: Boolean(row.built_in)
  }));
}

export function listProviderProfiles(): Array<Record<string, unknown>> {
  return requiredDatabase().prepare(`
    SELECT id,provider,display_name,kind,endpoint,default_model,secret_env_var,enabled,updated_at
    FROM provider_profiles ORDER BY kind,display_name
  `).all().map((row) => ({
    id: String(row.id),
    provider: String(row.provider),
    displayName: String(row.display_name),
    kind: String(row.kind),
    endpoint: row.endpoint == null ? null : String(row.endpoint),
    defaultModel: row.default_model == null ? null : String(row.default_model),
    secretEnvVar: row.secret_env_var == null ? null : String(row.secret_env_var),
    configured: Boolean(row.enabled),
    updatedAt: Number(row.updated_at)
  }));
}

export type AgentJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
export type AgentJobStage = 'understand' | 'inspect' | 'plan' | 'authorize' | 'run' | 'verify' | 'complete' | 'blocked';

export interface AgentJobRecord {
  id: string;
  projectId: string;
  threadId: string;
  objective: string;
  status: AgentJobStatus;
  stage: AgentJobStage;
  intent: 'inspect' | 'repair' | 'build' | 'export' | null;
  workOrderId: string | null;
  message: string;
  result: unknown | null;
  errorCode: string | null;
  errorMessage: string | null;
  resumeCount: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface AgentJobEventRecord {
  id: number;
  jobId: string;
  ordinal: number;
  stage: string;
  kind: 'progress' | 'decision' | 'result' | 'failure';
  what: string;
  meaning: string;
  next: string;
  payload: unknown;
  createdAt: number;
}

function mapAgentJob(row: Record<string, unknown>): AgentJobRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    threadId: String(row.thread_id),
    objective: String(row.objective),
    status: String(row.status) as AgentJobStatus,
    stage: String(row.stage) as AgentJobStage,
    intent: row.intent == null ? null : String(row.intent) as AgentJobRecord['intent'],
    workOrderId: row.work_order_id == null ? null : String(row.work_order_id),
    message: String(row.message || ''),
    result: row.result_json == null ? null : JSON.parse(String(row.result_json)),
    errorCode: row.error_code == null ? null : String(row.error_code),
    errorMessage: row.error_message == null ? null : String(row.error_message),
    resumeCount: Number(row.resume_count),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    startedAt: row.started_at == null ? null : Number(row.started_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at)
  };
}

export function createAgentJob(input: { projectId: string; threadId: string; objective: string }): AgentJobRecord {
  const id = `job-${randomBytes(12).toString('hex')}`;
  const now = Date.now();
  requiredDatabase().prepare(`
    INSERT INTO agent_jobs(
      id,project_id,thread_id,objective,status,stage,message,created_at,updated_at
    ) VALUES(?,?,?,?, 'queued','understand',?,?,?)
  `).run(id, input.projectId, input.threadId, input.objective.trim(), 'Queued for Joe.', now, now);
  return getAgentJob(id)!;
}

export function getAgentJob(id: string): AgentJobRecord | null {
  const row = requiredDatabase().prepare('SELECT * FROM agent_jobs WHERE id=?').get(id);
  return row ? mapAgentJob(row) : null;
}

export function listAgentJobs(projectId: string, limit = 20): AgentJobRecord[] {
  return requiredDatabase().prepare(`
    SELECT * FROM agent_jobs WHERE project_id=? ORDER BY updated_at DESC LIMIT ?
  `).all(projectId, Math.max(1, Math.min(limit, 100))).map(mapAgentJob);
}

export function getActiveAgentJob(projectId: string): AgentJobRecord | null {
  const row = requiredDatabase().prepare(`
    SELECT * FROM agent_jobs WHERE project_id=? AND status IN ('queued','running')
    ORDER BY updated_at DESC LIMIT 1
  `).get(projectId);
  return row ? mapAgentJob(row) : null;
}

export function updateAgentJob(id: string, patch: Partial<Pick<AgentJobRecord,
  'status' | 'stage' | 'intent' | 'workOrderId' | 'message' | 'result' |
  'errorCode' | 'errorMessage' | 'resumeCount' | 'startedAt' | 'finishedAt'
>>): AgentJobRecord {
  const current = getAgentJob(id);
  if (!current) throw new Error(`AGENT_JOB_NOT_FOUND: ${id}`);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  requiredDatabase().prepare(`
    UPDATE agent_jobs SET status=?,stage=?,intent=?,work_order_id=?,message=?,result_json=?,
      error_code=?,error_message=?,resume_count=?,updated_at=?,started_at=?,finished_at=? WHERE id=?
  `).run(
    next.status, next.stage, next.intent, next.workOrderId, next.message,
    next.result == null ? null : json(next.result), next.errorCode, next.errorMessage,
    next.resumeCount, next.updatedAt, next.startedAt, next.finishedAt, id
  );
  return getAgentJob(id)!;
}

export function appendAgentJobEvent(input: Omit<AgentJobEventRecord, 'id' | 'ordinal' | 'createdAt'>): AgentJobEventRecord {
  return transaction((db) => {
    const ordinalRow = db.prepare(`
      SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM agent_job_events WHERE job_id=?
    `).get(input.jobId);
    const ordinal = Number(ordinalRow?.ordinal || 0);
    const createdAt = Date.now();
    const result = db.prepare(`
      INSERT INTO agent_job_events(job_id,ordinal,stage,kind,what,meaning,next_action,payload_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(input.jobId, ordinal, input.stage, input.kind, input.what, input.meaning, input.next, json(input.payload), createdAt);
    return { id: Number(result.lastInsertRowid), ordinal, createdAt, ...input };
  });
}

export function listAgentJobEvents(jobId: string, afterOrdinal = -1): AgentJobEventRecord[] {
  return requiredDatabase().prepare(`
    SELECT * FROM agent_job_events WHERE job_id=? AND ordinal>? ORDER BY ordinal
  `).all(jobId, afterOrdinal).map((row) => ({
    id: Number(row.id),
    jobId: String(row.job_id),
    ordinal: Number(row.ordinal),
    stage: String(row.stage),
    kind: String(row.kind) as AgentJobEventRecord['kind'],
    what: String(row.what),
    meaning: String(row.meaning || ''),
    next: String(row.next_action || ''),
    payload: JSON.parse(String(row.payload_json || '{}')),
    createdAt: Number(row.created_at)
  }));
}

export function interruptRunningAgentJobs(): number {
  const now = Date.now();
  const result = requiredDatabase().prepare(`
    UPDATE agent_jobs SET status='interrupted',stage='blocked',
      message='JoeCoder restarted before this job reached a terminal result. Resume it from the same project.',
      error_code='SERVICE_RESTARTED',error_message='The service restarted during this job.',
      updated_at=?,finished_at=? WHERE status IN ('queued','running')
  `).run(now, now);
  return Number(result.changes);
}
export function recordRoutingOutcome(input: {
  projectId: string;
  threadId: string;
  presetId: string;
  provider: string;
  model: string;
  taskKind: string;
  succeeded: boolean;
  latencyMs: number;
  detail?: string;
}): void {
  requiredDatabase().prepare(`
    INSERT INTO routing_outcomes(
      project_id,thread_id,preset_id,provider,model,task_kind,succeeded,latency_ms,
      cloud_cost_usd,evidence_id,detail,recorded_at
    ) VALUES(?,?,?,?,?,?,?,?,0,NULL,?,?)
  `).run(
    input.projectId, input.threadId, input.presetId, input.provider, input.model,
    input.taskKind, input.succeeded ? 1 : 0, Math.max(0, input.latencyMs),
    input.detail || '', Date.now()
  );
}


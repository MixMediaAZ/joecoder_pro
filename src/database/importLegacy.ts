import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage } from '../chat.js';
import type { Project, WorkOrder } from '../types.js';
import {
  insertEventRecord,
  recordRecoveryCheckpoint,
  replaceConversation,
  setRuntimeMetadata,
  upsertEvidenceRecord,
  upsertProject,
  upsertWorkOrder
} from './database.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function projectForWorkOrder(
  workOrder: WorkOrder,
  projects: Map<string, Project>
): Project | undefined {
  return Array.from(projects.values()).find((project) =>
    project.activeWorkOrderId === workOrder.id ||
    project.latestSurveyId === workOrder.linkedSurveyId ||
    workOrder.scope.exactPaths.includes(project.path)
  );
}

function projectForEvidence(
  evidenceId: string,
  content: Record<string, unknown>,
  projects: Map<string, Project>,
  workOrders: Map<string, WorkOrder>
): Project | undefined {
  if (typeof content.projectId === 'string' && projects.has(content.projectId)) {
    return projects.get(content.projectId);
  }
  const direct = Array.from(projects.values()).find((project) => project.latestSurveyId === evidenceId);
  if (direct) return direct;
  const workOrder = Array.from(workOrders.values()).find((candidate) =>
    candidate.linkedSurveyId === evidenceId || candidate.evidenceIds.includes(evidenceId)
  );
  return workOrder ? projectForWorkOrder(workOrder, projects) : undefined;
}

function timestampFromContent(content: Record<string, unknown>, fallback: number): number {
  if (typeof content.timestamp === 'number' && Number.isFinite(content.timestamp)) return content.timestamp;
  if (typeof content.generatedAt === 'string') {
    const parsed = Date.parse(content.generatedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Math.trunc(fallback);
}

async function importEvidence(
  dataDirectory: string,
  projects: Map<string, Project>,
  workOrders: Map<string, WorkOrder>
): Promise<number> {
  const directory = path.join(dataDirectory, 'evidence');
  let files: string[];
  try {
    files = await fs.readdir(directory);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  let imported = 0;
  for (const file of files.filter((name) => /^EVC-.*\.json$/.test(name)).sort()) {
    const id = file.slice(0, -5);
    const filePath = path.join(directory, file);
    const contentString = await fs.readFile(filePath, 'utf8');
    const content = JSON.parse(contentString) as Record<string, unknown>;
    const observedHash = sha256(contentString);
    let expectedHash: string | null = null;
    try {
      expectedHash = (await fs.readFile(path.join(directory, `${id}.integrity`), 'utf8')).trim();
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const integrityState = expectedHash === null
      ? 'legacy_unverified'
      : expectedHash === observedHash
        ? 'verified'
        : 'corrupt';
    const stat = await fs.stat(filePath);
    const project = projectForEvidence(id, content, projects, workOrders);
    const declaredWorkOrderId =
      typeof content.workOrderId === 'string'
        ? content.workOrderId
        : typeof content.work_order_id === 'string'
          ? content.work_order_id
          : null;
    upsertEvidenceRecord({
      id,
      projectId: project?.id ?? null,
      workOrderId: declaredWorkOrderId,
      type: typeof content.type === 'string' ? content.type : 'unknown',
      filePath,
      contentHash: expectedHash,
      integrityState,
      payloadSizeBytes: Buffer.byteLength(contentString),
      createdAt: timestampFromContent(content, stat.birthtimeMs || stat.mtimeMs),
      observedAt: Date.now()
    });
    imported += 1;
  }
  return imported;
}

async function importConversations(dataDirectory: string, projects: Map<string, Project>): Promise<number> {
  const directory = path.join(dataDirectory, 'conversations');
  let files: string[];
  try {
    files = await fs.readdir(directory);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  let imported = 0;
  for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
    const projectId = file.slice(0, -5);
    if (!projects.has(projectId)) continue;
    const parsed = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8')) as ChatMessage[];
    if (!Array.isArray(parsed)) throw new Error(`LEGACY_CONVERSATION_MALFORMED: ${file}`);
    replaceConversation(projectId, parsed);
    imported += parsed.length;
  }
  return imported;
}

async function importEvents(dataDirectory: string): Promise<number> {
  const file = path.join(dataDirectory, 'events.jsonl');
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  let imported = 0;
  for (const line of raw.split('\n').filter(Boolean)) {
    const event = JSON.parse(line) as {
      ts: number;
      type: string;
      payload?: Record<string, unknown>;
      previousHash?: string | null;
      hash: string;
    };
    const payload = event.payload ?? {};
    const projectId = typeof payload.projectId === 'string' ? payload.projectId : null;
    const workOrderId =
      typeof payload.id === 'string' && payload.id.startsWith('JC') ? payload.id : null;
    insertEventRecord({
      hash: event.hash,
      previousHash: event.previousHash ?? null,
      projectId,
      workOrderId,
      type: event.type,
      occurredAt: event.ts,
      payload,
      integrityState: Object.hasOwn(event, 'previousHash') ? 'verified_chain' : 'legacy_unverified'
    });
    imported += 1;
  }
  return imported;
}

function importWorkOrders(
  projects: Map<string, Project>,
  workOrders: Map<string, WorkOrder>
): number {
  const pending = new Map(workOrders);
  const imported = new Set<string>();
  while (pending.size > 0) {
    let progressed = false;
    for (const [id, workOrder] of pending) {
      if (!workOrder.dependsOn.every((dependencyId) => imported.has(dependencyId))) continue;
      upsertWorkOrder(workOrder, projectForWorkOrder(workOrder, projects)?.id ?? null);
      imported.add(id);
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) {
      throw new Error(`LEGACY_WORK_ORDER_DEPENDENCY_UNRESOLVED: ${Array.from(pending.keys()).join(', ')}`);
    }
  }
  return imported.size;
}

export async function importLegacyData(input: {
  dataDirectory: string;
  projects: Map<string, Project>;
  workOrders: Map<string, WorkOrder>;
}): Promise<{
  projects: number;
  workOrders: number;
  evidence: number;
  events: number;
  conversationMessages: number;
}> {
  for (const project of input.projects.values()) upsertProject(project);
  const workOrderCount = importWorkOrders(input.projects, input.workOrders);
  const evidence = await importEvidence(input.dataDirectory, input.projects, input.workOrders);
  const conversationMessages = await importConversations(input.dataDirectory, input.projects);
  const events = await importEvents(input.dataDirectory);

  for (const workOrder of input.workOrders.values()) {
    if (workOrder.status === 'executing') {
      recordRecoveryCheckpoint({
        workOrderId: workOrder.id,
        phase: 'startup_reconciliation',
        state: 'resumable',
        detail: {
          status: workOrder.status,
          updatedAt: workOrder.updatedAt,
          reason: 'Persisted executing Work Order requires deterministic resume or rollback decision.'
        }
      });
    }
  }

  const summary = {
    projects: input.projects.size,
    workOrders: workOrderCount,
    evidence,
    events,
    conversationMessages
  };
  setRuntimeMetadata('legacy_import', {
    completedAt: new Date().toISOString(),
    source: 'atomic_json_compatibility_layer',
    ...summary
  });
  return summary;
}

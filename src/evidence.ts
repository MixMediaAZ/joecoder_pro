import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SurveyResult } from './types.js';
import { atomicWriteFile } from './persistence.js';
import { insertEventRecord, upsertEvidenceRecord } from './database/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.JC_DATA_DIR ? path.resolve(process.env.JC_DATA_DIR) : path.join(ROOT, '.jc');
export const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence');
export const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
export const OVERVIEWS_DIR = path.join(DATA_DIR, 'overviews');
export const EXPORTS_DIR = path.join(DATA_DIR, 'exports');

let eventWriteQueue: Promise<unknown> = Promise.resolve();
// Cached chain tip so each append does not re-read the entire log. All writes
// serialize through eventWriteQueue, so the cache cannot race. `undefined`
// means "unknown — read the file"; it is reset on any failed append.
let cachedLastEventHash: string | null | undefined;

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function integrityPath(id: string): string {
  return path.join(EVIDENCE_DIR, `${id}.integrity`);
}

function validateEvidenceId(id: string): void {
  if (!/^EVC-[0-9]+-[a-f0-9]{8}$/.test(id)) throw new Error('INVALID_EVIDENCE_ID');
}

function workOrderIdFromPayload(payload: Record<string, unknown>): string | null {
  for (const key of ['workOrderId', 'woId']) {
    const value = payload[key];
    if (typeof value === 'string' && value.startsWith('JC')) return value;
  }
  return null;
}

export async function ensureEvidenceDirs(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.mkdir(OVERVIEWS_DIR, { recursive: true });
  await fs.mkdir(EXPORTS_DIR, { recursive: true });
  try {
    await fs.access(EVENTS_FILE);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await atomicWriteFile(EVENTS_FILE, '');
  }
}

async function lastEventHash(): Promise<string | null> {
  const raw = await fs.readFile(EVENTS_FILE, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  if (!lines.length) return null;
  const last = JSON.parse(lines.at(-1)!) as { hash?: string };
  return typeof last.hash === 'string' ? last.hash : null;
}

export async function recordEvent(type: string, payload: unknown): Promise<string> {
  const write = async () => {
    try {
      await ensureEvidenceDirs();
      const ts = Date.now();
      if (cachedLastEventHash === undefined) cachedLastEventHash = await lastEventHash();
      const previousHash = cachedLastEventHash;
      const payloadString = JSON.stringify(payload);
      const hash = contentHash(`${previousHash ?? 'GENESIS'}:${ts}:${type}:${payloadString}`);
      const line = `${JSON.stringify({ ts, type, payload, previousHash, hash })}\n`;
      const handle = await fs.open(EVENTS_FILE, 'a');
      try {
        await handle.write(line, undefined, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      cachedLastEventHash = hash;
      const payloadRecord = payload && typeof payload === 'object'
        ? payload as Record<string, unknown>
        : {};
      insertEventRecord({
        hash,
        previousHash,
        projectId: typeof payloadRecord.projectId === 'string' ? payloadRecord.projectId : null,
        workOrderId: workOrderIdFromPayload(payloadRecord),
        type,
        occurredAt: ts,
        payload,
        integrityState: 'verified_chain'
      });
      return hash;
    } catch (error) {
      // The append may have partially happened; re-read the true tip next time.
      cachedLastEventHash = undefined;
      throw error;
    }
  };
  const result = eventWriteQueue.then(write, write);
  eventWriteQueue = result.catch(() => {});
  return result;
}

export async function verifyEventLog(): Promise<{ valid: boolean; checked: number; legacy: number; error?: string }> {
  const lines = (await fs.readFile(EVENTS_FILE, 'utf8')).trim().split('\n').filter(Boolean);
  let previous: string | null = null;
  let checked = 0;
  let legacy = 0;
  for (const line of lines) {
    const event = JSON.parse(line) as {
      ts: number;
      type: string;
      payload: unknown;
      previousHash?: string | null;
      hash: string;
    };
    if (!Object.hasOwn(event, 'previousHash')) {
      legacy += 1;
      previous = event.hash;
      continue;
    }
    if (event.previousHash !== previous) {
      return { valid: false, checked, legacy, error: `EVENT_CHAIN_PREVIOUS_HASH_MISMATCH at event ${checked + legacy + 1}` };
    }
    const expected = contentHash(`${previous ?? 'GENESIS'}:${event.ts}:${event.type}:${JSON.stringify(event.payload)}`);
    if (event.hash !== expected) {
      return { valid: false, checked, legacy, error: `EVENT_CHAIN_CONTENT_HASH_MISMATCH at event ${checked + legacy + 1}` };
    }
    previous = event.hash;
    checked += 1;
  }
  return { valid: true, checked, legacy };
}

export async function createEvidenceEnvelope(workOrderId: string | null, content: unknown) {
  await ensureEvidenceDirs();
  const id = `EVC-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const contentString = `${JSON.stringify(content, null, 2)}\n`;
  const hash = contentHash(contentString);
  const filePath = path.join(EVIDENCE_DIR, `${id}.json`);
  await atomicWriteFile(filePath, contentString);
  await atomicWriteFile(integrityPath(id), `${hash}\n`);
  const contentRecord = content && typeof content === 'object'
    ? content as Record<string, unknown>
    : {};
  const createdAt = Date.now();
  upsertEvidenceRecord({
    id,
    projectId: typeof contentRecord.projectId === 'string' ? contentRecord.projectId : null,
    workOrderId,
    type: typeof contentRecord.type === 'string' ? contentRecord.type : 'unknown',
    filePath,
    contentHash: hash,
    integrityState: 'verified',
    payloadSizeBytes: Buffer.byteLength(contentString),
    createdAt,
    observedAt: createdAt
  });
  const envelope = {
    id,
    created_at: createdAt,
    work_order_id: workOrderId,
    content_hash: hash,
    path: filePath,
    integrity: 'verified'
  };
  await recordEvent('evidence.created', { evidenceId: id, hash, workOrderId });
  return envelope;
}

export async function inspectEvidenceById(id: string): Promise<{
  content: Record<string, unknown> | null;
  verified: boolean;
  reason: string;
}> {
  validateEvidenceId(id);
  try {
    const filePath = path.join(EVIDENCE_DIR, `${id}.json`);
    const contentString = await fs.readFile(filePath, 'utf8');
    const content = JSON.parse(contentString) as Record<string, unknown>;
    let expected: string;
    try {
      expected = (await fs.readFile(integrityPath(id), 'utf8')).trim();
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { content, verified: false, reason: 'legacy evidence has no integrity record' };
      }
      throw error;
    }
    const observed = contentHash(contentString);
    return expected === observed
      ? { content, verified: true, reason: 'content hash matches integrity record' }
      : { content: null, verified: false, reason: 'EVIDENCE_CONTENT_HASH_MISMATCH' };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { content: null, verified: false, reason: 'evidence not found' };
    }
    if (error instanceof SyntaxError) return { content: null, verified: false, reason: 'evidence JSON is malformed' };
    throw error;
  }
}

export async function getEvidenceById(id: string): Promise<any | null> {
  const inspected = await inspectEvidenceById(id);
  if (!inspected.content) return null;
  return { ...inspected.content, _integrity: { verified: inspected.verified, reason: inspected.reason } };
}

export async function getVerifiedEvidenceById(id: string): Promise<Record<string, any> | null> {
  const inspected = await inspectEvidenceById(id);
  return inspected.verified ? inspected.content : null;
}

export function buildSurveyMarkdown(data: SurveyResult & { type?: string; findings?: SurveyResult['findings'] }): string {
  const summary = data.summary || { totalFiles: 0, totalDirectories: 0, totalSizeBytes: 0, maxDepthReached: 0 };
  const pkg = data.packageSummary;
  const lines: string[] = [];
  lines.push(`# Survey Handoff — ${data.projectName || 'Unknown Project'}`, '');
  lines.push(`- **Generated:** ${data.generatedAt || 'n/a'}`);
  lines.push(`- **Path:** ${data.requestedPath || 'n/a'}`);
  lines.push(`- **Project Type:** ${data.projectType || 'unknown'}`);
  lines.push(`- **Status:** ${data.status || 'complete'}`);
  lines.push(`- **Build Condition:** ${data.buildCondition || 'unknown'}`, '');
  lines.push('## Summary');
  lines.push(`- Files: ${summary.totalFiles ?? 0}`);
  lines.push(`- Directories: ${summary.totalDirectories ?? 0}`);
  lines.push(`- Size (bytes): ${summary.totalSizeBytes ?? 0}`);
  lines.push(`- Max depth reached: ${summary.maxDepthReached ?? 0}`, '');
  if (pkg) {
    lines.push('## Package');
    lines.push(`- Name: ${pkg.name || 'n/a'}`);
    lines.push(`- Version: ${pkg.version || 'n/a'}`);
    lines.push(`- Dependencies: ${pkg.dependenciesCount ?? 0}`);
    lines.push(`- DevDependencies: ${pkg.devDependenciesCount ?? 0}`);
    if (pkg.scripts?.length) lines.push(`- Scripts: ${pkg.scripts.join(', ')}`);
    lines.push('');
  }
  if (data.keyFiles?.length) {
    lines.push('## Key Files', ...data.keyFiles.map((file) => `- ${file}`), '');
  }
  if (data.findings) {
    lines.push('## Findings');
    for (const [group, items] of Object.entries(data.findings)) {
      if (items.length) lines.push(`### ${group}`, ...items.map((item: string) => `- ${item}`));
    }
    lines.push('');
  }
  if (data.observations?.length) lines.push('## Observations', ...data.observations.map((item) => `- ${item}`), '');
  if (data.unknowns?.length) lines.push('## Unknowns', ...data.unknowns.map((item) => `- ${item}`), '');
  lines.push('## Evidence', 'This survey was recorded as evidence. Evidence ID is available from the API response.', '');
  return lines.join('\n');
}

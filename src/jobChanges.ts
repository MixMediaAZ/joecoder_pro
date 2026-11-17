import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSnapshotManifest, type AppliedChange } from './mutation.js';
import { ProjectFileAccessError, MAX_PREVIEW_BYTES } from './projectExplorer.js';
import { reviewablePath } from './projectChanges.js';
import { readOperatorFile, operatorEditorAvailable } from './operatorFiles.js';
import type { AgentJobRecord } from './database/database.js';
import type { WorkOrder } from './types.js';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const fail = (code: string, message: string): never => { throw new ProjectFileAccessError(code, 409, message); };

async function jobSnapshot(job: AgentJobRecord, workOrder: WorkOrder, projectRoot: string, snapshotsRoot: string) {
  if (job.workOrderId !== workOrder.id || !workOrder.execution?.snapshotId) return fail('JOB_SNAPSHOT_UNAVAILABLE', 'This job has no reviewable source snapshot.');
  const snapshotId = workOrder.execution.snapshotId;
  if (!/^SNAP-\d+-[a-f0-9]+$/.test(snapshotId)) return fail('JOB_SNAPSHOT_UNAVAILABLE', 'Invalid snapshot identity.');
  const directory = path.join(snapshotsRoot, snapshotId);
  const manifest = validateSnapshotManifest(JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')),
    { expectedSnapshotId: snapshotId, expectedProjectRoot: projectRoot });
  return { manifest, directory };
}
function changes(job: AgentJobRecord): AppliedChange[] {
  const applied = (job.result as { applied?: AppliedChange[] } | null)?.applied;
  return Array.isArray(applied) ? applied.filter(item => item && typeof item.relPath === 'string'
    && reviewablePath(item.relPath) && /^[a-f0-9]{64}$/.test(item.newHash)) : [];
}

export async function listJobChanges(job: AgentJobRecord, workOrder: WorkOrder, projectRoot: string, snapshotsRoot: string) {
  const { manifest } = await jobSnapshot(job, workOrder, projectRoot, snapshotsRoot);
  return { baseline: 'Before this job', files: changes(job).filter(item => manifest.files.some(record => record.relPath === item.relPath))
    .map(item => ({ path: item.relPath, action: item.action })), readOnly: true };
}

function unifiedDiff(relative: string, before: string, after: string) {
  if (before === after) return 'No text changes remain.';
  const left = before.split(/\r?\n/), right = after.split(/\r?\n/);
  let first = 0, suffix = 0;
  while (first < Math.min(left.length, right.length) && left[first] === right[first]) first++;
  while (suffix < Math.min(left.length, right.length) - first && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++;
  const start = Math.max(0, first - 3);
  const lastLeft = Math.min(left.length, left.length - suffix + 3);
  const lastRight = Math.min(right.length, right.length - suffix + 3);
  return ['--- before/' + relative, '+++ current/' + relative,
    '@@ -' + (start + 1) + ',' + (lastLeft - start) + ' +' + (start + 1) + ',' + (lastRight - start) + ' @@',
    ...left.slice(start, first).map(line => ' ' + line),
    ...left.slice(first, left.length - suffix).map(line => '-' + line),
    ...right.slice(first, right.length - suffix).map(line => '+' + line),
    ...right.slice(right.length - suffix, lastRight).map(line => ' ' + line)].join('\n');
}

export async function readJobChange(job: AgentJobRecord, workOrder: WorkOrder, projectRoot: string, snapshotsRoot: string, relative: string) {
  if (!reviewablePath(relative)) return fail('JOB_DIFF_PATH_BLOCKED', 'Choose a reviewable file changed by this job.');
  const change = changes(job).find(item => item.relPath === relative);
  if (!change) return fail('JOB_CHANGE_NOT_FOUND', 'This path was not recorded as changed by this job.');
  const { manifest, directory } = await jobSnapshot(job, workOrder, projectRoot, snapshotsRoot);
  const record = manifest.files.find(item => item.relPath === relative);
  if (!record) return fail('JOB_SNAPSHOT_UNAVAILABLE', 'The prior file was not recorded.');
  let before = '';
  if (record.existed) {
    if ((record.sizeBytes || 0) > MAX_PREVIEW_BYTES || !record.snapshotFile) return fail('JOB_DIFF_TOO_LARGE', 'This snapshot exceeds the review limit.');
    const bytes = await fs.readFile(path.join(directory, record.snapshotFile));
    if (hash(bytes) !== record.hash) return fail('JOB_SNAPSHOT_CHANGED', 'The saved snapshot failed its integrity check.');
    before = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  }
  const current = await readOperatorFile(projectRoot, relative);
  const currentBytes = current.lineEnding === 'crlf' ? current.content.replace(/\n/g, '\r\n') : current.content;
  const alreadyRestored = record.existed && current.sha256 === record.hash;
  const conflict = current.sha256 !== change.newHash && !alreadyRestored;
  const terminal = !['queued', 'running', 'interrupted'].includes(job.status);
  const canRestore = terminal && operatorEditorAvailable && record.existed && !conflict && !alreadyRestored;
  const reason = alreadyRestored ? 'The original file is already restored.'
    : conflict ? 'The file changed after this job. Review the current version; restore is blocked.'
    : !record.existed ? 'This job created the file. Removing new files is not supported by the locked restore action.'
    : !terminal ? 'Finish or stop the job before restoring.'
    : !operatorEditorAvailable ? 'Locked restore is available on Windows.' : '';
  const diff = unifiedDiff(relative, before, currentBytes);
  return { path: relative, baseline: 'Before this job', diff: diff.slice(0, 128_000), truncated: diff.length > 128_000,
    currentSha256: current.sha256, jobSha256: change.newHash, canRestore, reason,
    restore: { content: before.replace(/\r\n/g, '\n'), lineEnding: before.includes('\r\n') ? 'crlf' as const : 'lf' as const } };
}

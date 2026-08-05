import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

interface LockRecord {
  pid: number;
  nonce: string;
  startedAt: string;
}

let owned: { path: string; nonce: string } | null = null;

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function acquireInstanceLock(dataDirectory: string): Promise<void> {
  await fs.mkdir(dataDirectory, { recursive: true });
  const lockPath = path.join(dataDirectory, 'server.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const nonce = randomBytes(16).toString('hex');
    try {
      const handle = await fs.open(lockPath, 'wx');
      const record: LockRecord = { pid: process.pid, nonce, startedAt: new Date().toISOString() };
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      owned = { path: lockPath, nonce };
      return;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let existing: Partial<LockRecord> = {};
      try {
        existing = JSON.parse(await fs.readFile(lockPath, 'utf8')) as Partial<LockRecord>;
      } catch {}
      if (typeof existing.pid === 'number' && processIsAlive(existing.pid)) {
        throw new Error(`JOECODER_ALREADY_RUNNING: process ${existing.pid} owns this project data store`);
      }
      await fs.unlink(lockPath).catch((unlinkError: NodeJS.ErrnoException) => {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      });
    }
  }
  throw new Error('JOECODER_INSTANCE_LOCK_FAILED');
}

export async function releaseInstanceLock(): Promise<void> {
  const current = owned;
  owned = null;
  if (!current) return;
  try {
    const record = JSON.parse(await fs.readFile(current.path, 'utf8')) as Partial<LockRecord>;
    if (record.nonce !== current.nonce || record.pid !== process.pid) return;
    await fs.unlink(current.path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

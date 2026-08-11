import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
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

async function readLockRecord(filePath: string): Promise<Partial<LockRecord> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<LockRecord>;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

async function acquireRecoveryGate(lockPath: string): Promise<() => Promise<void>> {
  const gatePath = `${lockPath}.recovery`;
  const nonce = randomBytes(16).toString('hex');
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(gatePath, 'wx');
    const record: LockRecord = { pid: process.pid, nonce, startedAt: new Date().toISOString() };
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.sync();
  } catch (error: unknown) {
    await handle?.close().catch(() => {});
    handle = undefined;
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const existing = await readLockRecord(gatePath);
      if (typeof existing?.pid === 'number' && processIsAlive(existing.pid)) {
        throw new Error(`JOECODER_LOCK_RECOVERY_IN_PROGRESS: process ${existing.pid} is acquiring the data-store lock`);
      }
      throw new Error(
        `JOECODER_STALE_RECOVERY_GATE: ${gatePath} belongs to a stopped process; inspect and remove it before restarting`
      );
    }
    await fs.unlink(gatePath).catch(() => {});
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }

  return async () => {
    try {
      const record = await readLockRecord(gatePath);
      if (record?.nonce === nonce && record.pid === process.pid) await fs.unlink(gatePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };
}

export async function acquireInstanceLock(dataDirectory: string): Promise<void> {
  await fs.mkdir(dataDirectory, { recursive: true });
  const lockPath = path.join(dataDirectory, 'server.lock');
  const releaseGate = await acquireRecoveryGate(lockPath);
  try {
    const existing = await readLockRecord(lockPath);
    const nonce = randomBytes(16).toString('hex');
    if (typeof existing?.pid === 'number' && processIsAlive(existing.pid)) {
      throw new Error(`JOECODER_ALREADY_RUNNING: process ${existing.pid} owns this project data store`);
    }
    if (existing !== null) {
      await fs.unlink(lockPath).catch((unlinkError: NodeJS.ErrnoException) => {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      });
    }
    let handle: FileHandle;
    try {
      handle = await fs.open(lockPath, 'wx');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const winner = await readLockRecord(lockPath);
        if (typeof winner?.pid === 'number' && processIsAlive(winner.pid)) {
          throw new Error(`JOECODER_ALREADY_RUNNING: process ${winner.pid} owns this project data store`);
        }
        throw new Error('JOECODER_INSTANCE_LOCK_FAILED');
      }
      throw error;
    }
    const record: LockRecord = { pid: process.pid, nonce, startedAt: new Date().toISOString() };
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => {});
      await fs.unlink(lockPath).catch(() => {});
      throw error;
    }
    await handle.close();
    owned = { path: lockPath, nonce };
  } finally {
    await releaseGate();
  }
}

export async function releaseInstanceLock(): Promise<void> {
  const current = owned;
  owned = null;
  if (!current) return;
  try {
    const record = await readLockRecord(current.path);
    if (record?.nonce !== current.nonce || record.pid !== process.pid) return;
    await fs.unlink(current.path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

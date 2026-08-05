import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  backupDatabase,
  closeDatabase,
  databaseCounts,
  getDatabaseStatus,
  initializeDatabase,
  verifyDatabase
} from './database/database.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(root, '.jc');
const command = process.argv[2] ?? 'verify';

try {
  await initializeDatabase(dataDirectory);
  if (command === 'verify') {
    const verification = verifyDatabase();
    console.log(JSON.stringify({
      ok: verification.ok,
      status: getDatabaseStatus(),
      verification,
      counts: databaseCounts()
    }, null, 2));
    if (!verification.ok) process.exitCode = 1;
  } else if (command === 'backup') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(dataDirectory, 'backups', `joecoder-${timestamp}.sqlite3`);
    const backup = await backupDatabase(destination);
    console.log(JSON.stringify({ ok: true, backup }, null, 2));
  } else {
    throw new Error(`Unknown database command '${command}'. Use verify or backup.`);
  }
} finally {
  closeDatabase();
}

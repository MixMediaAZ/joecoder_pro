import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { validateHostAndOrigin } from './sessionSecurity.js';

function runIsolatedEvidenceCheck(dataDir: string): Promise<Record<string, unknown>> {
  const script = `
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const database = await import('./dist/database/database.js');
    const evidence = await import('./dist/evidence.js');
    await database.initializeDatabase(process.env.JC_DATA_DIR);
    await evidence.ensureEvidenceDirs();
    await evidence.recordEvent('kernel.first', { value: 1 });
    await evidence.recordEvent('kernel.second', { value: 2 });
    const before = await evidence.verifyEventLog();
    const file = path.join(process.env.JC_DATA_DIR, 'events.jsonl');
    const rows = (await fs.readFile(file, 'utf8')).trim().split('\\n');
    const first = JSON.parse(rows[0]);
    first.payload.value = 99;
    rows[0] = JSON.stringify(first);
    await fs.writeFile(file, rows.join('\\n') + '\\n');
    const after = await evidence.verifyEventLog();
    database.closeDatabase();
    process.stdout.write(JSON.stringify({ before, after }));
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      env: { ...process.env, JC_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `evidence child exited ${code}`));
      resolve(JSON.parse(stdout) as Record<string, unknown>);
    });
  });
}

test('certified evidence chain accepts intact events and rejects tampering', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jc-kernel-evidence-'));
  try {
    const result = await runIsolatedEvidenceCheck(root) as {
      before: { valid: boolean; checked: number };
      after: { valid: boolean; error?: string };
    };
    assert.equal(result.before.valid, true);
    assert.equal(result.before.checked, 2);
    assert.equal(result.after.valid, false);
    assert.match(result.after.error || '', /mismatch|invalid/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('certified request boundary rejects hostile host and origin before consequential work', () => {
  const badHost = {
    get: (name: string) => name.toLowerCase() === 'host' ? 'attacker.example' : undefined,
    headers: {},
    protocol: 'http',
    socket: { localPort: 5000 }
  };
  assert.match(validateHostAndOrigin(badHost as never, true) || '', /host/i);

  const badOrigin = {
    get: (name: string) => {
      if (name.toLowerCase() === 'host') return '127.0.0.1:5000';
      if (name.toLowerCase() === 'origin') return 'https://attacker.example';
      return undefined;
    },
    headers: { origin: 'https://attacker.example' },
    protocol: 'http',
    socket: { localPort: 5000 }
  };
  assert.match(validateHostAndOrigin(badOrigin as never, true) || '', /origin/i);
});

test('server composition retains every mandatory safety-kernel dependency', async () => {
  const sources = await Promise.all([
    readFile(path.join(process.cwd(), 'src', 'index.ts'), 'utf8'),
    readFile(path.join(process.cwd(), 'src', 'repair.ts'), 'utf8')
  ]);
  const source = sources.join('\\n');
  const requiredMarkers = [
    'verifyAuthorizationEnvelope',
    'resolveJailedPath',
    'snapshotScopedFiles',
    'applyEdits',
    'runVerification',
    'rollbackToSnapshot',
    'recordEvent',
    'validateHostAndOrigin',
    'SESSION_COOKIE',
    'acquireInstanceLock'
  ];
  for (const marker of requiredMarkers) {
    assert.ok(source.includes(marker), `runtime composition lost ${marker}`);
  }
});


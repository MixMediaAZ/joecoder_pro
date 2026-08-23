import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(root, '.jc');
const runtimeFile = path.join(dataDirectory, 'server-runtime.json');
const launcherLog = path.join(dataDirectory, 'launcher-stdout.log');
const MAX_LAUNCHER_LOG_SCAN_BYTES = 256 * 1024;

async function readRuntimeState() {
  try {
    const state = JSON.parse(await fs.readFile(runtimeFile, 'utf8'));
    return typeof state?.baseUrl === 'string' ? state : null;
  } catch {
    return null;
  }
}

async function readLastLoggedUrl() {
  let handle;
  try {
    handle = await fs.open(launcherLog, 'r');
    const stat = await handle.stat();
    const length = Math.min(stat.size, MAX_LAUNCHER_LOG_SCAN_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
    const log = buffer.toString('utf8');
    const matches = [...log.matchAll(/listening on (http:\/\/127\.0\.0\.1:\d+)/g)];
    return matches.at(-1)?.[1] || null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function isHealthy(baseUrl) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl || '')) return false;
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1200) });
    const body = await response.json();
    return response.ok && body?.status === 'ok' && String(body?.version || '').startsWith('20.');
  } catch {
    return false;
  }
}

async function freshBootstrapUrl(state) {
  if (!state?.launcherSecret || typeof state.launcherSecret !== 'string') return null;
  try {
    const response = await fetch(`${state.baseUrl}/api/v1/launcher/bootstrap`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-jc-launcher-secret': state.launcherSecret
      },
      body: '{}',
      signal: AbortSignal.timeout(1500)
    });
    const body = await response.json();
    const expectedPrefix = `${state.baseUrl}/bootstrap.html#token=`;
    return response.ok && typeof body?.bootstrapUrl === 'string' && body.bootstrapUrl.startsWith(expectedPrefix)
      ? body.bootstrapUrl
      : null;
  } catch {
    return null;
  }
}

function openUrl(url) {
  if (!process.argv.includes('--open') || process.env.JC_NO_OPEN === '1') return;
  if (process.platform === 'win32') {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.on('error', () => {});
    child.unref();
  }
}

const runtimeState = await readRuntimeState();
const loggedUrl = await readLastLoggedUrl();
const candidates = [...new Map([
  loggedUrl ? [loggedUrl, { baseUrl: loggedUrl }] : null,
  runtimeState ? [runtimeState.baseUrl, runtimeState] : null
].filter(Boolean)).values()];

for (const state of candidates) {
  if (!(await isHealthy(state.baseUrl))) continue;
  console.log('[INFO] JoeCoder is already running.');
  if (process.argv.includes('--open')) {
    const bootstrapUrl = await freshBootstrapUrl(state);
    if (!bootstrapUrl) {
      console.log('[ERROR] The running server could not create a fresh browser session.');
      console.log('[INFO] Stop that older JoeCoder process, then run start.bat again.');
      process.exitCode = 21;
      break;
    }
    console.log(`[INFO] Opening a fresh JoeCoder session: ${bootstrapUrl}`);
    openUrl(bootstrapUrl);
  } else {
    console.log(`[INFO] Open ${state.baseUrl}/app.html`);
  }
  console.log('[SUCCESS] Reused the active server; no duplicate was started.');
  process.exitCode = 20;
  break;
}

if (process.exitCode !== 20 && process.exitCode !== 21) {
  await fs.rm(runtimeFile, { force: true }).catch(() => {});
}
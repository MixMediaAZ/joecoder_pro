// Print a fresh bootstrap URL for the running JoeCoder service.
//
// Bootstrap tokens live for 60 seconds (BOOTSTRAP_TTL_MS), which is fine when start.bat opens
// the browser itself but useless when a URL is handed to a person. Run this the moment you are
// ready to click, and it mints a new one against the already-running service.
//
//   node tools/fresh-session.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimePath = path.join(root, '.jc', 'server-runtime.json');

let runtime;
try {
  runtime = JSON.parse(await fs.readFile(runtimePath, 'utf8'));
} catch {
  console.error('No running JoeCoder service found (.jc/server-runtime.json is absent).');
  console.error('Start one first with:  npm start');
  process.exit(1);
}

const health = await fetch(`${runtime.baseUrl}/health`).catch(() => null);
if (!health || !health.ok) {
  console.error(`Service recorded at ${runtime.baseUrl} (pid ${runtime.pid}) is not responding.`);
  console.error('It may have exited. Start a new one with:  npm start');
  process.exit(1);
}

const response = await fetch(`${runtime.baseUrl}/api/v1/launcher/bootstrap`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-jc-launcher-secret': runtime.launcherSecret,
    Origin: runtime.baseUrl
  },
  body: '{}'
});

if (!response.ok) {
  console.error(`Bootstrap reissue failed: ${response.status} ${await response.text()}`);
  process.exit(1);
}

const { bootstrapUrl, expiresIn } = await response.json();
const model = await health.json().then(d => d.model?.localModel ?? 'unknown').catch(() => 'unknown');

console.log('');
console.log(bootstrapUrl);
console.log('');
console.log(`Valid for ${expiresIn}s · model ${model} · pid ${runtime.pid} · port ${runtime.port}`);
console.log('Open it now. If it expires, just run this again.');

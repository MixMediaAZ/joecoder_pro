import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const server = fs.readFileSync('src/index.ts', 'utf8');
const ui = fs.readFileSync('public/app.js', 'utf8');
const verifier = fs.readFileSync('tools/certify-clean-release.mjs', 'utf8');

test('qualified shutdown is authenticated, explicit, and reaches the graceful close handler', () => {
  const sessionBoundary = server.indexOf("app.use('/api/v1', requireSession)");
  const route = server.indexOf("app.post('/api/v1/system/shutdown'");
  assert.ok(route > sessionBoundary, 'shutdown is behind session and consequential-request middleware');
  assert.match(server, /z\.literal\('shutdown'\)/);
  assert.match(server, /SHUTDOWN_CONFIRMATION_REQUIRED/);
  assert.match(server, /process\.emit\('SIGTERM'\)/);
  assert.match(server, /server\.close\(async \(\) =>/);
  assert.match(server, /clearOwnedRuntimeState/);
  assert.match(server, /closeDatabase\(\)/);
  assert.match(server, /releaseInstanceLock/);
});

test('normal browser UI cannot accidentally invoke process shutdown', () => {
  assert.equal(ui.includes('/api/v1/system/shutdown'), false);
  assert.match(verifier, /client\.post\('\/api\/v1\/system\/shutdown', \{ confirm: 'shutdown' \}\)/);
});

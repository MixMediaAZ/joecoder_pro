import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('every supported launcher builds current source before starting', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  const launcher = fs.readFileSync('start.bat', 'utf8');

  assert.equal(pkg.scripts.prestart, 'npm run build');
  assert.match(launcher, /call npm run build/);
  assert.doesNotMatch(launcher, /if not exist "dist"/);
  assert.match(launcher, /will not start stale output/i);
  assert.match(launcher, /node tools\\check-running\.mjs --open/);
  assert.ok(
    launcher.indexOf('node tools\\check-running.mjs --open') < launcher.indexOf('call npm run build'),
    'a healthy existing instance is detected before rebuilding or opening shared state'
  );
  assert.doesNotMatch(launcher, /2>>\s*"\.jc\\server-stderr\.log"/);
  assert.match(launcher, /JoeCoder Pro 20\.1/);
  assert.match(launcher, /ready in the existing browser session/i);
  assert.doesNotMatch(launcher, /[^\x00-\x7F]/, 'Windows launcher remains ASCII-safe');
});

test('an existing server mints a fresh one-time browser session for the local launcher', () => {
  const server = fs.readFileSync('src/index.ts', 'utf8');
  const helper = fs.readFileSync('tools/check-running.mjs', 'utf8');

  assert.match(server, /const LAUNCHER_SECRET = opaqueToken\(\)/);
  assert.match(server, /app\.post\('\/api\/v1\/launcher\/bootstrap'/);
  assert.match(server, /constantTimeEqual\(providedSecret, LAUNCHER_SECRET\)/);
  assert.match(server, /generateBootstrapToken\(\)/);
  assert.match(server, /Cache-Control', 'no-store/);
  assert.match(server, /spawn\('rundll32\.exe'/);
  assert.doesNotMatch(server, /exec\(start/);
  assert.match(helper, /x-jc-launcher-secret/);
  assert.match(helper, /freshBootstrapUrl\(state\)/);
  assert.match(helper, /bootstrap\.html#token=/);
  assert.doesNotMatch(helper, /openUrl\(\$\{state\.baseUrl\}\/app\.html/);
  assert.match(helper, /running server could not create a fresh browser session/i);
});

test('live workflow verification is read-only for persisted projects', () => {
  const verifier = fs.readFileSync('tools/verify-live-workflow.mjs', 'utf8');

  assert.doesNotMatch(verifier, /firstAccept|repeatAccept|directComplete/);
  assert.equal(verifier.match(/method:\s*'POST'/g)?.length, 1, 'only the one-time session exchange may use POST');
  assert.match(verifier, /mode: 'read-only-live-verification'/);
  assert.match(verifier, /No project acceptance, chat message, Work Order transition/);
});

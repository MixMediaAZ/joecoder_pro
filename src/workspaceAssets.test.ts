import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import path from 'node:path';
import { workspaceAssets } from './workspaceAssets.js';

test('exported workspace serves with exact hydration hashes and no arbitrary inline scripts', async () => {
  const app = express();
  app.use('/workspace', await workspaceAssets(path.resolve('frontend/out')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/workspace/`);
    assert.equal(response.status, 200, 'Build the frontend before testing shipped assets.');
    const html = await response.text();
    const csp = response.headers.get('content-security-policy') || '';
    const scripts = csp.split(';').find(value => value.trim().startsWith('script-src')) || '';
    assert.ok(!scripts.includes("'unsafe-inline'"));
    assert.ok(!scripts.includes("'unsafe-eval'"));
    let checked = 0;
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc\s*=/.test(match[1] || '') && match[2]) {
        assert.ok(scripts.includes(createHash('sha256').update(match[2]).digest('base64')));
        checked++;
      }
    }
    assert.ok(checked > 0);
    assert.ok(html.includes('/workspace/_next/'));
    assert.ok(!html.includes('fonts.googleapis.com'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

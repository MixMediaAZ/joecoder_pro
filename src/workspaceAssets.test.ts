import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
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

test('a rebuilt workspace gets matching per-page hashes without restarting the server', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-workspace-assets-'));
  const first = 'self.__next_f.push([1,"first build"])';
  const second = 'self.__next_f.push([1,"rebuilt workspace"])';
  const hash = (script: string) => createHash('sha256').update(script).digest('base64');
  const page = (script: string) => `<html><body><script>${script}</script></body></html>`;
  await fs.writeFile(path.join(root, 'index.html'), page(first));
  const app = express();
  app.use('/workspace', await workspaceAssets(root));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/workspace/`;
    const original = await fetch(url);
    assert.ok(original.headers.get('content-security-policy')?.includes(hash(first)));
    assert.equal(await original.text(), page(first));
    await fs.writeFile(path.join(root, 'index.html'), page(second));
    const rebuilt = await fetch(url);
    assert.equal(await rebuilt.text(), page(second));
    assert.equal(rebuilt.headers.get('cache-control'), 'no-store');
    const csp = rebuilt.headers.get('content-security-policy') || '';
    assert.ok(csp.includes(hash(second)));
    assert.ok(!csp.includes(hash(first)));
    const scripts = csp.split(';').find(value => value.trim().startsWith('script-src')) || '';
    assert.ok(!scripts.includes("'unsafe-inline'"));
    assert.ok(!scripts.includes("'unsafe-eval'"));
    const head = await fetch(url + 'index.html', { method: 'HEAD' });
    assert.equal(head.headers.get('content-security-policy'), csp);
    assert.equal(await head.text(), '');
    const traversal = await fetch(url + '..%5coutside.html');
    if (path.sep === '\\') assert.equal(traversal.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

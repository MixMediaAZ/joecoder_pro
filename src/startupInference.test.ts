import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectProcessEnvironment } from './processPolicy.js';
import { terminateOwnedProcess } from './boundedProcess.js';

test('starting the real service and reading health does not load or generate with a model', { timeout: 25000 }, async () => {
  const requests: string[] = [];
  const provider = createServer((request, response) => {
    requests.push(request.url || '');
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') response.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:14b' }] }));
    else if (request.url === '/api/show') response.end(JSON.stringify({ capabilities: ['completion'] }));
    else if (request.url === '/health') { response.statusCode = 503; response.end('{"ok":false,"ready":false}'); }
    else response.end('{"done":true,"response":"test endpoint"}');
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  assert.ok(address && typeof address === 'object');
  const providerUrl = 'http://127.0.0.1:' + address.port;
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-startup-inference-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url))], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: projectProcessEnvironment({ JC_PORT: '0', JC_HOST: '127.0.0.1', JC_NO_OPEN: '1', JC_MOCK_MODEL: '0', JC_DATA_DIR: data,
      JC_OLLAMA_URL: providerUrl, JC_OLLAMA_MODEL: 'qwen2.5-coder:14b', JC_POWERROUTER_URL: providerUrl, JC_POWERROUTER_KEY: 'isolated-startup-test' })
  });
  let output = '', launchError: Error | undefined;
  child.once('error', error => { launchError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes).slice(-64000); });
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  try {
    const deadline = Date.now() + 15000;
    let match: RegExpMatchArray | null = null;
    while (!(match = output.match(/(http:\/\/127\.0\.0\.1:\d+)\/bootstrap\.html#token=/))) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || Date.now() > deadline) throw Error('Test service did not start: ' + output);
      await sleep(50);
    }
    const response = await fetch(match[1] + '/health', { signal: AbortSignal.timeout(5000) });
    const health = await response.json() as { status: string; model: { localModel: string; mockModel: boolean } };
    assert.equal(response.status, 200);
    assert.equal(health.status, 'ok');
    assert.equal(health.model.localModel, 'qwen2.5-coder:14b');
    assert.equal(health.model.mockModel, false);
    await sleep(500);
    assert.ok(requests.includes('/api/tags'), 'a real model inventory was available');
    assert.deepEqual(requests.filter(url => /\/api\/(?:generate|chat)/.test(url)), [], 'opening the app must not initiate inference');
  } finally {
    await terminateOwnedProcess(child);
    provider.closeAllConnections();
    await new Promise<void>(resolve => provider.close(() => resolve()));
  }
});

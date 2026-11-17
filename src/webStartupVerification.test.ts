import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyWebStartup } from './webStartupVerification.js';
import { runVerification } from './verification.js';
import { performSurvey } from './survey.js';
import { selectRequiredApiRouteContracts } from './apiRouteContracts.js';

for (const scenario of ['working', 'missing-asset', 'wrong-html-type'] as const) {
  test(`independent startup verification: ${scenario}`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-web-verification-test-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node server.cjs' } }));
    await fs.writeFile(path.join(root, 'server.cjs'), `
const http = require('node:http');
const server = http.createServer((req,res) => {
  if(req.url === '/') {
    res.setHeader('Content-Type', ${JSON.stringify(scenario === 'wrong-html-type' ? 'application/json' : 'text/html')});
    res.end('<!doctype html><html><script src="/app.js"></script></html>');
  } else {
    res.statusCode = ${scenario === 'missing-asset' ? 404 : 200};
    res.setHeader('Content-Type','text/javascript'); res.end('window.loaded = true;');
  }
});
server.listen(Number(process.env.PORT), process.env.HOST, () => console.log('http://127.0.0.1:' + server.address().port));
`);
    const result = await verifyWebStartup(root, 10000);
    assert.equal(result.passed, scenario === 'working', result.outputTail.join('\n'));
    if (scenario === 'missing-asset') assert.match(result.outputTail.join('\n'), /app\.js returned 404/);
    if (scenario === 'wrong-html-type') assert.match(result.outputTail.join('\n'), /WEB_HTML_REQUIRED/);
    const url = result.outputTail.join('\n').match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url);
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
  });
}

test('ordinary root Node API uses its real start script and sealed JSON route', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-api-layout-test-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node server.cjs', build: 'node --check server.cjs' } }));
  await fs.writeFile(path.join(root, 'server.cjs'), `const server=require('node:http').createServer((req,res)=>{
    res.writeHead(req.url==='/api/items'?200:404,{'Content-Type':'application/json'});res.end('[]');
  });server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));`);
  await fs.mkdir(path.join(root, 'public'));
  await fs.writeFile(path.join(root, 'public', 'app.js'), "fetch('/api/items');");
  const survey = await performSurvey(root, 5, 200);
  assert.ok(survey.requiredApiRoutes?.includes('/api/items'));
  assert.ok(!JSON.stringify(survey.findings.broken).includes('Runnable server entry is missing'));
  assert.deepEqual(selectRequiredApiRouteContracts('Preserve data after restart', ['/api/items']), ['/api/items']);
  const passed = await runVerification(root, { apiRouteContracts: ['/api/items'], timeoutMs: 10000 });
  assert.equal(passed.status, 'passed', JSON.stringify(passed));
  assert.ok(passed.items.some(item => item.command === 'api-route-smoke' && item.passed));
  const failed = await runVerification(root, { apiRouteContracts: ['/api/absent'], timeoutMs: 10000 });
  assert.equal(failed.status, 'failed');
  assert.match(JSON.stringify(failed), /returned 404/);
});

for (const workingDirectory of [true, false]) test(`Windows launcher from another folder: cwd fixed=${workingDirectory}`, { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc launcher test '));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node server.cjs' } }));
  await fs.writeFile(path.join(root, 'server.cjs'), `const server=require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html>Ready</html>');});server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));`);
  await fs.writeFile(path.join(root, 'start.bat'), '@echo off\r\n' + (workingDirectory ? 'cd /d "%~dp0"\r\n' : '') + 'node server.cjs\r\n');
  const result = await verifyWebStartup(root, 10000, { windowsLauncher: true });
  assert.equal(result.passed, workingDirectory, result.outputTail.join('\n'));
  if (!workingDirectory) assert.match(result.outputTail.join('\n'), /Cannot find module/);
});

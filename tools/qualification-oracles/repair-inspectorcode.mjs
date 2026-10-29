#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_CRITERIA_SHA256 = '8bb6d5d0f8f882ae2957701571741489497bcd970349325ea8cee33c716c1369';
const oracleDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(oracleDir, '..', '..');
const criteriaPath = path.join(repositoryRoot, '.jc', 'certification', 'SEALED-CRITERIA-realproject-repair-inspectorcode.json');

function argument(name, required = false) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

const target = path.resolve(argument('--target', true));
const outputArg = argument('--output');
const output = outputArg ? path.resolve(outputArg) : null;
const criteriaBytes = await fs.readFile(criteriaPath);
const criteriaSha256 = createHash('sha256').update(criteriaBytes).digest('hex');
if (criteriaSha256 !== EXPECTED_CRITERIA_SHA256) throw new Error('sealed criteria hash mismatch');

const results = {};
const runId = randomUUID();
const dataDir = path.join(target, '.oracle-data', runId);
const escapeName = `inspectorcode-oracle-escape-${runId}.js`;
let child;
let logs = '';
let port;
let base;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const is4xx = status => status >= 400 && status < 500;
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject));
  const selected = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return selected;
}

async function request(route, options = {}) {
  const response = await fetch(base + route, options);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: response.status, headers: response.headers, text, body };
}

async function json(method, route, body) {
  return request(route, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function start() {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  await fs.mkdir(dataDir, { recursive: true });
  child = spawn(process.execPath, ['dist/index.js'], {
    cwd: target,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      INSPECTORCODE_DATA_DIR: dataDir,
      JC_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = chunk => { logs = (logs + chunk.toString()).slice(-12_000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${logs}`);
    try {
      const health = await request('/api/health');
      if (health.status < 500) return;
    } catch {}
    await sleep(125);
  }
  throw new Error(`server startup timeout: ${logs}`);
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 3_000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(50);
  if (child.exitCode === null) child.kill('SIGKILL');
}

// Creates a standards-compliant, uncompressed ZIP without relying on the candidate's code.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name.replaceAll('\\', '/'));
    const bytes = Buffer.from(content);
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + bytes.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function uploadZip(bytes, name) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/zip' }), `${name}.zip`);
  form.append('name', name);
  return request('/api/projects/upload', { method: 'POST', headers: { accept: 'application/json' }, body: form });
}

function projectId(body) {
  if (!body || typeof body !== 'object') return null;
  for (const key of ['projectId', 'id']) if (typeof body[key] === 'string' || typeof body[key] === 'number') return body[key];
  for (const value of Object.values(body)) {
    const found = projectId(value);
    if (found !== null) return found;
  }
  return null;
}

async function filesBelow(root) {
  const found = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink written under data directory: ${candidate}`);
      if (entry.isDirectory()) await walk(candidate);
      else found.push(candidate);
    }
  }
  await walk(root);
  return found;
}

function meaningfulAnalysis(body) {
  const serialized = JSON.stringify(body ?? {}).toLowerCase();
  const placeholder = /placeholder|mock analysis|sample result|simulated/.test(serialized);
  const seededFinding = /oracle-seeded-eval|\beval\b|dynamic code execution/.test(serialized);
  let fileCount = 0;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(filecount|totalfiles|filesanalyzed|analyzedfiles)$/i.test(key) && Number.isFinite(Number(child))) fileCount = Math.max(fileCount, Number(child));
      if (/files/i.test(key) && Array.isArray(child)) fileCount = Math.max(fileCount, child.length);
      visit(child);
    }
  }
  visit(body);
  return { passed: !placeholder && seededFinding && fileCount >= 3, fileCount, seededFinding, placeholder };
}

async function waitForAnalysis(id) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    last = await request(`/api/analysis/${encodeURIComponent(id)}`);
    if (last.status === 200 && meaningfulAnalysis(last.body).passed) return last;
    if (is4xx(last.status)) return last;
    await sleep(250);
  }
  return last;
}

function browserExecutable() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return candidates;
}

async function browserCheck() {
  let executable;
  for (const candidate of browserExecutable()) {
    if (candidate && await fs.access(candidate).then(() => true).catch(() => false)) { executable = candidate; break; }
  }
  if (!executable) throw new Error('Chrome or Edge is required for the independent UI check');
  const cdpPort = await freePort();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'inspectorcode-oracle-browser-'));
  const browser = spawn(executable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let version;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try { version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json(); break; } catch { await sleep(100); }
    }
    if (!version) throw new Error('headless browser startup timeout');
    const created = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(base + '/')}`, { method: 'PUT' })).json();
    const socket = new WebSocket(created.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let sequence = 0;
    const pending = new Map();
    const fatal = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
      if (message.method === 'Runtime.exceptionThrown') fatal.push(message.params?.exceptionDetails?.text || 'runtime exception');
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') fatal.push('console.error');
    });
    const command = (method, params = {}) => new Promise(resolve => {
      const id = ++sequence;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
    await command('Runtime.enable');
    await command('Page.enable');
    await sleep(2_000);
    const evaluation = await command('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
    const bodyText = evaluation.result?.result?.value || '';
    socket.close();

    const root = await request('/');
    const scripts = [...root.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(match => match[1]);
    const assets = await Promise.all(scripts.map(source => request(new URL(source, base).pathname)));
    const bundle = assets.map(asset => asset.text).join('\n');
    const states = {
      upload: /upload/i.test(bodyText + bundle),
      progress: /progress|analyzing/i.test(bundle),
      results: /analysis results|results/i.test(bundle),
      error: /upload failed|analysis failed|error/i.test(bundle),
    };
    return { passed: /inspectorcode|upload/i.test(bodyText) && fatal.length === 0 && Object.values(states).every(Boolean), fatal, states };
  } finally {
    if (browser.exitCode === null) {
      browser.kill('SIGKILL');
      const killDeadline = Date.now() + 3_000;
      while (browser.exitCode === null && Date.now() < killDeadline) await sleep(50);
    }
    // Windows keeps Chromium profile locks briefly after SIGKILL; retry cleanup.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await fs.rm(profile, { recursive: true, force: true });
        break;
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        if (code !== 'EBUSY' && code !== 'EPERM') throw error;
        await sleep(200);
      }
    }
  }
}

try {
  await start();
  results.R1 = { passed: child.exitCode === null, detail: `production server started on oracle-selected loopback port ${port}` };

  const health = await request('/api/health');
  const healthy = health.body && typeof health.body === 'object' && /^(ok|healthy|up|ready)$/i.test(String(health.body.status ?? health.body.health ?? ''));
  results.R2 = { passed: health.status === 200 && healthy, detail: `status=${health.status}; machineHealthy=${Boolean(healthy)}` };

  const fixtureZip = zip({
    'src/index.js': `const userInput = 'oracle'; eval(userInput); // oracle-seeded-eval\n`,
    'src/math.js': 'export const add = (a, b) => a + b;\n',
    'README.md': '# Oracle multi-file project\n',
  });
  const firstUpload = await uploadZip(fixtureZip, `oracle-${runId}`);
  const secondUpload = await uploadZip(fixtureZip, `oracle-second-${runId}`);
  const firstId = projectId(firstUpload.body);
  const secondId = projectId(secondUpload.body);
  const storedFiles = await filesBelow(dataDir);
  const realDataRoot = await fs.realpath(dataDir);
  const pathsSafe = storedFiles.length >= 3 && (await Promise.all(storedFiles.map(file => fs.realpath(file)))).every(file => inside(realDataRoot, file));
  results.R3 = {
    passed: firstUpload.status >= 200 && firstUpload.status < 300 && firstId !== null && secondId !== null && String(firstId) !== String(secondId) && pathsSafe,
    detail: `uploads=${firstUpload.status}/${secondUpload.status}; unique=${String(firstId) !== String(secondId)}; storedFiles=${storedFiles.length}; pathsSafe=${pathsSafe}`,
  };

  const saved = await json('POST', `/api/projects/save/${encodeURIComponent(firstId ?? '')}`, {
    name: `Oracle project ${runId}`,
    description: 'Independent persistence probe',
  });

  const started = await json('POST', `/api/analysis/start/${encodeURIComponent(firstId ?? '')}`, { options: { depth: 'deep' }, testingInstructions: 'Inspect the real uploaded files.' });
  const completed = await waitForAnalysis(firstId);
  const analysis = meaningfulAnalysis(completed?.body);
  results.R4 = { passed: started.status >= 200 && started.status < 300 && completed?.status === 200 && analysis.passed, detail: `start=${started.status}; get=${completed?.status}; files=${analysis.fileCount}; seededFinding=${analysis.seededFinding}; placeholder=${analysis.placeholder}` };

  const ui = await browserCheck();
  results.R5 = { passed: ui.passed, detail: `states=${JSON.stringify(ui.states)}; fatalErrors=${ui.fatal.length}` };

  await stop();
  await start();
  const persistedAnalysis = await request(`/api/analysis/${encodeURIComponent(firstId ?? '')}`);
  const recent = await request('/api/projects/recent');
  const recentText = JSON.stringify(recent.body ?? {});
  results.R6 = { passed: saved.status >= 200 && saved.status < 300 && persistedAnalysis.status === 200 && meaningfulAnalysis(persistedAnalysis.body).passed && recent.status === 200 && recentText.includes(String(firstId)), detail: `save=${saved.status}; analysis=${persistedAnalysis.status}; recent=${recent.status}; projectFound=${recentText.includes(String(firstId))}` };

  const traversalZip = zip({ [`../${escapeName}`]: 'globalThis.oracleEscape = true;\n', 'safe.js': 'export default true;\n' });
  const traversal = await uploadZip(traversalZip, `oracle-traversal-${runId}`);
  const escapeCandidates = [path.join(target, escapeName), path.join(dataDir, escapeName), path.join(path.dirname(target), escapeName)];
  const escapedByPath = (await Promise.all(escapeCandidates.map(candidate => fs.access(candidate).then(() => true).catch(() => false)))).some(Boolean);
  const escaped = escapedByPath || (await filesBelow(dataDir)).some(file => path.basename(file) === escapeName);
  results.R7 = { passed: is4xx(traversal.status) && !escaped, detail: `status=${traversal.status}; outsideFile=${escaped}` };

  const malformedForm = new FormData();
  malformedForm.append('name', 'missing-archive');
  const malformed = await request('/api/projects/upload', { method: 'POST', body: malformedForm });
  const unknownGet = await request('/api/analysis/999999999');
  const unknownStart = await json('POST', '/api/analysis/start/999999999', { options: {} });
  const finalHealth = await request('/api/health');
  results.R8 = { passed: is4xx(malformed.status) && is4xx(unknownGet.status) && is4xx(unknownStart.status) && finalHealth.status === 200 && child.exitCode === null, detail: `malformed=${malformed.status}; unknownGet=${unknownGet.status}; unknownStart=${unknownStart.status}; alive=${finalHealth.status === 200}` };
} catch (error) {
  results.harness = { passed: false, detail: error instanceof Error ? error.message : String(error) };
} finally {
  await stop();
}

const payload = {
  schemaVersion: 1,
  oracle: 'repair-inspectorcode',
  target,
  criteriaSha256,
  at: new Date().toISOString(),
  results,
  passed: Object.keys(results).length === 8 && Object.values(results).every(result => result.passed),
};
if (output) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(payload, null, 2) + '\n');
}
console.log(JSON.stringify(payload, null, 2));
process.exitCode = payload.passed ? 0 : 1;

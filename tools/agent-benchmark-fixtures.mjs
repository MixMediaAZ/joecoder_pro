// The evaluator is written outside the agent's project. Its bytes are fixed before each job.
export const fixtureNames = ['startup', 'test-repair', 'refactor'];
export function fixtureDefinition(name) {
  const packageFiles = {
    'package.json': JSON.stringify({ name: 'agent-benchmark', version: '1.0.0', private: true,
      scripts: { test: 'node check.cjs' } }, null, 2) + '\n',
    'check.cjs': 'require("../oracle.cjs");\n',
    'package-lock.json': JSON.stringify({ name: 'agent-benchmark', version: '1.0.0', lockfileVersion: 3,
      requires: true, packages: { '': { name: 'agent-benchmark', version: '1.0.0' } } }, null, 2) + '\n'
  };
  const prelude = `const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const target = path.resolve(process.argv[2] || '.');
const load = name => require(path.join(target, name));
`;
  if (name === 'startup') return {
    allowed: ['start.bat'],
    objective: 'Find and fix the startup problem. Change only start.bat. Preserve all other files. Run npm test to launch the actual Windows batch file and verify HTTP behavior; report the change and test evidence.',
    files: { ...packageFiles,
      'start.bat': '@echo off\r\ncd /d "%~dp0"\r\nnode missing-server.cjs\r\n',
      'server.cjs': `const http = require('node:http');
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'ok', app: 'startup-fixture' })); });
server.listen(0, '127.0.0.1', () => console.log('READY http://127.0.0.1:' + server.address().port));
` },
    good: { 'start.bat': '@echo off\r\ncd /d "%~dp0"\r\nnode server.cjs\r\n' },
    oracle: prelude + `const { spawn } = require('node:child_process');
(async () => {
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start.bat'], { cwd: target, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', spawnError;
  child.on('error', error => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-64000); });
  try {
    const deadline = Date.now() + 10000; let match;
    while (!(match = output.match(/READY (http:\\/\\/127\\.0\\.0\\.1:\\d+)/))) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw Error('Launcher exited ' + child.exitCode + ': ' + output);
      if (Date.now() > deadline) throw Error('Launcher timeout: ' + output);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const response = await fetch(match[1] + '/health', { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', app: 'startup-fixture' });
    console.log('PASS: actual start.bat launched HTTP application; status and response verified.');
  } finally {
    if (child.pid && child.exitCode === null) await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', resolve); killer.once('close', resolve);
    });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
`
  };
  if (name === 'test-repair') return {
    allowed: ['total.cjs'],
    objective: 'Repair the total calculation so it multiplies unit price by quantity, rounds the result to cents, and rejects negative or non-finite numeric inputs with RangeError. Change only total.cjs. Preserve the existing exported total function and other files. Run npm test and report actual evidence.',
    files: { ...packageFiles, 'total.cjs': 'exports.total = (price, quantity) => price + quantity;\n' },
    good: { 'total.cjs': 'exports.total = (price, quantity) => { if (![price, quantity].every(n => Number.isFinite(n) && n >= 0)) throw new RangeError("Invalid input"); return Math.round(price * quantity * 100) / 100; };\n' },
    oracle: prelude + `const { total } = load('total.cjs');
assert.equal(total(12.5, 3), 37.5, 'multiply price by quantity');
assert.equal(total(9.99, 0), 0, 'zero quantity');
assert.equal(total(1.234, 3), 3.7, 'round the total to cents');
for (const args of [[-1, 2], [1, -2], [NaN, 2], [1, Infinity]]) assert.throws(() => total(...args), RangeError, 'reject invalid inputs');
console.log('PASS: totals, rounding, zero quantity and invalid inputs.');
`
  };
  if (name === 'refactor') return {
    allowed: ['cart.cjs', 'invoice.cjs', 'money.cjs'],
    objective: 'Refactor the duplicated amount calculation in cart.cjs and invoice.cjs into one shared function in money.cjs. Change only cart.cjs, invoice.cjs and money.cjs. Both existing modules must call the shared function and preserve their exported amount(price, quantity) behavior. Preserve package files. Run npm test and report actual evidence.',
    files: { ...packageFiles, 'cart.cjs': 'exports.amount = (price, quantity) => Math.round(price * quantity * 100) / 100;\n',
      'invoice.cjs': 'exports.amount = (price, quantity) => Math.round(price * quantity * 100) / 100;\n' },
    good: { 'cart.cjs': 'exports.amount = require("./money.cjs").amount;\n', 'invoice.cjs': 'exports.amount = require("./money.cjs").amount;\n',
      'money.cjs': 'exports.amount = (price, quantity) => Math.round(price * quantity * 100) / 100;\n' },
    oracle: prelude + `for (const name of ['cart.cjs', 'invoice.cjs']) {
  const { amount } = load(name);
  assert.equal(amount(1.234, 3), 3.7); assert.equal(amount(12.5, 3), 37.5); assert.equal(amount(7, 0), 0);
}
const shared = load('money.cjs');
const entry = require.cache[require.resolve(path.join(target, 'money.cjs'))];
if (typeof shared === 'function') entry.exports = () => 731;
else for (const key of Object.keys(shared)) if (typeof shared[key] === 'function') shared[key] = () => 731;
for (const name of ['cart.cjs', 'invoice.cjs']) {
  delete require.cache[require.resolve(path.join(target, name))];
  assert.equal(load(name).amount(2, 3), 731, name + ' must use the shared implementation');
}
console.log('PASS: behavior preserved and both callers use the shared implementation.');
`
  };
  throw Error('Unknown fixture: ' + name);
}

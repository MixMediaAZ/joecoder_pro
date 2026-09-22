import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

async function collect(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    console.error('Cannot read', dir, '- run this from the JoeCoder project root (folder with package.json).');
    console.error('Current cwd:', process.cwd());
    process.exit(1);
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await collect(full)));
    else if (ent.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

const tests = await collect(dist);
if (!tests.length) {
  console.error('No test files found under dist/. Run: npm run build');
  process.exit(1);
}
// One child per file exposes the exact failing suite and bounds leaked handles.
// A timeout is a failure, never a forced successful exit.
const timeoutMs = Number(process.env.JC_TEST_FILE_TIMEOUT_MS || 120_000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600_000) {
  throw new Error('JC_TEST_FILE_TIMEOUT_MS must be an integer from 1000 to 600000.');
}
const reportDir = path.join(root, '.jc', 'readiness', `tests-${Date.now()}`);
await mkdir(reportDir, { recursive: true });
const results = [];
for (const file of tests.sort()) {
  const name = path.relative(dist, file);
  console.log(`\n[TEST FILE] ${name}`);
  const started = performance.now();
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', file], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true
    });
    let output = '';
    let timedOut = false;
    let settled = false;
    let cleanupTimer;
    const finish = (exitCode, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      resolve({ name, exitCode, timedOut, error, durationMs: Math.round(performance.now() - started), output });
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => { output += String(chunk); process.stdout.write(chunk); });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`[TIMEOUT] ${name} exceeded ${timeoutMs} ms. Stopping its owned process tree.`);
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => child.kill());
        killer.once('close', () => child.kill());
      } else child.kill('SIGKILL');
      cleanupTimer = setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        finish(null, 'Process cleanup did not complete; inspect Windows process permissions.');
      }, 5000);
    }, timeoutMs);
    child.once('error', error => finish(null, error.message));
    child.once('close', code => finish(code));
  });
  await writeFile(path.join(reportDir, name.replace(/[\\/]/g, '_') + '.log'), result.output);
  const { output, ...summary } = result;
  results.push(summary);
  await writeFile(path.join(reportDir, 'summary.json'), JSON.stringify({ results }, null, 2) + '\n');
  // A leaked process can interfere with later suites. Fail immediately and preserve logs.
  if (result.timedOut) break;
}
const passed = results.length === tests.length && results.every(r => r.exitCode === 0 && !r.timedOut && !r.error);
console.log(`\n${passed ? 'PASS' : 'FAIL'}: ${results.length}/${tests.length} test files completed. Reports: ${reportDir}`);
process.exitCode = passed ? 0 : 1;

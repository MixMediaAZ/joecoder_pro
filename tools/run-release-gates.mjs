#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.JC_ALLOW_POST_STAGE2 !== '1') {
  throw new Error(
    'STAGE_FREEZE_ACTIVE: post-Stage2 release gates are frozen until the unbound coding-machine bar is explicitly lifted (set JC_ALLOW_POST_STAGE2=1 to override).'
  );
}
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
if (dirty) throw new Error('RELEASE_GATE_DIRTY_TRACKED_WORKTREE');

const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const useBundledNpm = await fs.access(npmCli).then(() => true).catch(() => false);
const npmCommand = (args) => useBundledNpm
  ? { executable: process.execPath, args: [npmCli, ...args] }
  : { executable: process.platform === 'win32' ? 'npm.cmd' : 'npm', args };
const commands = [
  { command: 'npm test', ...npmCommand(['test']), env: {} },
  { command: 'npm run verify:governance', ...npmCommand(['run', 'verify:governance']), env: {} },
  { command: 'node tools/e2e-live.mjs', executable: process.execPath, args: [path.join(root, 'tools', 'e2e-live.mjs')], env: { JC_MOCK_MODEL: '0' } }
];
const results = [];
for (const item of commands) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(item.executable, item.args, {
    cwd: root, env: { ...process.env, ...item.env }, stdio: 'inherit', windowsHide: true
  });
  results.push({ command: item.command, startedAt, durationMs: Date.now() - started, exitCode: result.status, passed: result.status === 0 });
  if (result.status !== 0) throw new Error(`RELEASE_GATE_FAILED: ${item.command}`);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const receiptName = `CERT-STEP2-RELEASE-GATES-${stamp}-${sourceCommit.slice(0, 8)}.json`;
const receiptPath = path.join(root, '.jc', 'certification', receiptName);
const receipt = { schemaVersion: 1, kind: 'release-gates', sourceCommit, modelMode: 'real', worktreeClean: true, status: 'passed', recordedAt: new Date().toISOString(), results };
await fs.mkdir(path.dirname(receiptPath), { recursive: true });
await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

const manifest = spawnSync(process.execPath, [path.join(root, 'tools', 'receipts-manifest.mjs'), 'sync'], { cwd: root, stdio: 'inherit', windowsHide: true });
if (manifest.status !== 0) throw new Error('RELEASE_GATE_MANIFEST_SYNC_FAILED');
const build = spawnSync(process.execPath, [path.join(root, 'tools', 'build-release.mjs')], {
  cwd: root, env: { ...process.env, JC_RELEASE_GATE_RECEIPT: receiptPath }, stdio: 'inherit', windowsHide: true
});
if (build.status !== 0) throw new Error('RELEASE_BUILD_FAILED');

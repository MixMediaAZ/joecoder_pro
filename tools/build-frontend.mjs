import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');
if (fs.existsSync(path.join(frontend, 'package.json'))) {
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!fs.existsSync(npmCli)) throw new Error('Run this command through npm run build:all.');
  const result = spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: frontend, windowsHide: true, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else if (!fs.existsSync(path.join(frontend, 'out/index.html'))) {
  throw new Error('WORKSPACE_ASSETS_MISSING: source installs require frontend dependencies; release installs require frontend/out.');
} else {
  console.log('Using packaged workspace assets; release checksums must be verified before installation.');
}

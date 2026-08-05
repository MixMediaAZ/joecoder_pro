import { readdir } from 'node:fs/promises';
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
const child = spawn(process.execPath, ['--test', ...tests], {
  cwd: root,
  stdio: 'inherit',
  shell: false
});
child.on('exit', (code) => process.exit(code ?? 1));

#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

if (path.dirname(dist) !== root || path.basename(dist) !== 'dist') {
  throw new Error('Refusing to clean an unexpected path.');
}

await fs.rm(dist, { recursive: true, force: true });
console.log('Removed generated dist output. Preserved .jc evidence and runtime state.');

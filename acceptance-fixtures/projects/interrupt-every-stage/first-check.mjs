import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The marker lives in the isolated acceptance run root, outside the project.
// It forces one observed verification failure so the correction boundary can
// be process-interrupted without changing the preserved test contract.
const runRoot = path.resolve(process.cwd(), '..', '..', '..');
const marker = path.join(runRoot, '.interrupt-first-verification-observed');
const correctionBoundaryEnabled = fs.existsSync(path.join(runRoot, '.enable-correction-boundary'));
if (correctionBoundaryEnabled && !fs.existsSync(marker)) {
  fs.writeFileSync(marker, 'observed\n', 'utf8');
  process.stderr.write('SEEDED_FIRST_VERIFICATION_FAILURE\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false
});
process.exit(result.status ?? 1);

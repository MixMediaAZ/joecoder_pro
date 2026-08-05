#!/usr/bin/env node
/** U4 certification — greenfield build intent contracts. */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function writeEvidence(controlId, result) {
  const dir = path.join(ROOT, '.jc', 'certification');
  await fs.mkdir(dir, { recursive: true });
  const id = `CERT-B-${Date.now()}-${controlId}-${randomBytes(3).toString('hex')}`;
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ id, control: controlId, result, at: new Date().toISOString() }, null, 2));
  return id;
}

function isNearEmptySurvey(survey) {
  const files = survey.entries.filter((e) => e.type === 'file');
  if (files.length === 0) return true;
  if (files.length > 8) return false;
  const ignorable = /^(readme(\.(md|txt))?|\.gitignore|\.gitkeep|\.env\.example|license|licence)(\.|$)/i;
  return files.every((f) => ignorable.test(f.path.replace(/^.*\//, '')) || (f.path.split('/').length <= 1 && ignorable.test(f.path)));
}

async function main() {
  console.log('JoeCoder Build Intent Certification (U4)');
  const repair = await fs.readFile(path.join(ROOT, 'src/repair.ts'), 'utf8');
  const index = await fs.readFile(path.join(ROOT, 'src/index.ts'), 'utf8');
  const ui = await fs.readFile(path.join(ROOT, 'public/app.js'), 'utf8');

  const checks = [];
  checks.push({ id: 'build_system', ok: repair.includes('BUILD_SYSTEM') && repair.includes('buildBuildPlanPrompt') });
  checks.push({ id: 'near_empty_helper', ok: repair.includes('isNearEmptySurvey') });
  checks.push({ id: 'api_accepts_build', ok: index.includes("'build'") && index.includes('BUILD_REQUIRES_NEAR_EMPTY') });
  checks.push({ id: 'apply_allows_build', ok: index.includes("['repair', 'build']") });
  checks.push({ id: 'ui_build_button', ok: ui.includes('btn-draft-build') && ui.includes("runFromSurvey('build')") });

  checks.push({ id: 'near_empty_true_empty', ok: isNearEmptySurvey({ entries: [] }) });
  checks.push({ id: 'near_empty_readme_only', ok: isNearEmptySurvey({ entries: [{ type: 'file', path: 'README.md' }] }) });
  checks.push({ id: 'near_empty_false_src', ok: !isNearEmptySurvey({ entries: [{ type: 'file', path: 'src/index.js' }, { type: 'file', path: 'src/lib.js' }] }) });

  let all = true;
  for (const c of checks) {
    const id = await writeEvidence(c.id, c);
    console.log(`[${c.id}] ${c.ok ? 'PASS' : 'FAIL'}  evidence=${id}`);
    if (!c.ok) all = false;
  }
  console.log('');
  console.log(all ? 'ALL U4 CONTROLS PASSED' : 'U4 CONTROLS FAILED');
  process.exit(all ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });

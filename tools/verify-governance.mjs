import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ratified = path.join(root, 'plan', 'ratified-1.3.1');
const amendment = path.join(root, 'plan', 'amendment-1.3.2');
const manifest = JSON.parse(await fs.readFile(path.join(ratified, 'ratification-manifest.json'), 'utf8'));
const rulesBytes = await fs.readFile(path.join(ratified, 'spec', 'rules.json'));
const rules = JSON.parse(rulesBytes.toString('utf8'));
const map = JSON.parse(await fs.readFile(path.join(amendment, 'spec', 'implementation-map.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const failures = [];

for (const entry of manifest.files) {
  const target = path.join(ratified, entry.path);
  const observed = await fs.readFile(target).then(sha256).catch(() => null);
  if (observed !== entry.sha256) failures.push(`ratified hash: ${entry.path}`);
}

const ruleIds = rules.rules.map((law) => law.id);
const mappingIds = map.mappings.map((mapping) => mapping.id);
if (rules.specVersion !== '1.3.1' || rules.status !== 'approved') failures.push('canonical authority/version');
if (sha256(rulesBytes) !== map.canonicalRulesHash) failures.push('canonical rules hash');
if (manifest.planRootHash !== map.canonicalPlanRootHash) failures.push('canonical plan root hash');
if (ruleIds.length !== 48 || new Set(ruleIds).size !== 48) failures.push('canonical law count/uniqueness');
if (mappingIds.length !== 48 || new Set(mappingIds).size !== 48) failures.push('implementation count/uniqueness');
if (ruleIds.some((id) => !mappingIds.includes(id)) || mappingIds.some((id) => !ruleIds.includes(id))) failures.push('implementation IDs');
if (ruleIds.some((id) => id.startsWith('JC-KER-'))) failures.push('placeholder canonical law');

const totals = { enforced: 0, partial: 0, missing: 0 };
for (const mapping of map.mappings) {
  if (!Object.hasOwn(totals, mapping.status)) {
    failures.push(`unknown status: ${mapping.id}`);
    continue;
  }
  totals[mapping.status] += 1;
  if (mapping.status === 'enforced' && (mapping.gap !== null || !mapping.modules.length || !mapping.tests.length)) {
    failures.push(`unsupported enforced verdict: ${mapping.id}`);
  }
  if (mapping.status !== 'enforced' && !mapping.gap) failures.push(`missing gap: ${mapping.id}`);
  for (const relative of [...mapping.modules, ...mapping.tests]) {
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`) || !(await fs.stat(target).catch(() => null))?.isFile()) {
      failures.push(`mapped path: ${mapping.id} -> ${relative}`);
    }
  }
}
for (const [status, count] of Object.entries(totals)) {
  if (map.summary[status] !== count) failures.push(`summary count: ${status}`);
}

const truthFiles = ['WORKFLOW_GUIDE.md', 'ASSESSMENT_REMEDIATION.md', 'SURVEY_AND_UPGRADES.md', 'public/app.js', 'src/brainPresets.ts', 'src/brainPresets.test.ts', 'src/laws.test.ts', 'tools/verify-live-workflow.mjs'];
for (const relative of truthFiles) {
  const text = await fs.readFile(path.join(root, relative), 'utf8');
  if (/all 51|51 canonical|all 12 registry families/i.test(text)) failures.push(`stale canonical claim: ${relative}`);
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  canonicalVersion: rules.specVersion,
  amendmentVersion: map.amendmentVersion,
  canonicalPlanRootHash: manifest.planRootHash,
  ratifiedFiles: { matching: manifest.files.length - failures.filter((item) => item.startsWith('ratified hash:')).length, total: manifest.files.length },
  laws: { total: ruleIds.length, ...totals },
  missing: map.mappings.filter((mapping) => mapping.status === 'missing').map((mapping) => mapping.id),
  failures
}, null, 2));
process.exitCode = failures.length ? 1 : 0;

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalPath = path.join(root, 'plan', 'ratified-1.3.1', 'spec', 'rules.json');
const sourcePath = path.join(root, 'plan', 'amendment-1.3.3', 'spec', 'enforcement-points.json');
const limitationsPath = path.join(root, 'plan', 'amendment-1.3.3', 'RATIFIED_LIMITATIONS.json');
const outputPath = path.join(root, 'plan', 'amendment-1.3.3', 'spec', 'implementation-map.json');
const canonicalBytes = await fs.readFile(canonicalPath);
const canonical = JSON.parse(canonicalBytes.toString('utf8'));
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const limitationDocument = JSON.parse(await fs.readFile(limitationsPath, 'utf8'));
if (limitationDocument.status !== 'operator_ratified' || limitationDocument.amendmentVersion !== '1.3.3') throw new Error('LIMITATION_AUTHORITY_INVALID');
const rules = canonical.rules;
const points = source.mappings;
const limitations = new Map(limitationDocument.limitations.map(item => [item.lawId, item]));
if (rules.length !== 48 || points.length !== 48 || new Set(points.map(item => item.id)).size !== 48) throw new Error('ENFORCEMENT_POINT_COUNT_INVALID');
const ruleIds = new Set(rules.map(item => item.id));
const mappings = [];
for (const point of points) {
  if (!ruleIds.has(point.id)) throw new Error(`UNKNOWN_ENFORCEMENT_POINT: ${point.id}`);
  if (!['enforced', 'partial'].includes(point.status)) throw new Error(`UNRATIFIED_STATUS: ${point.id}`);
  for (const relative of [...point.modules, ...point.tests]) {
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(root + path.sep) || !(await fs.stat(resolved).catch(() => null))?.isFile()) throw new Error(`ENFORCEMENT_PATH_INVALID: ${point.id} -> ${relative}`);
  }
  if (point.status === 'enforced') {
    if (!point.modules.length || !point.tests.length) throw new Error(`ENFORCEMENT_PROOF_MISSING: ${point.id}`);
    mappings.push({ id: point.id, status: 'enforced', modules: point.modules, tests: point.tests, gap: null, limitationId: null });
  } else {
    const limitation = limitations.get(point.id);
    if (!limitation || !limitation.id || !limitation.boundary) throw new Error(`RATIFIED_LIMITATION_MISSING: ${point.id}`);
    mappings.push({ id: point.id, status: 'partial', modules: point.modules, tests: point.tests, gap: limitation.boundary, limitationId: limitation.id });
  }
}
for (const lawId of limitations.keys()) if (!mappings.some(item => item.id === lawId && item.status === 'partial')) throw new Error(`ORPHAN_LIMITATION: ${lawId}`);
const summary = mappings.reduce((value, item) => ({ ...value, [item.status]: value[item.status] + 1 }), { enforced: 0, partial: 0, missing: 0 });
const output = {
  schemaVersion: '1.1.0', amendmentVersion: '1.3.3', canonicalPlanVersion: '1.3.1',
  canonicalPlanRootHash: '39d9d5333f47f88f207f3d9dc94788f26fc1ab0dbb95d02d1b2561234c465d60',
  canonicalRulesHash: createHash('sha256').update(canonicalBytes).digest('hex'),
  generatedFrom: ['spec/enforcement-points.json', '../RATIFIED_LIMITATIONS.json'], auditedOn: '2026-08-05', summary, mappings
};
const rendered = JSON.stringify(output, null, 2) + '\n';
if (process.argv.includes('--check')) {
  const current = await fs.readFile(outputPath, 'utf8').catch(() => '');
  if (current !== rendered) throw new Error('IMPLEMENTATION_MAP_NOT_REGENERATED');
} else {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, rendered);
}
console.log(JSON.stringify({ ok: true, summary, output: path.relative(root, outputPath) }, null, 2));

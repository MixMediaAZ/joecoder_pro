import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ImplementationStatus = 'enforced' | 'partial' | 'missing';

export interface LawImplementation {
  id: string;
  status: ImplementationStatus;
  modules: string[];
  tests: string[];
  gap: string | null;
}

export interface CanonicalLaw {
  id: string;
  title: string;
  category: string;
  priority: 'P0' | 'P1' | 'P2';
  requirement: string;
  enforcement: string[];
  failureBehavior: string;
  verification: string[];
  sources: string[];
  implementation: LawImplementation;
}

export interface CanonicalLawsBundle {
  version: string;
  canonicalVersion: string;
  amendmentVersion: string;
  canonicalPlanRootHash: string;
  source: string;
  implementationSource: string;
  sourceHash: string;
  implementationHash: string;
  statusSummary: Record<ImplementationStatus, number>;
  laws: CanonicalLaw[];
}

interface CanonicalLawSource extends Omit<CanonicalLaw, 'implementation'> {}

interface ImplementationMap {
  schemaVersion?: string;
  amendmentVersion?: string;
  canonicalPlanVersion?: string;
  canonicalPlanRootHash?: string;
  canonicalRulesHash?: string;
  summary?: Partial<Record<ImplementationStatus, number>>;
  mappings?: LawImplementation[];
}

const CANONICAL_VERSION = '1.3.1';
const AMENDMENT_VERSION = '1.3.2';
const CANONICAL_RULE_COUNT = 48;
const CANONICAL_PLAN_ROOT_HASH = '39d9d5333f47f88f207f3d9dc94788f26fc1ab0dbb95d02d1b2561234c465d60';
const CANONICAL_RULES_HASH = 'a6281838e3503b8b4bb6362c0f80dddd656499ff10428adc28705b01cda12242';
const STATUSES: readonly ImplementationStatus[] = ['enforced', 'partial', 'missing'];

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertUniqueIds(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${label}_DUPLICATE_IDS`);
}

function assertCanonicalLaw(law: CanonicalLawSource): void {
  if (
    !law.id || !law.title || !law.category || !['P0', 'P1', 'P2'].includes(law.priority) ||
    !law.requirement || !law.failureBehavior || !Array.isArray(law.enforcement) || !law.enforcement.length ||
    !Array.isArray(law.verification) || !law.verification.length || !Array.isArray(law.sources) || !law.sources.length
  ) throw new Error(`LAW_REGISTRY_MALFORMED: ${law.id || 'unknown'}`);
}

function countStatuses(mappings: LawImplementation[]): Record<ImplementationStatus, number> {
  return mappings.reduce<Record<ImplementationStatus, number>>((counts, mapping) => {
    counts[mapping.status] += 1;
    return counts;
  }, { enforced: 0, partial: 0, missing: 0 });
}

export async function loadCanonicalLaws(root: string): Promise<CanonicalLawsBundle> {
  const source = path.join(root, 'plan', 'ratified-1.3.1', 'spec', 'rules.json');
  const implementationSource = path.join(root, 'plan', 'amendment-1.3.2', 'spec', 'implementation-map.json');
  const [sourceBytes, implementationBytes] = await Promise.all([fs.readFile(source), fs.readFile(implementationSource)]);
  const sourceHash = sha256(sourceBytes);
  const implementationHash = sha256(implementationBytes);

  if (sourceHash !== CANONICAL_RULES_HASH) {
    throw new Error(`LAW_REGISTRY_HASH_MISMATCH: expected ${CANONICAL_RULES_HASH}, observed ${sourceHash}`);
  }

  const parsed = JSON.parse(sourceBytes.toString('utf8')) as {
    specVersion?: string;
    status?: string;
    rules?: CanonicalLawSource[];
  };
  const sourceLaws = parsed.rules ?? [];
  const sourceIds = sourceLaws.map((law) => law.id);
  if (parsed.specVersion !== CANONICAL_VERSION || parsed.status !== 'approved') {
    throw new Error(`LAW_REGISTRY_AUTHORITY_MISMATCH: expected approved ${CANONICAL_VERSION}`);
  }
  if (sourceLaws.length !== CANONICAL_RULE_COUNT) {
    throw new Error(`LAW_REGISTRY_COUNT_MISMATCH: expected ${CANONICAL_RULE_COUNT}, observed ${sourceLaws.length}`);
  }
  assertUniqueIds(sourceIds, 'LAW_REGISTRY');
  sourceLaws.forEach(assertCanonicalLaw);

  const implementation = JSON.parse(implementationBytes.toString('utf8')) as ImplementationMap;
  const mappings = implementation.mappings ?? [];
  const mappingIds = mappings.map((mapping) => mapping.id);
  if (
    implementation.schemaVersion !== '1.0.0' || implementation.amendmentVersion !== AMENDMENT_VERSION ||
    implementation.canonicalPlanVersion !== CANONICAL_VERSION ||
    implementation.canonicalPlanRootHash !== CANONICAL_PLAN_ROOT_HASH ||
    implementation.canonicalRulesHash !== CANONICAL_RULES_HASH
  ) throw new Error('LAW_IMPLEMENTATION_AUTHORITY_MISMATCH');
  if (mappings.length !== CANONICAL_RULE_COUNT) {
    throw new Error(`LAW_IMPLEMENTATION_COUNT_MISMATCH: expected ${CANONICAL_RULE_COUNT}, observed ${mappings.length}`);
  }
  assertUniqueIds(mappingIds, 'LAW_IMPLEMENTATION');
  if (sourceIds.some((id) => !mappingIds.includes(id)) || mappingIds.some((id) => !sourceIds.includes(id))) {
    throw new Error('LAW_IMPLEMENTATION_ID_MISMATCH');
  }

  for (const mapping of mappings) {
    if (!STATUSES.includes(mapping.status) || !Array.isArray(mapping.modules) || !Array.isArray(mapping.tests)) {
      throw new Error(`LAW_IMPLEMENTATION_MALFORMED: ${mapping.id || 'unknown'}`);
    }
    if (mapping.status === 'enforced' && (!mapping.modules.length || !mapping.tests.length || mapping.gap !== null)) {
      throw new Error(`LAW_IMPLEMENTATION_UNPROVEN_ENFORCED: ${mapping.id}`);
    }
    if (mapping.status !== 'enforced' && (!mapping.gap || mapping.gap.trim().length < 12)) {
      throw new Error(`LAW_IMPLEMENTATION_GAP_REQUIRED: ${mapping.id}`);
    }
  }

  const statusSummary = countStatuses(mappings);
  for (const status of STATUSES) {
    if (implementation.summary?.[status] !== statusSummary[status]) {
      throw new Error(`LAW_IMPLEMENTATION_SUMMARY_MISMATCH: ${status}`);
    }
  }

  const byId = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  const laws = sourceLaws.map<CanonicalLaw>((law) => ({ ...law, implementation: byId.get(law.id)! }));
  return {
    version: AMENDMENT_VERSION,
    canonicalVersion: CANONICAL_VERSION,
    amendmentVersion: AMENDMENT_VERSION,
    canonicalPlanRootHash: CANONICAL_PLAN_ROOT_HASH,
    source,
    implementationSource,
    sourceHash,
    implementationHash,
    statusSummary,
    laws
  };
}

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface CanonicalLaw {
  id: string;
  title: string;
  category: string;
  requirement: string;
  enforcement: string[];
  verification: string[];
}

export interface CanonicalLawsBundle {
  version: string;
  source: string;
  sourceHash: string;
  laws: CanonicalLaw[];
}

const REQUIRED_COMMS_LAWS = ['JC-COMMS-001', 'JC-COMMS-002', 'JC-COMMS-003'];

export async function loadCanonicalLaws(root: string): Promise<CanonicalLawsBundle> {
  const source = path.join(root, 'plan', 'plan-1.3', 'spec', 'rules.json');
  const bytes = await fs.readFile(source);
  const parsed = JSON.parse(bytes.toString('utf8')) as {
    specVersion?: string;
    rules?: CanonicalLaw[];
  };
  const laws = parsed.rules ?? [];
  const ids = laws.map((law) => law.id);

  if (parsed.specVersion !== '1.3.2') {
    throw new Error(`LAW_REGISTRY_VERSION_MISMATCH: expected 1.3.2, observed ${parsed.specVersion ?? 'missing'}`);
  }
  if (laws.length !== 51 || new Set(ids).size !== 51) {
    throw new Error(`LAW_REGISTRY_COUNT_MISMATCH: expected 51 unique laws, observed ${laws.length}/${new Set(ids).size}`);
  }
  for (const id of REQUIRED_COMMS_LAWS) {
    if (!ids.includes(id)) throw new Error(`LAW_REGISTRY_MISSING_REQUIRED: ${id}`);
  }
  for (const law of laws) {
    if (
      !law.id ||
      !law.title ||
      !law.requirement ||
      !Array.isArray(law.enforcement) ||
      law.enforcement.length === 0 ||
      !Array.isArray(law.verification) ||
      law.verification.length === 0
    ) {
      throw new Error(`LAW_REGISTRY_MALFORMED: ${law.id || 'unknown'}`);
    }
  }

  return {
    version: parsed.specVersion,
    source,
    sourceHash: createHash('sha256').update(bytes).digest('hex'),
    laws
  };
}

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export class SupplyChainError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

export interface DependencyComponent {
  name: string;
  version: string;
  resolved: string;
  integrity: string;
  license: string | null;
  development: boolean;
  optional: boolean;
}

export interface DependencyInventory {
  schemaVersion: 1;
  packageName: string;
  packageVersion: string;
  manifestSha256: string;
  lockfileSha256: string;
  lockfileVersion: number;
  allowedRegistries: string[];
  components: DependencyComponent[];
}

export interface SignatureBlock {
  algorithm: 'Ed25519';
  keyId: string;
  publicKeyPem: string;
  value: string;
}

export interface SignedEnvelope<T> {
  schemaVersion: 1;
  payload: T;
  signature: SignatureBlock | null;
}

export interface ReleaseBundle {
  schemaVersion: 1;
  subject: { name: string; version: string };
  createdAt: string;
  sbom: Record<string, unknown>;
  licenses: Array<{ name: string; version: string; license: string | null }>;
  provenance: Record<string, unknown>;
  files: Array<{ path: string; sha256: string; bytes: number }>;
}

const REGISTRY = 'https://registry.npmjs.org/';
const INTEGRITY = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const HASH = /^[a-f0-9]{64}$/;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, sortValue(item)]));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

async function deadline<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new SupplyChainError('SUPPLY_CHAIN_TIMEOUT_INVALID', `${label} has an invalid timeout.`);
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new SupplyChainError('SUPPLY_CHAIN_TIMEOUT', `${label} did not finish in time.`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseJsonObject(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch {
    throw new SupplyChainError('SUPPLY_CHAIN_DATA_MALFORMED', `${label} is not valid JSON metadata.`);
  }
}

function packageNameFromLockPath(lockPath: string): string {
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  return index < 0 ? lockPath : lockPath.slice(index + marker.length);
}

export async function inventoryNpmDependencies(projectRoot: string, timeoutMs = 10_000): Promise<DependencyInventory> {
  const root = path.resolve(projectRoot);
  const [manifestBytes, lockBytes] = await deadline(Promise.all([
    fs.readFile(path.join(root, 'package.json')),
    fs.readFile(path.join(root, 'package-lock.json'))
  ]), timeoutMs, 'Dependency inventory').catch((error: unknown) => {
    if (error instanceof SupplyChainError) throw error;
    throw new SupplyChainError('DEPENDENCY_METADATA_REQUIRED', 'Both package.json and package-lock.json are required.');
  });
  const manifest = parseJsonObject(manifestBytes, 'package.json');
  const lock = parseJsonObject(lockBytes, 'package-lock.json');
  const packages = lock.packages;
  const lockfileVersion = Number(lock.lockfileVersion);
  if (![2, 3].includes(lockfileVersion) || !packages || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new SupplyChainError('LOCKFILE_POLICY_REJECTED', 'A supported npm lockfile with a packages inventory is required.');
  }
  const components: DependencyComponent[] = [];
  for (const [lockPath, raw] of Object.entries(packages as Record<string, unknown>)) {
    if (!lockPath || !lockPath.includes('node_modules/')) continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new SupplyChainError('DEPENDENCY_PROVENANCE_MALFORMED', `${lockPath} has malformed lock metadata.`);
    }
    const item = raw as Record<string, unknown>;
    const version = typeof item.version === 'string' ? item.version : '';
    const resolved = typeof item.resolved === 'string' ? item.resolved : '';
    const integrity = typeof item.integrity === 'string' ? item.integrity : '';
    if (!version || !resolved.startsWith(REGISTRY) || !INTEGRITY.test(integrity)) {
      throw new SupplyChainError('DEPENDENCY_PROVENANCE_REJECTED', `${lockPath} is not pinned to the admitted registry with a valid integrity digest.`);
    }
    components.push({
      name: packageNameFromLockPath(lockPath), version, resolved, integrity,
      license: typeof item.license === 'string' ? item.license : null,
      development: item.dev === true,
      optional: item.optional === true
    });
  }
  components.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  if (!components.length && Object.keys({
    ...(manifest.dependencies as Record<string, unknown> | undefined),
    ...(manifest.devDependencies as Record<string, unknown> | undefined)
  }).length) throw new SupplyChainError('DEPENDENCY_INVENTORY_EMPTY', 'Declared dependencies are missing from the lockfile inventory.');
  return {
    schemaVersion: 1,
    packageName: typeof manifest.name === 'string' ? manifest.name : 'unnamed-package',
    packageVersion: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    manifestSha256: sha256(manifestBytes), lockfileSha256: sha256(lockBytes), lockfileVersion,
    allowedRegistries: [REGISTRY], components
  };
}

export function createSigningIdentity(): { privateKeyPem: string; publicKeyPem: string; keyId: string } {
  const pair = generateKeyPairSync('ed25519');
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { privateKeyPem, publicKeyPem, keyId: sha256(publicKeyPem) };
}

export async function loadOrCreateSigningIdentity(directory: string): Promise<{ privateKeyPem: string; publicKeyPem: string; keyId: string }> {
  const root = path.resolve(directory);
  const privatePath = path.join(root, 'ed25519-private.pem');
  const publicPath = path.join(root, 'ed25519-public.pem');
  await fs.mkdir(root, { recursive: true });
  const read = async () => {
    const [privateKeyPem, publicKeyPem] = await Promise.all([
      fs.readFile(privatePath, 'utf8'), fs.readFile(publicPath, 'utf8')
    ]);
    const derived = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' }).toString();
    if (derived !== publicKeyPem) throw new SupplyChainError('SIGNING_IDENTITY_MISMATCH', 'The stored public and private signing keys do not match.');
    return { privateKeyPem, publicKeyPem, keyId: sha256(publicKeyPem) };
  };
  try { return await read(); } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const identity = createSigningIdentity();
  try {
    await fs.writeFile(privatePath, identity.privateKeyPem, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.writeFile(publicPath, identity.publicKeyPem, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    return identity;
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return read();
  }
}

export function signEnvelope<T>(payload: T, privateKeyPem?: string): SignedEnvelope<T> {
  if (!privateKeyPem) return { schemaVersion: 1, payload, signature: null };
  let privateKey;
  try { privateKey = createPrivateKey(privateKeyPem); } catch {
    throw new SupplyChainError('SIGNING_KEY_MALFORMED', 'The configured release signing identity is invalid.');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new SupplyChainError('SIGNING_KEY_REJECTED', 'The configured signing identity must be Ed25519.');
  }
  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const value = sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64');
  return { schemaVersion: 1, payload, signature: { algorithm: 'Ed25519', keyId: sha256(publicKeyPem), publicKeyPem, value } };
}

export function verifyEnvelope<T>(envelope: SignedEnvelope<T>, trustedKeyId?: string): T {
  if (!envelope || envelope.schemaVersion !== 1 || !envelope.payload) {
    throw new SupplyChainError('ATTESTATION_MALFORMED', 'The signed metadata envelope is malformed.');
  }
  if (trustedKeyId && !envelope.signature) {
    throw new SupplyChainError('SIGNATURE_REQUIRED', 'A trusted identity is configured, but signed metadata is missing.');
  }
  if (!envelope.signature) return envelope.payload;
  const block = envelope.signature;
  if (block.algorithm !== 'Ed25519' || !HASH.test(block.keyId) || !block.publicKeyPem || !block.value) {
    throw new SupplyChainError('SIGNATURE_MALFORMED', 'The signature metadata is incomplete or invalid.');
  }
  if (trustedKeyId && block.keyId !== trustedKeyId) {
    throw new SupplyChainError('SIGNATURE_IDENTITY_REJECTED', 'The signer does not match the configured trusted identity.');
  }
  let publicKey;
  try { publicKey = createPublicKey(block.publicKeyPem); } catch {
    throw new SupplyChainError('SIGNATURE_KEY_MALFORMED', 'The public signing key is invalid.');
  }
  if (sha256(block.publicKeyPem) !== block.keyId ||
      !verify(null, Buffer.from(canonicalJson(envelope.payload)), publicKey, Buffer.from(block.value, 'base64'))) {
    throw new SupplyChainError('SIGNATURE_VERIFICATION_FAILED', 'Signed metadata failed cryptographic verification.');
  }
  return envelope.payload;
}

export async function verifyDependencyAdmission(
  projectRoot: string,
  admitted: SignedEnvelope<DependencyInventory>,
  options: { trustedKeyId?: string; timeoutMs?: number } = {}
): Promise<DependencyInventory> {
  const expected = verifyEnvelope(admitted, options.trustedKeyId);
  const observed = await inventoryNpmDependencies(projectRoot, options.timeoutMs ?? 10_000);
  if (canonicalJson(expected) !== canonicalJson(observed)) {
    throw new SupplyChainError('DEPENDENCY_ADMISSION_MISMATCH', 'Dependency metadata changed after admission.');
  }
  return observed;
}

async function releaseFiles(root: string, relative = ''): Promise<Array<{ path: string; sha256: string; bytes: number }>> {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const output: Array<{ path: string; sha256: string; bytes: number }> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.posix.join(relative.replace(/\\/g, '/'), entry.name);
    if (entry.isSymbolicLink()) throw new SupplyChainError('RELEASE_SYMLINK_REJECTED', `${rel} is a symbolic link.`);
    if (entry.isDirectory()) output.push(...await releaseFiles(root, rel));
    else if (entry.isFile()) {
      const bytes = await fs.readFile(path.join(root, rel));
      output.push({ path: rel, sha256: sha256(bytes), bytes: bytes.length });
    }
  }
  return output;
}

export async function createReleaseBundle(
  releaseRoot: string,
  inventory: DependencyInventory,
  provenance: { sourceCommit: string; builder: string; tests: string[]; limitations: string[] },
  timeoutMs = 30_000
): Promise<ReleaseBundle> {
  const files = await deadline(releaseFiles(path.resolve(releaseRoot)), timeoutMs, 'Release checksum inventory');
  if (!files.length || !provenance.sourceCommit || !provenance.builder || !provenance.tests.length) {
    throw new SupplyChainError('RELEASE_PROVENANCE_REQUIRED', 'Release files and complete build provenance are required.');
  }
  return {
    schemaVersion: 1,
    subject: { name: inventory.packageName, version: inventory.packageVersion },
    createdAt: new Date().toISOString(),
    sbom: {
      bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
      metadata: { component: { type: 'application', name: inventory.packageName, version: inventory.packageVersion } },
      components: inventory.components.map(item => ({
        type: 'library', name: item.name, version: item.version,
        purl: `pkg:npm/${encodeURIComponent(item.name)}@${item.version}`,
        hashes: [{ alg: item.integrity.slice(0, item.integrity.indexOf('-')).toUpperCase(), content: item.integrity.slice(item.integrity.indexOf('-') + 1) }],
        licenses: item.license ? [{ license: { id: item.license } }] : []
      }))
    },
    licenses: inventory.components.map(item => ({ name: item.name, version: item.version, license: item.license })),
    provenance: {
      predicateType: 'https://slsa.dev/provenance/v1',
      subject: files.map(file => ({ name: file.path, digest: { sha256: file.sha256 } })),
      buildDefinition: { buildType: 'https://joecoder.local/build/v1', externalParameters: { sourceCommit: provenance.sourceCommit } },
      runDetails: { builder: { id: provenance.builder }, metadata: { invocationId: sha256(`${provenance.sourceCommit}:${files.length}`) } },
      tests: provenance.tests,
      limitations: provenance.limitations
    },
    files
  };
}

export async function verifyReleaseBundle(
  releaseRoot: string,
  envelope: SignedEnvelope<ReleaseBundle>,
  options: { trustedKeyId?: string; timeoutMs?: number } = {}
): Promise<ReleaseBundle> {
  const bundle = verifyEnvelope(envelope, options.trustedKeyId);
  if (!bundle.sbom || !bundle.provenance || !Array.isArray(bundle.licenses) || !Array.isArray(bundle.files) || !bundle.files.length) {
    throw new SupplyChainError('RELEASE_METADATA_MALFORMED', 'SBOM, license, provenance, and checksum records are all required.');
  }
  const observed = await deadline(releaseFiles(path.resolve(releaseRoot)), options.timeoutMs ?? 30_000, 'Release verification');
  if (canonicalJson(observed) !== canonicalJson(bundle.files)) {
    throw new SupplyChainError('RELEASE_CHECKSUM_MISMATCH', 'Release contents do not match the signed checksum inventory.');
  }
  return bundle;
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.jc');
const CONFIG = path.join(DATA, 'lmc-connection.json');
const STATE = path.join(DATA, 'lmc-models.json');
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const artifactSchema = z.object({
  artifact_id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  format: z.string(), quantization: z.string().nullable(), aliases: z.array(z.string()),
  blobs: z.array(z.object({ sha256: sha, bytes: z.number().int().positive(), kind: z.string() })),
  locations: z.array(z.object({ path: z.string() })),
});
const configSchema = z.object({
  lmcUrl: z.string(), ollamaUrl: z.string(), modelsDir: z.string(), nodeId: z.string().optional(),
});

export function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use an HTTP loopback base URL, such as http://127.0.0.1:<port>.');
  }
  return url.origin;
}

export function modelName(artifact, filename) {
  const slug = path.basename(filename, path.extname(filename)).toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '').slice(0, 80) || 'model';
  return `lmc/${slug}:${artifact.artifact_id.slice(7, 23)}`;
}

export async function confinedFile(directory, filename) {
  const root = await fs.realpath(directory);
  const file = await fs.realpath(filename);
  const relative = path.relative(root, file);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Model is outside the configured LMC model folder: ${filename}`);
  }
  if (!file.toLowerCase().endsWith('.gguf')) throw new Error('Only GGUF model files can be imported.');
  if (/-\d{5}-of-\d{5}\.gguf$/i.test(file)) throw new Error('Split GGUF files require a complete-shard import; this connector accepts single-file GGUFs.');
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error(`Not a model file: ${file}`);
  const handle = await fs.open(file, 'r');
  try {
    const magic = Buffer.alloc(4);
    await handle.read(magic, 0, 4, 0);
    if (magic.toString('ascii') !== 'GGUF') throw new Error(`Invalid GGUF header: ${file}`);
  } finally { await handle.close(); }
  return { file, size: stat.size, mtimeMs: stat.mtimeMs };
}

async function json(base, route, body, timeout = 15_000) {
  const response = await fetch(`${base}${route}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(timeout),
  });
  const result = await response.json();
  if (!response.ok || result?.error) throw new Error(`${route}: ${result?.error || `HTTP ${response.status}`}`);
  return result;
}

export function clientsFor(config) {
  const lmc = localUrl(config.lmcUrl), ollama = localUrl(config.ollamaUrl);
  return {
    health: () => json(lmc, '/api/health'),
    discovery: () => json(lmc, '/api/discovery/status'),
    artifacts: () => json(lmc, '/api/artifacts'),
    register: (file) => json(lmc, '/api/artifacts/import', { path: file, alias: path.basename(file, '.gguf') }, 30 * 60_000),
    tags: () => json(ollama, '/api/tags'),
    show: (model) => json(ollama, '/api/show', { model }),
  };
}

async function saveJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function createOllamaModel({ model, file, ollamaUrl, log = console.log }) {
  const directory = path.join(DATA, 'lmc-imports');
  await fs.mkdir(directory, { recursive: true });
  const modelfile = path.join(directory, `${model.replace(/[^a-z0-9._-]/g, '_')}.Modelfile`);
  // The path is one quoted Modelfile value, never a shell command.
  if (/[\r\n"]/.test(file)) throw new Error('Model paths must not contain quotes or newlines.');
  await fs.writeFile(modelfile, `FROM "${file.replaceAll('\\', '/')}"\nPARAMETER num_ctx 8192\n`);
  log(`[LMC] Importing ${model}; Ollama reuses a matching blob when already present.`);
  await new Promise((resolve, reject) => {
    const child = spawn('ollama', ['create', model, '-f', modelfile], {
      shell: false, windowsHide: true,
      env: { ...process.env, OLLAMA_HOST: localUrl(ollamaUrl) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '', timedOut = false;
    const progress = setInterval(() => log(`[LMC] Still importing ${model}...`), 20_000);
    const deadline = setTimeout(() => { timedOut = true; child.kill(); }, 30 * 60_000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
      tail = (tail + chunk.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')).slice(-4000);
    });
    child.once('error', (error) => { clearInterval(progress); clearTimeout(deadline); reject(error); });
    child.once('close', (code) => {
      clearInterval(progress); clearTimeout(deadline);
      if (code === 0 && !timedOut) resolve();
      else reject(new Error(timedOut ? 'Ollama import exceeded 30 minutes.' : `Ollama import failed (${code}): ${tail.trim()}`));
    });
  });
}

export async function syncLibrary(config, { clients = clientsFor(config), createModel = createOllamaModel,
  state = { models: {} }, save = async () => {}, log = console.log, sync = true } = {}) {
  config = configSchema.parse(config);
  localUrl(config.lmcUrl); localUrl(config.ollamaUrl);
  const health = await clients.health();
  if (health?.ok !== true || health?.milestone !== 'discovery-inbox' || typeof health?.node_id !== 'string') {
    throw new Error('The configured service is not Local Model Curator. Check its current URL.');
  }
  if (config.nodeId && config.nodeId !== health.node_id) throw new Error('LMC node identity changed; reconnect explicitly to the intended library.');
  const discovery = await clients.discovery();
  const root = await fs.realpath(config.modelsDir);
  if (await fs.realpath(discovery.models_dir) !== root) throw new Error('The LMC service uses a different model folder.');
  let artifacts = z.array(artifactSchema).parse(await clients.artifacts());
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.gguf'));
  const errors = [], results = [];
  let tags = (await clients.tags()).models;
  if (!Array.isArray(tags)) throw new Error('Ollama did not return its model list.');
  for (const entry of files) {
    try {
      const source = await confinedFile(root, path.join(root, entry.name));
      const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
      let artifact = artifacts.find(item => item.locations.some(location =>
        pathKey(location.path) === pathKey(source.file)));
      if (!artifact) {
        if (!sync) { results.push({ file: entry.name, status: 'unregistered' }); continue; }
        log(`[LMC] Registering and hashing ${entry.name} (${(source.size / 1024 ** 3).toFixed(1)} GiB)...`);
        artifact = artifactSchema.parse(await clients.register(source.file));
        artifacts.push(artifact);
      }
      if (artifact.format !== 'gguf' || artifact.blobs.length !== 1 || artifact.blobs[0].kind !== 'weight') {
        throw new Error('Only single-weight GGUF artifacts are supported.');
      }
      if (artifact.blobs[0].bytes !== source.size) throw new Error('File size differs from its LMC identity; re-register the changed file in LMC first.');
      const model = modelName(artifact, source.file), previous = state.models[artifact.artifact_id];
      if (previous && (previous.size !== source.size || previous.mtimeMs !== source.mtimeMs)) {
        throw new Error('File changed since synchronization; verify its LMC identity before importing it again.');
      }
      let installed = tags.find(item => item.name === model);
      if (!installed && !sync) { results.push({ file: entry.name, artifactId: artifact.artifact_id, model, status: 'not imported' }); continue; }
      if (installed && previous && installed.digest !== previous.ollamaDigest) {
        throw new Error(`Ollama model ${model} changed outside this connection; refusing to overwrite it.`);
      }
      if (!installed) {
        log(`[LMC] Checking source checksum before import: ${entry.name}`);
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(source.file)) hash.update(chunk);
        if (hash.digest('hex') !== artifact.blobs[0].sha256) {
          throw new Error('Source checksum differs from LMC; refusing to import changed weights.');
        }
        await createModel({ model, file: source.file, ollamaUrl: config.ollamaUrl, log });
        tags = (await clients.tags()).models;
        installed = tags.find(item => item.name === model);
        if (!installed) throw new Error('Ollama import finished but the model is absent from its registry.');
      }
      const details = await clients.show(model);
      if (typeof details.modelfile !== 'string' || !details.modelfile.split(/\r?\n/).some(line =>
        /^FROM\s/i.test(line) && line.includes(`sha256-${artifact.blobs[0].sha256}`))) {
        throw new Error('Ollama weight digest does not match LMC; the connection is not verified.');
      }
      const after = await fs.stat(source.file);
      if (after.size !== source.size || after.mtimeMs !== source.mtimeMs) throw new Error('Source changed during import; synchronization stopped.');
      if (sync) {
        state.models[artifact.artifact_id] = {
          model, artifactId: artifact.artifact_id, blobSha256: artifact.blobs[0].sha256,
          ollamaDigest: installed.digest, sourcePath: source.file, size: source.size, mtimeMs: source.mtimeMs,
          nodeId: health.node_id, verifiedAt: new Date().toISOString(),
        };
        await save(state);
      }
      results.push({ file: entry.name, artifactId: artifact.artifact_id, model, status: 'connected' });
      log(`[LMC] Connected: ${model}`);
    } catch (error) {
      errors.push({ file: entry.name, error: error.message });
      log(`[LMC] ERROR ${entry.name}: ${error.message}`);
    }
  }
  return { nodeId: health.node_id, results, errors };
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    url: { type: 'string' }, 'models-dir': { type: 'string' }, 'ollama-url': { type: 'string' },
  } });
  const command = positionals[0] || 'status';
  if (!['sync', 'status'].includes(command)) throw new Error('Use sync or status. See README_RUN.md.');
  const saved = await readJson(CONFIG, {});
  const config = configSchema.parse({ ...saved,
    ...(values.url ? { lmcUrl: localUrl(values.url) } : {}),
    ...(values['models-dir'] ? { modelsDir: path.resolve(values['models-dir']), nodeId: undefined } : {}),
    ollamaUrl: localUrl(values['ollama-url'] || saved.ollamaUrl || process.env.JC_OLLAMA_URL || 'http://127.0.0.1:11434'),
  });
  console.log(`[LMC] ${command}: ${config.lmcUrl} -> ${config.ollamaUrl}`);
  const state = await readJson(STATE, { models: {} });
  if (!state.models || typeof state.models !== 'object' || Array.isArray(state.models)) throw new Error('Invalid LMC mapping file.');
  let lock;
  const lockPath = path.join(DATA, 'lmc-sync.lock');
  try {
    if (command === 'sync') {
      await fs.mkdir(DATA, { recursive: true });
      lock = await fs.open(lockPath, 'wx');
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    }
    const report = await syncLibrary(config, { state, sync: command === 'sync', save: value => saveJson(STATE, value) });
    if (command === 'sync') {
      await saveJson(CONFIG, { ...config, nodeId: report.nodeId });
      await saveJson(path.join(DATA, 'lmc-last-sync.json'), { ...report, at: new Date().toISOString() });
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.errors.length || report.results.some(row => row.status !== 'connected')) process.exitCode = 1;
  } finally {
    if (lock) { await lock.close(); await fs.unlink(lockPath); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[LMC] ${error.message}`); process.exitCode = 1; });
}

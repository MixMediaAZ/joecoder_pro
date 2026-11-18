import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { localUrl, confinedFile, modelName, syncLibrary, clientsFor } from './lmc-bridge.mjs';
import http from 'node:http';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-lmc-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'Example Model.gguf');
  const bytes = Buffer.from('GGUFtest weights');
  await fs.writeFile(file, bytes);
  const artifact = { artifact_id: `sha256:${'a'.repeat(64)}`, format: 'gguf', quantization: 'Q4_K_M',
    aliases: ['Example Model'], blobs: [{ kind: 'weight', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }],
    locations: [{ path: file }] };
  let registered = [], tags = [], registrations = 0, creations = 0, saves = 0;
  const state = { models: {} };
  const config = { lmcUrl: 'http://127.0.0.1:12345', ollamaUrl: 'http://127.0.0.1:12346', modelsDir: directory };
  const clients = {
    health: async () => ({ ok: true, milestone: 'discovery-inbox', node_id: 'node-test' }),
    discovery: async () => ({ models_dir: directory }), artifacts: async () => registered,
    register: async () => { registrations++; registered = [artifact]; return artifact; },
    tags: async () => ({ models: tags }),
    show: async () => ({ modelfile: `FROM C:/models/blobs/sha256-${artifact.blobs[0].sha256}` }),
  };
  const options = { clients, state, log: () => {}, save: async () => { saves++; },
    createModel: async ({ model }) => { creations++; tags = [{ name: model, digest: 'manifest-1' }]; } };
  return { config, clients, options, artifact, file, directory, state,
    counts: () => ({ registrations, creations, saves }),
    setRegistered: () => { registered = [artifact]; }, setTags: value => { tags = value; } };
}

test('registers the source, verifies the runtime digest, and reuses it on a second sync', async t => {
  const f = await fixture(t);
  const first = await syncLibrary(f.config, f.options);
  assert.deepEqual(first.errors, []);
  assert.equal(first.results[0].status, 'connected');
  assert.equal(Object.keys(f.state.models).length, 1);
  await syncLibrary(f.config, f.options);
  assert.deepEqual(f.counts(), { registrations: 1, creations: 1, saves: 2 });
});

test('status is read-only and reports an unregistered model', async t => {
  const f = await fixture(t);
  const result = await syncLibrary(f.config, { ...f.options, sync: false });
  assert.equal(result.results[0].status, 'unregistered');
  assert.deepEqual(f.counts(), { registrations: 0, creations: 0, saves: 0 });
});

test('refuses another service on the configured port before any writes', async t => {
  const f = await fixture(t);
  f.clients.health = async () => ({ ok: true, product: 'Another App' });
  await assert.rejects(syncLibrary(f.config, f.options), /not Local Model Curator/);
  assert.equal(f.counts().registrations, 0);
});

test('rejects a different LMC node or library', async t => {
  const f = await fixture(t);
  await assert.rejects(syncLibrary({ ...f.config, nodeId: 'another-node' }, f.options), /identity changed/);
  f.clients.discovery = async () => ({ models_dir: os.tmpdir() });
  await assert.rejects(syncLibrary(f.config, f.options), /different model folder/);
});

test('refuses changed weights before invoking Ollama', async t => {
  const f = await fixture(t);
  f.setRegistered();
  f.artifact.blobs[0].sha256 = 'b'.repeat(64);
  const result = await syncLibrary(f.config, f.options);
  assert.match(result.errors[0].error, /checksum differs/);
  assert.equal(f.counts().creations, 0);
  assert.equal(f.counts().saves, 0);
});

test('does not overwrite a preexisting model with the wrong weight digest', async t => {
  const f = await fixture(t);
  f.setRegistered();
  f.setTags([{ name: modelName(f.artifact, f.file), digest: 'another-manifest' }]);
  f.clients.show = async () => ({ modelfile: `FROM /models/sha256-${'b'.repeat(64)}` });
  const result = await syncLibrary(f.config, f.options);
  assert.match(result.errors[0].error, /digest does not match/);
  assert.equal(f.counts().creations, 0);
  assert.equal(f.counts().saves, 0);
});

test('retains an explicit import error without marking the model connected', async t => {
  const f = await fixture(t);
  const result = await syncLibrary(f.config, { ...f.options, createModel: async () => { throw new Error('unsupported architecture'); } });
  assert.match(result.errors[0].error, /unsupported architecture/);
  assert.equal(result.results.length, 0);
  assert.deepEqual(f.state.models, {});
});

test('bounds imports to single GGUF files in the configured folder', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.directory, 'nested'));
  await assert.rejects(confinedFile(path.join(f.directory, 'nested'), f.file), /outside the configured/);
  const other = path.join(f.directory, 'image.safetensors');
  await fs.writeFile(other, 'not a chat model');
  await assert.rejects(confinedFile(f.directory, other), /Only GGUF/);
  const split = path.join(f.directory, 'model-00001-of-00002.gguf');
  await fs.writeFile(split, 'GGUF');
  await assert.rejects(confinedFile(f.directory, split), /complete-shard/);
  const bad = path.join(f.directory, 'bad.gguf');
  await fs.writeFile(bad, 'broken');
  await assert.rejects(confinedFile(f.directory, bad), /Invalid GGUF/);
});

test('accepts configurable loopback ports, rejects remote URLs and credentials', () => {
  assert.equal(localUrl('http://localhost:54321/'), 'http://localhost:54321');
  for (const value of ['https://example.com', 'http://192.168.1.2:8787', 'http://user:pass@localhost', 'http://localhost/api', 'http://localhost/#token']) {
    assert.throws(() => localUrl(value));
  }
});

test('HTTP client sends registration JSON and preserves service errors', async t => {
  let request;
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    request = { method: req.method, url: req.url, contentType: req.headers['content-type'], body: JSON.parse(text) };
    res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'path already registered' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(clientsFor({ lmcUrl: url, ollamaUrl: url }).register('D:/models/example.gguf'), /path already registered/);
  assert.equal(request.url, '/api/artifacts/import');
  assert.equal(request.method, 'POST');
  assert.equal(request.contentType, 'application/json');
  assert.equal(request.body.path, 'D:/models/example.gguf');
});

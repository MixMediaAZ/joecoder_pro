import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeGovernedTool, listGovernedTools, retryGovernedTool } from './governedTools.js';
import type { GovernedToolContext } from './governedToolTypes.js';

// Windows releases a terminated process's handles asynchronously: a fixture directory can stay
// locked for a few hundred milliseconds after the process that used it as its working directory
// has already exited. `force` suppresses ENOENT, not EBUSY, so an un-retried recursive remove
// fails here intermittently. This only makes teardown robust; it weakens no assertion, and a
// directory that is genuinely un-removable still fails the test once the retries are exhausted.
const REMOVE_FIXTURE = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 } as const;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function fixture(): Promise<{
  root: string;
  context: GovernedToolContext;
  evidence: unknown[];
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-governed-tools-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, '.snapshots'), { recursive: true });
  await fs.mkdir(path.join(root, '.artifacts'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app.ts'), 'export const value = 1;\n');
  await fs.writeFile(path.join(root, 'src', 'delete.ts'), 'delete me\n');
  await fs.writeFile(path.join(root, 'config.json'), '{\n  "feature": { "enabled": false }\n}\n');
  await fs.writeFile(path.join(root, '.env'), 'SECRET=do-not-read\n');
  await fs.writeFile(path.join(root, 'server.js'), 'setInterval(() => {}, 1000);\n');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'governed-tool-fixture',
    version: '1.0.0',
    scripts: {
      test: 'node -e "console.log(\'fixture test passed\')"',
      start: 'node server.js'
    }
  }, null, 2));
  const evidence: unknown[] = [];
  const context: GovernedToolContext = {
    projectId: 'proj-governed-tools',
    jobId: 'job-governed-tools',
    workOrderId: 'JC20-M2-999',
    projectRoot: root,
    snapshotsRoot: path.join(root, '.snapshots'),
    artifactsRoot: path.join(root, '.artifacts'),
    authority: {
      mode: 'mutating',
      exactPaths: ['src/app.ts', 'src/new.ts', 'src/moved.ts', 'src/delete.ts', 'config.json'],
      operations: ['edit_files', 'rename_files', 'delete_files', 'run_tests', 'run_app'],
      maxFiles: 5,
      maxChangedLines: 100,
      maxDurationMs: 120_000,
      maxOutputBytes: 256_000,
      allowDelete: true
    },
    async recordEvidence(content) {
      evidence.push(content);
      return { id: `EVC-tool-${evidence.length}` };
    }
  };
  return { root, context, evidence };
}

test('governed registry declares every required safety property and tool family', () => {
  const tools = listGovernedTools();
  const names = new Set(tools.map((tool) => tool.name));
  for (const required of [
    'files.list', 'files.search', 'files.read', 'files.metadata', 'memory.project_brain',
    'evidence.read', 'git.inspect', 'process.inspect', 'files.create', 'files.apply_exact_patch',
    'files.move', 'files.delete', 'config.update_json', 'project.run_check', 'project.format_check',
    'project.launch', 'project.stop', 'health.query', 'recovery.checkpoint', 'recovery.restore',
    'visual.capture', 'visual.inspect', 'visual.interact', 'visual.responsive', 'visual.accessibility', 'visual.compare'
  ]) assert.ok(names.has(required), `missing ${required}`);
  for (const tool of tools) {
    assert.ok(tool.timeoutMs > 0);
    assert.ok(tool.maxOutputBytes > 0);
    assert.match(tool.evidenceProducer, /^joecoder-governed-tool\//);
    assert.ok(['read_only', 'mutating'].includes(tool.authority));
    assert.ok(['not_applicable', 'snapshot', 'process_stop', 'idempotent'].includes(tool.reversibility));
  }
});

test('adversarial tool requests cannot escape scope, smuggle commands, widen authority, or delete silently', async () => {
  const { root, context } = await fixture();
  try {
    const readOnly = { ...context, authority: { ...context.authority, mode: 'read_only' as const } };
    const mutation = await executeGovernedTool({ name: 'files.create', input: { path: 'src/new.ts', content: 'x' } }, readOnly);
    assert.equal(mutation.ok, false);
    if (!mutation.ok) assert.equal(mutation.code, 'TOOL_MUTATION_NOT_AUTHORIZED');

    const traversal = await executeGovernedTool({ name: 'files.read', input: { path: '../outside.txt' } }, context);
    assert.equal(traversal.ok, false);
    if (!traversal.ok) assert.equal(traversal.code, 'TOOL_INPUT_INVALID');

    const unknownField = await executeGovernedTool({ name: 'files.read', input: { path: 'src/app.ts', command: 'whoami' } }, context);
    assert.equal(unknownField.ok, false);
    if (!unknownField.ok) assert.equal(unknownField.code, 'TOOL_INPUT_INVALID');

    const shellSmuggle = await executeGovernedTool({ name: 'project.run_check', input: { check: 'test', args: ['&&', 'whoami'] } }, context);
    assert.equal(shellSmuggle.ok, false);
    if (!shellSmuggle.ok) assert.equal(shellSmuggle.code, 'TOOL_INPUT_INVALID');

    const outsideScope = await executeGovernedTool({ name: 'files.create', input: { path: 'src/not-authorized.ts', content: 'x' } }, context);
    assert.equal(outsideScope.ok, false);
    if (!outsideScope.ok) assert.equal(outsideScope.code, 'TOOL_PATH_NOT_AUTHORIZED');

    const noDeleteAuthority = {
      ...context,
      authority: { ...context.authority, operations: context.authority.operations.filter((item) => item !== 'delete_files') }
    };
    const deletion = await executeGovernedTool({ name: 'files.delete', input: { path: 'src/delete.ts', confirmExactPath: 'src/delete.ts' } }, noDeleteAuthority);
    assert.equal(deletion.ok, false);
    if (!deletion.ok) assert.equal(deletion.code, 'TOOL_OPERATION_NOT_AUTHORIZED');
    assert.equal(await fs.readFile(path.join(root, 'src', 'delete.ts'), 'utf8'), 'delete me\n');

    const externalUrl = await executeGovernedTool({ name: 'health.query', input: { url: 'https://example.com' } }, context);
    assert.equal(externalUrl.ok, false);
    if (!externalUrl.ok) assert.equal(externalUrl.code, 'TOOL_INPUT_INVALID');
  } finally {
    await fs.rm(root, REMOVE_FIXTURE);
  }
});

test('authorized changes snapshot, apply exactly, move, delete, and restore without collateral writes', async () => {
  const { root, context, evidence } = await fixture();
  try {
    const before = await fs.readFile(path.join(root, 'src', 'app.ts'), 'utf8');
    const patchResult = await executeGovernedTool({
      name: 'files.apply_exact_patch',
      input: {
        path: 'src/app.ts',
        expectedSha256: hash(before),
        replacements: [{ oldText: 'value = 1', newText: 'value = 2' }]
      }
    }, context);
    assert.equal(patchResult.ok, true);
    assert.equal(await fs.readFile(path.join(root, 'src', 'app.ts'), 'utf8'), 'export const value = 2;\n');
    assert.ok(evidence.length >= 1);
    const patchSnapshot = String((patchResult.ok ? patchResult.summary as any : {}).snapshotId);

    const retry = await retryGovernedTool({ name: 'files.apply_exact_patch', input: {} }, context, {
      ok: false, tool: 'files.apply_exact_patch', durationMs: 1, evidenceId: null, outputHash: 'x', code: 'X', error: 'x'
    });
    assert.equal(retry.ok, false);
    if (!retry.ok) assert.equal(retry.code, 'TOOL_RETRY_NOT_IDEMPOTENT');

    const restoredPatch = await executeGovernedTool({ name: 'recovery.restore', input: { snapshotId: patchSnapshot } }, context);
    assert.equal(restoredPatch.ok, true);
    assert.equal(await fs.readFile(path.join(root, 'src', 'app.ts'), 'utf8'), before);

    const created = await executeGovernedTool({ name: 'files.create', input: { path: 'src/new.ts', content: 'new file\n' } }, context);
    assert.equal(created.ok, true);
    assert.equal(await fs.readFile(path.join(root, 'src', 'new.ts'), 'utf8'), 'new file\n');
    const createSnapshot = String((created.ok ? created.summary as any : {}).snapshotId);
    assert.equal((await executeGovernedTool({ name: 'recovery.restore', input: { snapshotId: createSnapshot } }, context)).ok, true);
    await assert.rejects(fs.stat(path.join(root, 'src', 'new.ts')), /ENOENT/);

    const moved = await executeGovernedTool({ name: 'files.move', input: { from: 'src/app.ts', to: 'src/moved.ts' } }, context);
    assert.equal(moved.ok, true);
    const moveSnapshot = String((moved.ok ? moved.summary as any : {}).snapshotId);
    assert.equal((await executeGovernedTool({ name: 'recovery.restore', input: { snapshotId: moveSnapshot } }, context)).ok, true);
    assert.equal(await fs.readFile(path.join(root, 'src', 'app.ts'), 'utf8'), before);
    await assert.rejects(fs.stat(path.join(root, 'src', 'moved.ts')), /ENOENT/);

    const deleted = await executeGovernedTool({ name: 'files.delete', input: { path: 'src/delete.ts', confirmExactPath: 'src/delete.ts' } }, context);
    assert.equal(deleted.ok, true);
    const deleteSnapshot = String((deleted.ok ? deleted.summary as any : {}).snapshotId);
    assert.equal((await executeGovernedTool({ name: 'recovery.restore', input: { snapshotId: deleteSnapshot } }, context)).ok, true);
    assert.equal(await fs.readFile(path.join(root, 'src', 'delete.ts'), 'utf8'), 'delete me\n');

    const config = await fs.readFile(path.join(root, 'config.json'), 'utf8');
    const configured = await executeGovernedTool({
      name: 'config.update_json',
      input: { path: 'config.json', expectedSha256: hash(config), updates: [{ pointer: '/feature/enabled', value: true }] }
    }, context);
    assert.equal(configured.ok, true);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8')).feature.enabled, true);
  } finally {
    await fs.rm(root, REMOVE_FIXTURE);
  }
});

test('allowlisted checks and governed process lifecycle execute without a model-supplied shell string', async () => {
  const { root, context } = await fixture();
  let handle: string | null = null;
  try {
    const checked = await executeGovernedTool({ name: 'project.run_check', input: { check: 'test' } }, context);
    assert.equal(checked.ok, true);
    if (checked.ok) assert.match(JSON.stringify(checked.summary), /fixture test passed/);

    const launched = await executeGovernedTool({ name: 'project.launch', input: { script: 'start' } }, context);
    assert.equal(launched.ok, true);
    handle = String((launched.ok ? launched.summary as any : {}).handle);
    assert.match(handle, /^proc-[a-f0-9]{16}$/);
    const stopped = await executeGovernedTool({ name: 'project.stop', input: { handle } }, context);
    assert.equal(stopped.ok, true);
    handle = null;
  } finally {
    if (handle) await executeGovernedTool({ name: 'project.stop', input: { handle } }, context);
    await fs.rm(root, REMOVE_FIXTURE);
  }
});

test('real browser tools capture, inspect, interact, check responsive layout, and compare pixels on loopback', async () => {
  const { root, context } = await fixture();
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="en"><title>Joe Tool Fixture</title><button id="change" onclick="document.body.dataset.changed=\'yes\';this.textContent=\'Changed\'">Change</button><script>console.log("fixture loaded")</script>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server did not bind');
    const url = `http://127.0.0.1:${address.port}/`;
    const captured = await executeGovernedTool({ name: 'visual.capture', input: { url, width: 800, height: 600 } }, context);
    assert.equal(captured.ok, true, captured.ok ? '' : captured.error);
    const capturePath = String((captured.ok ? captured.summary as any : {}).artifactPath);
    assert.ok((await fs.stat(capturePath)).size > 100);

    const inspected = await executeGovernedTool({ name: 'visual.inspect', input: { url, width: 800, height: 600 } }, context);
    assert.equal(inspected.ok, true, inspected.ok ? '' : inspected.error);
    if (inspected.ok) assert.match(JSON.stringify(inspected.summary), /fixture loaded/);

    const interacted = await executeGovernedTool({
      name: 'visual.interact',
      input: { url, width: 800, height: 600, interactions: [{ action: 'click', selector: '#change' }] }
    }, context);
    assert.equal(interacted.ok, true, interacted.ok ? '' : interacted.error);
    if (interacted.ok) {
      const interaction = (interacted.summary as any).interactions?.[0];
      assert.equal(interaction?.action, 'click');
      assert.equal(interaction?.selector, '#change');
      assert.equal(interaction?.after?.text, 'Changed');
    }

    const responsive = await executeGovernedTool({
      name: 'visual.responsive',
      input: { url, viewports: [{ width: 375, height: 667 }, { width: 1280, height: 800 }] }
    }, context);
    assert.equal(responsive.ok, true, responsive.ok ? '' : responsive.error);
    if (responsive.ok) assert.equal((responsive.summary as any).results.length, 2);

    const accessibility = await executeGovernedTool({
      name: 'visual.accessibility', input: { url, width: 800, height: 600 }
    }, context);
    assert.equal(accessibility.ok, true, accessibility.ok ? '' : accessibility.error);
    if (accessibility.ok) assert.equal((accessibility.summary as any).passed, true);

    const relativeCapture = path.relative(context.artifactsRoot, capturePath).replace(/\\/g, '/');
    const compared = await executeGovernedTool({
      name: 'visual.compare',
      input: { baselineArtifact: relativeCapture, actualArtifact: relativeCapture, threshold: 0, maxMismatchRatio: 0 }
    }, context);
    assert.equal(compared.ok, true, compared.ok ? '' : compared.error);
    if (compared.ok) {
      assert.equal((compared.summary as any).mismatchedPixels, 0);
      assert.equal((compared.summary as any).passed, true);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, REMOVE_FIXTURE);
  }
});


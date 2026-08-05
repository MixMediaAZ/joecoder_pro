import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MAX_PREVIEW_BYTES,
  ProjectFileAccessError,
  listProjectFiles,
  previewProjectFile
} from './projectExplorer.js';

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-explorer-'));
  await fs.mkdir(path.join(root, 'src', 'components'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true });
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export const ready = true;\n');
  await fs.writeFile(path.join(root, 'src', 'components', 'Button.tsx'), 'export function Button() { return null; }\n');
  await fs.writeFile(path.join(root, 'README.md'), '# Fixture\n');
  await fs.writeFile(path.join(root, '.env'), 'SECRET=never-preview\n');
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
  await fs.writeFile(path.join(root, 'node_modules', 'ignored', 'vendor.js'), 'ignored\n');
  return root;
}

test('project explorer lists folders first and hides dependency and VCS internals', async () => {
  const root = await fixture();
  try {
    const listing = await listProjectFiles(root);
    assert.equal(listing.readOnly, true);
    assert.equal(listing.entries[0]?.name, 'src');
    assert.equal(listing.entries.some(item => item.name === 'node_modules'), false);
    assert.equal(listing.entries.some(item => item.name === '.git'), false);
    assert.equal(listing.entries.find(item => item.name === '.env')?.protected, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('project explorer searches nested project files without searching protected trees', async () => {
  const root = await fixture();
  try {
    const result = await listProjectFiles(root, '', 'button');
    assert.deepEqual(result.entries.map(item => item.path), ['src/components/Button.tsx']);
    const ignored = await listProjectFiles(root, '', 'vendor');
    assert.equal(ignored.entries.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('text previews are bounded and report truncation honestly', async () => {
  const root = await fixture();
  try {
    const normal = await previewProjectFile(root, 'src/index.ts');
    assert.equal(normal.content, 'export const ready = true;\n');
    assert.equal(normal.readOnly, true);
    await fs.writeFile(path.join(root, 'large.txt'), 'x'.repeat(MAX_PREVIEW_BYTES + 50));
    const large = await previewProjectFile(root, 'large.txt');
    assert.equal(large.truncated, true);
    assert.equal(Buffer.byteLength(large.content), MAX_PREVIEW_BYTES);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('preview blocks traversal, secrets, binary files, and protected directories', async () => {
  const root = await fixture();
  try {
    const expected: Array<[string, string]> = [
      ['../outside.txt', 'PROJECT_PATH_ESCAPE'],
      ['.env', 'SENSITIVE_FILE_PREVIEW_BLOCKED'],
      ['binary.bin', 'BINARY_FILE_PREVIEW_BLOCKED'],
      ['node_modules/ignored/vendor.js', 'PROTECTED_PROJECT_PATH']
    ];
    for (const [relative, code] of expected) {
      await assert.rejects(
        () => previewProjectFile(root, relative),
        (error: unknown) => error instanceof ProjectFileAccessError && error.code === code
      );
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

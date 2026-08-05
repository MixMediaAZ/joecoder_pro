import fs from 'node:fs/promises';
import path from 'node:path';

export type StackKind = 'node' | 'flutter' | 'dart' | 'python' | 'rust' | 'dotnet' | 'go';
export type VerificationPurpose = 'build' | 'test' | 'lint' | 'analyze';

export interface StackVerificationCommand {
  purpose: VerificationPurpose;
  executable: string;
  args: string[];
  display: string;
}

export interface StackProfile {
  kind: StackKind;
  label: string;
  root: string;
  manifests: string[];
  commands: StackVerificationCommand[];
}

const PROTECTED_SEGMENT = /(^|\/)(node_modules|\.git|\.jc|dist|build|target|\.venv|venv)(\/|$)/i;

function normalizeRel(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function rootOf(relPath: string): string {
  const root = path.posix.dirname(normalizeRel(relPath));
  return root === '.' ? '.' : root;
}

function isInsideRoot(relPath: string, root: string): boolean {
  const rel = normalizeRel(relPath);
  return root === '.' || rel === root || rel.startsWith(`${root}/`);
}

async function readText(projectRoot: string, relPath: string, maxBytes = 128 * 1024): Promise<string> {
  try {
    const buffer = await fs.readFile(path.resolve(projectRoot, relPath));
    if (buffer.includes(0)) return '';
    return buffer.toString('utf8', 0, Math.min(buffer.length, maxBytes));
  } catch {
    return '';
  }
}

function hasDirectory(files: string[], root: string, directory: string): boolean {
  const prefix = root === '.' ? `${directory}/` : `${root}/${directory}/`;
  return files.some((file) => normalizeRel(file).toLowerCase().startsWith(prefix.toLowerCase()));
}

async function nodeProfile(projectRoot: string, manifest: string): Promise<StackProfile> {
  const root = rootOf(manifest);
  const commands: StackVerificationCommand[] = [];
  try {
    const pkg = JSON.parse(await readText(projectRoot, manifest)) as { scripts?: Record<string, unknown> };
    const scripts = pkg.scripts || {};
    if (typeof scripts.build === 'string' && scripts.build.trim()) {
      commands.push({ purpose: 'build', executable: 'npm', args: ['run', 'build', '--silent'], display: 'npm run build' });
    }
    if (typeof scripts.test === 'string' && scripts.test.trim() && !scripts.test.includes('no test specified')) {
      commands.push({ purpose: 'test', executable: 'npm', args: ['run', 'test', '--silent'], display: 'npm run test' });
    }
    if (!commands.length && typeof scripts.check === 'string' && scripts.check.trim()) {
      commands.push({ purpose: 'analyze', executable: 'npm', args: ['run', 'check', '--silent'], display: 'npm run check' });
    }
  } catch {
    // Invalid manifests remain survey evidence; executable commands are not invented.
  }
  return { kind: 'node', label: 'Node.js', root, manifests: [normalizeRel(manifest)], commands };
}

async function profileForManifest(projectRoot: string, files: string[], manifest: string): Promise<StackProfile | null> {
  const rel = normalizeRel(manifest);
  const name = path.posix.basename(rel).toLowerCase();
  const root = rootOf(rel);
  if (name === 'package.json') return nodeProfile(projectRoot, rel);

  if (name === 'pubspec.yaml') {
    const pubspec = await readText(projectRoot, rel);
    const flutter = /(^|\n)\s*flutter\s*:/m.test(pubspec)
      || /sdk\s*:\s*flutter/i.test(pubspec)
      || hasDirectory(files, root, 'android')
      || hasDirectory(files, root, 'ios');
    return flutter
      ? { kind: 'flutter', label: 'Flutter', root, manifests: [rel], commands: [
          { purpose: 'analyze', executable: 'flutter', args: ['analyze'], display: 'flutter analyze' },
          ...(hasDirectory(files, root, 'test') ? [{ purpose: 'test' as const, executable: 'flutter', args: ['test'], display: 'flutter test' }] : [])
        ] }
      : { kind: 'dart', label: 'Dart', root, manifests: [rel], commands: [
          { purpose: 'analyze', executable: 'dart', args: ['analyze'], display: 'dart analyze' },
          ...(hasDirectory(files, root, 'test') ? [{ purpose: 'test' as const, executable: 'dart', args: ['test'], display: 'dart test' }] : [])
        ] };
  }

  if (name === 'pyproject.toml' || name === 'requirements.txt' || name === 'setup.py') {
    return { kind: 'python', label: 'Python', root, manifests: [rel], commands: [
      { purpose: 'analyze', executable: 'python', args: ['-m', 'compileall', '-q', '.'], display: 'python -m compileall -q .' },
      ...(hasDirectory(files, root, 'tests') || hasDirectory(files, root, 'test')
        ? [{ purpose: 'test' as const, executable: 'python', args: ['-m', 'pytest', '-q'], display: 'python -m pytest -q' }]
        : [])
    ] };
  }

  if (name === 'cargo.toml') return { kind: 'rust', label: 'Rust', root, manifests: [rel], commands: [
    { purpose: 'build', executable: 'cargo', args: ['check', '--quiet'], display: 'cargo check' },
    { purpose: 'test', executable: 'cargo', args: ['test', '--quiet'], display: 'cargo test' }
  ] };
  if (name === 'go.mod') return { kind: 'go', label: 'Go', root, manifests: [rel], commands: [
    { purpose: 'test', executable: 'go', args: ['test', './...'], display: 'go test ./...' }
  ] };
  if (name.endsWith('.sln') || name.endsWith('.csproj')) {
    const solution = files.find((file) => rootOf(file) === root && file.toLowerCase().endsWith('.sln'));
    return { kind: 'dotnet', label: '.NET', root, manifests: [normalizeRel(solution || rel)], commands: [
      { purpose: 'build', executable: 'dotnet', args: ['build', '--nologo'], display: 'dotnet build' },
      ...(files.some((file) => isInsideRoot(file, root) && /test/i.test(path.posix.basename(file)) && file.toLowerCase().endsWith('.csproj'))
        ? [{ purpose: 'test' as const, executable: 'dotnet', args: ['test', '--no-build', '--nologo'], display: 'dotnet test --no-build' }]
        : [])
    ] };
  }
  return null;
}

/** Deterministic stack discovery. Models never supply executable shell text. */
export async function discoverStackProfiles(projectRoot: string, relFiles: string[]): Promise<StackProfile[]> {
  const files = relFiles.map(normalizeRel).filter((file) => !PROTECTED_SEGMENT.test(file));
  const manifests = files.filter((file) => {
    const name = path.posix.basename(file).toLowerCase();
    return name === 'package.json' || name === 'pubspec.yaml' || name === 'pyproject.toml'
      || name === 'requirements.txt' || name === 'setup.py' || name === 'cargo.toml'
      || name === 'go.mod' || name.endsWith('.sln') || name.endsWith('.csproj');
  });
  const profiles: StackProfile[] = [];
  const seen = new Set<string>();
  for (const manifest of manifests) {
    const profile = await profileForManifest(projectRoot, files, manifest);
    if (!profile) continue;
    const key = `${profile.kind}:${profile.root}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push(profile);
  }
  return profiles.sort((a, b) => a.root === '.' ? -1 : b.root === '.' ? 1 : a.root.localeCompare(b.root));
}

export function profilesForEditedFiles(profiles: StackProfile[], editedRelPaths: string[]): StackProfile[] {
  if (!editedRelPaths.length) return profiles.slice(0, 2);
  const selected = profiles.filter((profile) => editedRelPaths.some((file) => isInsideRoot(file, profile.root)));
  return (selected.length ? selected : profiles)
    .sort((a, b) => b.root.length - a.root.length)
    .filter((profile, index, all) => index === all.findIndex((item) => item.kind === profile.kind && item.root === profile.root))
    .slice(0, 2);
}

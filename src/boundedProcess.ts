import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ResolvedCommand {
  executable: string;
  prefixArgs: string[];
}

export interface BoundedProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  launchError: string;
}

export function resolveCommand(name: string): ResolvedCommand {
  if (process.platform !== 'win32' || path.isAbsolute(name)) return { executable: name, prefixArgs: [] };
  const pathValue = process.env.Path || process.env.PATH || '';
  for (const extension of ['.exe', '.bat', '.cmd']) {
    for (const directory of pathValue.split(path.delimiter)) {
      if (!directory) continue;
      const candidate = path.join(directory, name + extension);
      try {
        fs.accessSync(candidate);
        return extension === '.exe'
          ? { executable: candidate, prefixArgs: [] }
          : { executable: process.env.ComSpec || 'cmd.exe', prefixArgs: ['/d', '/s', '/c', candidate] };
      } catch { /* continue searching */ }
    }
  }
  return { executable: name, prefixArgs: [] };
}

function appendBounded(current: string, chunk: Buffer | string, maxCharacters: number): string {
  const combined = current + chunk.toString();
  return combined.length <= maxCharacters ? combined : combined.slice(-maxCharacters);
}

export async function runBoundedProcess(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
    maxOutputCharacters?: number;
  }
): Promise<BoundedProcessResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const maxOutputCharacters = options.maxOutputCharacters ?? 512_000;
    let stdout = '';
    let stderr = '';
    let launchError = '';
    let timedOut = false;
    let settled = false;
    let forceTimer: NodeJS.Timeout | null = null;
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk, maxOutputCharacters); });
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk, maxOutputCharacters); });
    child.on('error', (error) => { launchError = error.message; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    }, options.timeoutMs);
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      resolve({
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        launchError
      });
    };
    child.on('close', (code) => finish(code));
    child.on('error', () => finish(null));
  });
}

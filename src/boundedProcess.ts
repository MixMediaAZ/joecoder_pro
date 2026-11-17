import { randomUUID } from 'node:crypto';
import { appendAgentJobJournal, appendAgentJobEvent } from './database/database.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { redactProcessOutput } from './processPolicy.js';
import { currentAgentJobId, checkWorkflow, reserveToolAction } from './agentWorkflowBudget.js';
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
  cancelled?: boolean;
  outputTruncated?: boolean;
}

export function resolveCommand(name: string): ResolvedCommand {
  if (process.platform !== 'win32' || path.isAbsolute(name)) return { executable: name, prefixArgs: [] };
  const pathValue = process.env.Path || process.env.PATH || '';
  if (name === 'npm') {
    const candidates = [process.env.npm_execpath,
      path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ...pathValue.split(path.delimiter).map(dir => path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'))];
    for (const candidate of candidates) if (candidate && fs.existsSync(candidate)) return { executable: process.execPath, prefixArgs: [candidate] };
  }
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

export async function terminateOwnedProcess(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { killer.kill(); reject(new Error('PROCESS_STOP_TIMEOUT')); }, 10_000);
      killer.once('error', error => { clearTimeout(timer); reject(error); });
      killer.once('close', code => { clearTimeout(timer); code === 0 || child.exitCode !== null ? resolve() : reject(new Error('PROCESS_STOP_FAILED')); });
    });
    // taskkill's exit does not mean all inherited pipe handles have closed yet.
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.removeListener('close', closed); reject(new Error('PROCESS_STOP_NOT_CONFIRMED')); }, 5000);
      const closed = () => { clearTimeout(timer); resolve(); };
      child.once('close', closed);
    });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        resolve();
      }, 1500);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }
}

export async function runBoundedProcess(
  executable: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv; maxOutputCharacters?: number; profile?: { script: string; scriptHash: string; packageRoot: string }; signal?: AbortSignal; onOutput?: (output: { stdout: string; stderr: string }) => void }
): Promise<BoundedProcessResult> {
  const jobId = currentAgentJobId();
  checkWorkflow(jobId);
  options.signal?.throwIfAborted();
  reserveToolAction();
  const commandId = 'command-' + randomUUID();
  if (jobId) appendAgentJobJournal({ jobId, kind: 'tool_request', stage: 'verify', actionKey: commandId,
    payload: { command: executable, args, cwd: options.cwd, timeoutMs: options.timeoutMs, profile: options.profile } });
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const maxCharacters = options.maxOutputCharacters ?? 512_000;
    let stdout = '', stderr = '', launchError = '', timedOut = false, cancelled = false, settled = false, outputTruncated = false;
    const child = spawn(executable, args, {
      cwd: options.cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      env: options.env, stdio: ['ignore', 'pipe', 'pipe']
    });
    const append = (current: string, chunk: Buffer) => {
      if (current.length + chunk.toString().length > maxCharacters) outputTruncated = true;
      return appendBounded(current, chunk, maxCharacters);
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearInterval(poll); clearInterval(outputTimer);
      options.signal?.removeEventListener('abort', cancel);
      const clean = { stdout: redactProcessOutput(stdout), stderr: redactProcessOutput(stderr) };
      const result = { exitCode, timedOut, cancelled, outputTruncated, durationMs: Date.now() - startedAt, ...clean, launchError: redactProcessOutput(launchError) };
      try {
      if (jobId) {
        appendAgentJobJournal({ jobId, kind: 'tool_result', stage: 'verify', actionKey: commandId,
          payload: { command: executable, args, cwd: options.cwd, ...result } });
        appendAgentJobEvent({ jobId, stage: 'verify', kind: exitCode === 0 && !timedOut && !cancelled ? 'result' : 'failure',
          what: cancelled ? 'Command stopped.' : timedOut ? 'Command timed out.' : 'Command finished with exit code ' + exitCode + '.',
          meaning: [executable, ...args].join(' '), next: 'Evaluate the recorded output.',
          payload: { category: 'Checked', commandId, exitCode, timedOut, cancelled } });
      }
      options.onOutput?.(clean);
      resolve(result);
      } catch (error) { reject(error); }
    };
    let outputEvents = 0, lastOutput = '';
    const outputTimer = setInterval(() => {
      if (settled || !jobId || outputEvents >= 30) return;
      const output = redactProcessOutput(stdout + '\n' + stderr).slice(-2000);
      if (!output.trim() || output === lastOutput) return;
      lastOutput = output; outputEvents++;
      try {
        appendAgentJobEvent({ jobId, stage: 'verify', kind: 'progress', what: 'Command output',
          meaning: output, next: 'Waiting for the command to finish.', payload: { category: 'Checking', commandId, output } });
      } catch (error) { launchError = 'COMMAND_PROGRESS_RECORD_FAILED: ' + String(error); cancelled = true; stop(); }
    }, 2000);
    outputTimer.unref();
    let stopping = false;
    const stop = () => {
      if (stopping || settled) return;
      stopping = true;
      void terminateOwnedProcess(child).catch(error => { launchError = String(error); child.kill(); }).finally(() => {
        // A surviving descendant can hold inherited pipes. Do not wait forever.
        const grace = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(child.exitCode); }, 1500);
        grace.unref();
      });
    };
    const cancel = () => { cancelled = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, Math.max(1, options.timeoutMs));
    const poll = setInterval(() => {
      if (!jobId) return;
      try { checkWorkflow(jobId); } catch { cancel(); }
    }, 250);
    poll.unref();
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    child.once('close', finish);
    child.once('error', error => { launchError = error.message; finish(null); });
  });
}

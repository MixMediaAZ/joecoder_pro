import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { checkWorkflow, reserveToolAction } from './agentWorkflowBudget.js';
import { projectProcessEnvironment, redactProcessOutput } from './processPolicy.js';
import { resolveCommand, terminateOwnedProcess } from './boundedProcess.js';
import type { VerificationItem } from './verification.js';

/** Independent transport/startup proof; semantic feature tests remain separately required. */
export async function verifyWebStartup(projectRoot: string, timeoutMs = 20000, options: { requireHtml?: boolean; readRoutes?: string[]; windowsLauncher?: boolean } = {}): Promise<VerificationItem> {
  const started = Date.now();
  const output: string[] = [];
  const result: VerificationItem = { script: 'analyze', command: 'web-startup-smoke', root: '.', exitCode: 1,
    timedOut: false, passed: false, outputTail: output };
  const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  if (!manifest.scripts?.start) { output.push('WEB_START_REQUIRED: package.json has no start script.'); return result; }
  if (options.windowsLauncher) {
    result.command = 'windows-launcher-smoke';
    const launcher = await fs.readFile(path.join(projectRoot, 'start.bat'), 'utf8');
    if (/^\s*start\s|\bStart-Process\b/im.test(launcher)) {
      output.push('WINDOWS_LAUNCHER_DETACHED: keep the application attached to its launcher so verification can stop the owned process tree.');
      return result;
    }
  }
  checkWorkflow(); reserveToolAction();
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-web-smoke-'));
  const command = resolveCommand('npm');
  const executable = options.windowsLauncher ? (process.env.ComSpec || 'cmd.exe') : command.executable;
  const args = options.windowsLauncher ? ['/d', '/c', `call "${path.join(projectRoot, 'start.bat')}"`] : [...command.prefixArgs, 'run', 'start', '--silent'];
  const child = spawn(executable, args, {
    cwd: options.windowsLauncher ? os.tmpdir() : projectRoot, shell: false, windowsHide: true, detached: process.platform !== 'win32',
    windowsVerbatimArguments: options.windowsLauncher === true,
    env: projectProcessEnvironment({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, NODE_ENV: 'production' }), stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '', launchError = '';
  child.stdout.on('data', chunk => { logs = (logs + chunk.toString()).slice(-12000); });
  child.stderr.on('data', chunk => { logs = (logs + chunk.toString()).slice(-12000); });
  child.once('error', error => { launchError = error.message; });
  const deadline = started + timeoutMs;
  const controller = new AbortController();
  const poll = setInterval(() => { try { checkWorkflow(); } catch (error) { controller.abort(error); } }, 200);
  const get = async (url: URL) => {
    checkWorkflow();
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, Math.min(3000, deadline - Date.now())))]) });
    if (!response.ok) throw new Error(`WEB_HTTP_FAILED: ${url.pathname} returned ${response.status}`);
    const reader = response.body?.getReader(); let text = '';
    if (reader) try { for (;;) { const chunk = await reader.read(); if (chunk.done) break;
      text += Buffer.from(chunk.value).toString('utf8'); if (text.length > 512000) throw new Error('WEB_RESPONSE_TOO_LARGE');
    } } finally { await reader.cancel(); }
    return { response, text };
  };
  try {
    let base: URL | undefined;
    while (Date.now() < deadline) {
      checkWorkflow();
      if (launchError || child.exitCode !== null) throw new Error(`WEB_START_FAILED: ${launchError || 'process exited ' + child.exitCode}`);
      const match = logs.match(/http:\/\/(?:127\.0\.0\.1|localhost):(\d{1,5})(?:\/|\b)/);
      if (match && Number(match[1]) > 0 && Number(match[1]) <= 65535) { base = new URL(`http://127.0.0.1:${match[1]}/`); break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!base) { result.timedOut = true; throw new Error('WEB_URL_MISSING: honor PORT=0 and print the actual listening loopback URL from server.address().port.'); }
    if (options.requireHtml !== false) {
    const page = await get(base);
    if (!/text\/html/i.test(page.response.headers.get('content-type') || '') || !/<(?:html|!doctype html)\b/i.test(page.text)) throw new Error('WEB_HTML_REQUIRED: main route must serve an HTML document with text/html.');
    output.push(`GET /: ${page.response.status} text/html`);
    const assets = [...page.text.matchAll(/<(script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)]
      .filter(match => match[1]!.toLowerCase() === 'script' || /\brel\s*=\s*["']stylesheet["']/i.test(match[0]));
    if (assets.length > 20) throw new Error('WEB_ASSET_LIMIT: too many startup assets for bounded smoke verification.');
    for (const asset of assets) {
      const url = new URL(asset[2]!, base);
      if (url.origin !== base.origin) { output.push(`External asset not verified: ${url.origin}`); continue; }
      const loaded = await get(url);
      const type = loaded.response.headers.get('content-type') || '';
      if (!loaded.text.trim() || (asset[1]!.toLowerCase() === 'script' ? !/(?:java|ecma)script/i.test(type) : !/text\/css/i.test(type))) throw new Error(`WEB_ASSET_INVALID: ${url.pathname} has missing content or incorrect MIME type ${type}`);
      output.push(`GET ${url.pathname}: ${loaded.response.status} ${type}`);
    }
    }
    for (const route of options.readRoutes || []) {
      const url = new URL(route, base);
      if (!route.startsWith('/api/') || url.origin !== base.origin) throw new Error('API_ROUTE_OUTSIDE_LOCAL_AUTHORITY');
      const loaded = await get(url);
      if (!/application\/(?:[\w.+-]+\+)?json/i.test(loaded.response.headers.get('content-type') || '')) throw new Error(`API_JSON_REQUIRED: ${route} did not return JSON.`);
      JSON.parse(loaded.text);
      output.push(`GET ${route}: ${loaded.response.status} valid JSON`);
    }
    if (child.exitCode !== null || controller.signal.aborted) throw new Error('WEB_PROCESS_STOPPED');
    result.passed = true; result.exitCode = 0;
  } catch (error) { output.push(String(error)); }
  finally {
    clearInterval(poll);
    try { await terminateOwnedProcess(child); } catch (error) { result.passed = false; result.exitCode = 1; output.push(`WEB_STOP_FAILED: ${error}`); }
    const lines = redactProcessOutput(logs).trim().split(/\r?\n/);
    output.push(...(lines.length <= 24 ? lines : [...lines.slice(0, 12), '... output omitted ...', ...lines.slice(-12)]));
    if (!result.passed && options.windowsLauncher) output.push('The verifier invoked start.bat from a different working folder. Resolve relative app paths by changing into the batch file directory (cd /d "%~dp0") before launching.');
    result.durationMs = Date.now() - started;
  }
  return result;
}

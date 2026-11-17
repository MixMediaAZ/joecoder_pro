import path from 'node:path';
import os from 'node:os';

/** Environment variables that locate runtimes, never application credentials. */
export function projectProcessEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const names = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'WINDIR',
    'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'PROGRAMW6432', 'LOCALAPPDATA', 'APPDATA',
    'USERPROFILE', 'PUBLIC', 'TEMP', 'TMP', 'HOME', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (names.has(key.toUpperCase())) env[key] = value;
  const systemPath = process.env.Path || process.env.PATH || '';
  env.PATH = path.dirname(process.execPath) + path.delimiter + systemPath;
  if (process.platform === 'win32') env.Path = env.PATH;
  return { ...env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', NODE_ENV: 'test',
    npm_config_yes: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
    PYTHONDONTWRITEBYTECODE: '1', PYTHONPYCACHEPREFIX: path.join(os.tmpdir(), 'jc-python-fresh-cache', process.pid + '-' + Date.now()),
    ...extra };
}
export function redactProcessOutput(value: string): string {
  let safe = value;
  for (const [name, secret] of Object.entries(process.env)) {
    if (/key|token|secret|password|cookie|authorization/i.test(name) && secret && secret.length >= 8) safe = safe.split(secret).join('[redacted]');
  }
  return safe.replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s"']+/gi, '$1[redacted]');
}

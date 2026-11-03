import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolveJailedPath } from './mutation.js';
import { MAX_PREVIEW_BYTES, ProjectFileAccessError, sensitiveName } from './projectExplorer.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fail = (code: string, status: number, message: string): never => { throw new ProjectFileAccessError(code, status, message); };
export const operatorEditorAvailable = process.platform === 'win32';
export function operatorRoot(root: string) { return realpathSync(root).replace(/\\/g, '/').toLowerCase(); }
export function overlappingRoots(a: string, b: string) { return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }

async function targetFile(root: string, relative: string) {
  if (relative.split(/[\\/]/).some(sensitiveName)) fail('EDITOR_PROTECTED', 403, 'This path may contain secrets and cannot be edited here.');
  let target: string;
  try { target = resolveJailedPath(await fs.realpath(root), relative); }
  catch { return fail('EDITOR_PATH_BLOCKED', 403, 'Choose an existing, unlinked file inside this project.'); }
  const stat = await fs.lstat(target).catch(() => fail('EDITOR_NOT_FOUND', 404, 'The file no longer exists.'));
  if (!stat.isFile() || stat.nlink !== 1) fail('EDITOR_LINK_BLOCKED', 403, 'Only regular files with one link can be edited.');
  if (stat.size > MAX_PREVIEW_BYTES) fail('EDITOR_TOO_LARGE', 413, 'The editor supports files up to 256 KB.');
  const bytes = await fs.readFile(target);
  if (bytes.length > MAX_PREVIEW_BYTES) fail('EDITOR_TOO_LARGE', 413, 'The file grew beyond the editor limit.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return fail('EDITOR_ENCODING', 415, 'This editor requires UTF-8 text.'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) fail('EDITOR_BINARY', 415, 'Binary files cannot be edited as text.');
  const crlf = text.includes('\r\n');
  if (/\r(?!\n)/.test(text) || (crlf && /(?<!\r)\n/.test(text))) fail('EDITOR_LINE_ENDINGS', 415, 'This file has mixed line endings. Use an external editor to preserve them.');
  return { target, bytes, content: text.replace(/\r\n/g, '\n'), sha256: hash(bytes), lineEnding: crlf ? 'crlf' as const : 'lf' as const };
}

export async function readOperatorFile(root: string, relative: string) {
  const file = await targetFile(root, relative);
  return { path: relative, content: file.content, sha256: file.sha256, lineEnding: file.lineEnding, size: file.bytes.length, editable: operatorEditorAvailable };
}

// The helper is fixed code. Paths/content arrive through JSON stdin, never shell
// interpolation. FileShare.Read denies other writers and replacements for the
// entire compare/backup/write/verify interval, including handles already open.
const lockedWriteScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$file = $null
$before = $null
$writing = $false
function Digest([byte[]]$bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}
function DurableWrite([string]$target, [byte[]]$bytes) {
  $out = [IO.FileStream]::new($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $out.Write($bytes, 0, $bytes.Length); $out.Flush($true) } finally { $out.Dispose() }
}
function ReadBytes($stream) {
  if ($stream.Length -gt 262144) { throw 'EDITOR_TOO_LARGE' }
  $stream.Position = 0
  $bytes = [byte[]]::new([int]$stream.Length)
  $offset = 0
  while ($offset -lt $bytes.Length) {
    $n = $stream.Read($bytes, $offset, $bytes.Length - $offset)
    if ($n -eq 0) { throw 'EDITOR_READ_FAILED' }
    $offset += $n
  }
  return ,$bytes
}
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class EditorHandleInfo {
  [StructLayout(LayoutKind.Sequential)] public struct Info {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created;
    public System.Runtime.InteropServices.ComTypes.FILETIME Accessed;
    public System.Runtime.InteropServices.ComTypes.FILETIME Written;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
}
'@
  $file = [IO.FileStream]::new($p.target, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
  $info = New-Object EditorHandleInfo+Info
  if (-not [EditorHandleInfo]::GetFileInformationByHandle($file.SafeFileHandle, [ref]$info) -or $info.Links -ne 1) { throw 'EDITOR_LINK_BLOCKED' }
  # Recheck each path component after acquiring the handle. Reparse points
  # (including junctions) are unavailable even if they resolve inside the root.
  $item = [IO.FileInfo]::new($p.target)
  while ($null -ne $item) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'EDITOR_LINK_BLOCKED' }
    $item = if ($item -is [IO.FileInfo]) { $item.Directory } else { $item.Parent }
  }
  $before = ReadBytes $file
  if ((Digest $before) -ne $p.expectedSha256) { throw 'EDITOR_CONFLICT' }
  $after = [Convert]::FromBase64String($p.content)
  DurableWrite $p.backup $before
  DurableWrite $p.intent ([Text.Encoding]::UTF8.GetBytes(($p.receipt | ConvertTo-Json -Compress)))
  $writing = $true
  $file.Position = 0
  $file.Write($after, 0, $after.Length)
  $file.SetLength($after.Length)
  $file.Flush($true)
  if ((Digest (ReadBytes $file)) -ne $p.receipt.afterSha256) { throw 'EDITOR_VERIFY_FAILED' }
  DurableWrite $p.result ([Text.Encoding]::UTF8.GetBytes('{"status":"saved"}'))
  [Console]::Out.Write('{"ok":true}')
} catch {
  $code = if ($_.Exception.Message -match '^EDITOR_[A-Z_]+$') { $_.Exception.Message } else { 'EDITOR_IO_BLOCKED' }
  if ($writing -and $null -ne $file -and $null -ne $before) {
    try {
      $file.Position = 0; $file.Write($before, 0, $before.Length); $file.SetLength($before.Length); $file.Flush($true)
      if ((Digest (ReadBytes $file)) -ne $p.expectedSha256) { throw 'Restore verification failed' }
    } catch { $code = 'EDITOR_RECOVERY_REQUIRED' }
  }
  [Console]::Out.Write((@{ok=$false;code=$code} | ConvertTo-Json -Compress))
} finally { if ($null -ne $file) { $file.Dispose() } }
`;

interface Receipt { id: string; projectId: string; root: string; path: string; beforeSha256: string; afterSha256: string; createdAt: string; actor: 'operator'; sessionId: string }
export async function saveOperatorFile(input: { root: string; projectId: string; relative: string; expectedSha256: string; content: string; lineEnding: 'lf' | 'crlf'; sessionId: string; storage: string }) {
  if (!operatorEditorAvailable) fail('EDITOR_PLATFORM', 503, 'Locked file saving is currently available on Windows only.');
  if (!/^[a-f0-9]{64}$/.test(input.expectedSha256)) fail('EDITOR_HASH_REQUIRED', 400, 'Reopen the file before saving.');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.content) || input.content.includes('\r')) fail('EDITOR_TEXT_REQUIRED', 400, 'Save requires plain text with normalized line endings.');
  const current = await targetFile(input.root, input.relative);
  if (current.sha256 !== input.expectedSha256) fail('EDITOR_CONFLICT', 409, 'The file changed on disk. Review the current version before saving. Your draft is retained.');
  const bytes = Buffer.from(input.lineEnding === 'crlf' ? input.content.replace(/\n/g, '\r\n') : input.content, 'utf8');
  if (bytes.length > MAX_PREVIEW_BYTES) fail('EDITOR_TOO_LARGE', 413, 'The editor supports files up to 256 KB.');
  const afterSha256 = hash(bytes);
  if (afterSha256 === current.sha256) return { saved: false, sha256: current.sha256, recoveryId: null };
  const id = `edit-${randomUUID()}`;
  const directory = path.join(input.storage, id);
  await fs.mkdir(directory, { recursive: true });
  const receipt: Receipt = { id, projectId: input.projectId, root: operatorRoot(input.root), path: input.relative, beforeSha256: current.sha256, afterSha256, createdAt: new Date().toISOString(), actor: 'operator', sessionId: input.sessionId };
  const payload = { target: current.target, expectedSha256: input.expectedSha256, content: bytes.toString('base64'), backup: path.join(directory, 'before.bin'), intent: path.join(directory, 'intent.json'), result: path.join(directory, 'result.json'), receipt };
  const result = await new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', lockedWriteScript], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let stderr = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 2000); });
    child.once('error', reject);
    child.stdin.on('error', () => { /* Spawn/exit handlers report the failure. */ });
    child.once('close', code => {
      try { resolve(JSON.parse(output)); }
      catch { console.warn('[operator.files] Locked save helper exited without a receipt', code, stderr.slice(0, 200)); resolve({ ok: false, code: 'EDITOR_RECOVERY_REQUIRED' }); }
    });
    // Never kill a writer on an arbitrary timer: it must close its locked handle
    // and complete rollback. There is no network/model work in this helper.
    child.stdin.end(JSON.stringify(payload));
  });
  if (!result.ok) {
    const conflict = result.code === 'EDITOR_CONFLICT';
    console.warn('[operator.files] Save rejected', input.projectId, input.relative, result.code, id);
    fail(result.code || 'EDITOR_SAVE_FAILED', conflict ? 409 : 423, conflict
      ? 'The file changed on disk. Your draft is retained; review the current version.'
      : `Save did not complete. The file may be locked or unavailable. Keep your draft. Recovery reference: ${id}.`);
  }
  console.info('[operator.files] Saved', input.projectId, input.relative, id);
  return { saved: true, sha256: afterSha256, recoveryId: id };
}

export async function readOperatorRecovery(storage: string, id: string, projectId: string, root: string, relative: string) {
  if (!/^edit-[a-f0-9-]{36}$/.test(id)) fail('EDITOR_RECOVERY_NOT_FOUND', 404, 'Save recovery record not found.');
  const directory = path.join(storage, id);
  const receipt = JSON.parse(await fs.readFile(path.join(directory, 'intent.json'), 'utf8')) as Receipt;
  const result = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8'));
  if (result.status !== 'saved' || receipt.projectId !== projectId || receipt.root !== operatorRoot(root) || receipt.path !== relative || receipt.id !== id) fail('EDITOR_RECOVERY_BLOCKED', 403, 'This recovery record does not belong to the selected file.');
  const bytes = await fs.readFile(path.join(directory, 'before.bin'));
  if (hash(bytes) !== receipt.beforeSha256) fail('EDITOR_RECOVERY_CORRUPT', 409, 'The saved backup failed its integrity check.');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return { content: text.replace(/\r\n/g, '\n'), lineEnding: text.includes('\r\n') ? 'crlf' as const : 'lf' as const, expectedSha256: receipt.afterSha256 };
}

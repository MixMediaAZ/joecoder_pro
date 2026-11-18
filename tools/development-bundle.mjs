// Development snapshots have their own evidence and hashes. They are not signed releases.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const directories = ['src', 'dist', 'public', 'frontend', 'schemas', 'tools', 'acceptance-fixtures', 'plan', 'docs'];
const rootFiles = ['package.json', 'package-lock.json', 'tsconfig.json', 'start.bat', 'README.md', 'README_RUN.md',
  'SUPPORTED_CAPABILITIES.md', 'WORKFLOW_GUIDE.md', 'AGENTS.md', 'CAPABILITY_CERTIFICATION.md'];
const excludedDirectories = new Set(['node_modules', '.git', '.jc', '.next', '__pycache__', '.venv', 'venv', 'logs']);
const excludedFile = name => /^\.env(?:\.|$)/i.test(name) || /(?:\.pem|\.key|\.sqlite3?(?:-wal|-shm)?|\.log|\.pyc|\.tsbuildinfo|\.powerrouter-backup)$/i.test(name)
  || name === '.powerrouter.env' || name === 'server-runtime.json' || name === '.DS_Store';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sort = files => files.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function safeRelative(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':')
    || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw Error('UNSAFE_BUNDLE_PATH');
  return relative;
}

export async function inventory(directory) {
  const files=[];
  async function walk(current) {
    for(const entry of await fs.readdir(current,{withFileTypes:true})) {
      if(excludedDirectories.has(entry.name) || excludedFile(entry.name)) continue;
      const full=path.join(current,entry.name), relative=path.relative(directory,full).replaceAll('\\','/');
      if(entry.isSymbolicLink()) throw Error('BUNDLE_LINK_REJECTED: '+relative);
      if(entry.isDirectory()) await walk(full);
      else if(entry.isFile()) {const bytes=await fs.readFile(full);files.push({path:safeRelative(relative),bytes:bytes.length,sha256:sha256(bytes)});}
    }
  }
  await walk(directory); return sort(files);
}

export async function candidateFiles(root) {
  const files=[];
  for(const directory of directories) {
    const full=path.join(root,directory);
    const stat=await fs.lstat(full).catch(()=>null);
    if(!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw Error('BUNDLE_REQUIRED_DIRECTORY: '+directory);
    files.push(...(await inventory(full)).map(file=>({...file,path:directory+'/'+file.path})));
  }
  for(const relative of rootFiles) {
    const full=path.join(root,relative),stat=await fs.lstat(full);
    if(!stat.isFile() || stat.isSymbolicLink()) throw Error('BUNDLE_REQUIRED_FILE: '+relative);
    const bytes=await fs.readFile(full);files.push({path:relative,bytes:bytes.length,sha256:sha256(bytes)});
  }
  return sort(files);
}

export function fingerprints(files) {
  const runtime = file => file.path.startsWith('dist/') || file.path.startsWith('frontend/out/');
  return {source:sha256(JSON.stringify(files.filter(file=>!runtime(file)))),runtime:sha256(JSON.stringify(files.filter(runtime)))};
}

export async function copyVerifiedFiles(source, destination, files) {
  for(const file of files) {
    safeRelative(file.path);
    const input=path.join(source,file.path);
    const stat=await fs.lstat(input);
    if(!stat.isFile() || stat.isSymbolicLink()) throw Error('BUNDLE_SOURCE_CHANGED: '+file.path);
    const bytes=await fs.readFile(input);
    if(bytes.length!==file.bytes || sha256(bytes)!==file.sha256) throw Error('BUNDLE_SOURCE_CHANGED: '+file.path);
    const output=path.join(destination,file.path);
    await fs.mkdir(path.dirname(output),{recursive:true});
    await fs.writeFile(output,bytes,{flag:'wx'});
  }
}

export function validateEvidence(evidence, current) {
  if(evidence.kind!=='joecoder-development-validation-v1' || evidence.status!=='passed' || evidence.qualificationPassed!==false)
    throw Error('DEVELOPMENT_EVIDENCE_REQUIRED');
  if(evidence.fingerprints?.source!==current.source || evidence.fingerprints?.runtime!==current.runtime) throw Error('DEVELOPMENT_EVIDENCE_STALE');
  const required=['regression','frontend-lint','packaging-tests','startup-repair','cancellation','restart-recovery','app-followup','app-behavior'];
  for(const name of required) {
    const item=evidence.checks?.find(check=>check.name===name);
    if(!item || item.exitCode!==0 || item.passed!==true || !item.command || !Array.isArray(item.evidence) || !item.evidence.length) throw Error('DEVELOPMENT_CHECK_MISSING_OR_FAILED: '+name);
    item.evidence.forEach(safeRelative);
  }
}

export async function verifyDevelopmentBundle(bundleRoot) {
  const manifest=JSON.parse(await fs.readFile(path.join(bundleRoot,'DEVELOPMENT-MANIFEST.json'),'utf8'));
  if(manifest.kind!=='joecoder-development-bundle-v1' || manifest.qualificationPassed!==false || manifest.signedRelease!==false || !Array.isArray(manifest.files))
    throw Error('INVALID_DEVELOPMENT_MANIFEST');
  const seen=new Set();
  for(const file of manifest.files) {
    safeRelative(file.path);
    if(seen.has(file.path.toLowerCase()) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes<0) throw Error('INVALID_DEVELOPMENT_MANIFEST_FILE');
    seen.add(file.path.toLowerCase());
  }
  const actual=await inventory(path.join(bundleRoot,'payload'));
  if(JSON.stringify(actual)!==JSON.stringify(manifest.files)) throw Error('DEVELOPMENT_PAYLOAD_MISMATCH');
  if(!Array.isArray(manifest.evidence) || !manifest.evidence.some(file=>file.path==='evidence/validation.json')) throw Error('DEVELOPMENT_EVIDENCE_MANIFEST_REQUIRED');
  const evidencePaths=new Set();
  for(const file of manifest.evidence) {
    safeRelative(file.path);
    if(!file.path.startsWith('evidence/') || evidencePaths.has(file.path.toLowerCase())) throw Error('INVALID_EVIDENCE_PATH');
    evidencePaths.add(file.path.toLowerCase());
    const target=path.join(bundleRoot,file.path),stat=await fs.lstat(target);
    if(!stat.isFile() || stat.isSymbolicLink() || sha256(await fs.readFile(target))!==file.sha256) throw Error('DEVELOPMENT_EVIDENCE_MISMATCH');
  }
  const evidence=JSON.parse(await fs.readFile(path.join(bundleRoot,'evidence/validation.json'),'utf8'));
  validateEvidence(evidence,fingerprints(actual));
  for(const check of evidence.checks) for(const file of check.evidence || []) {
    safeRelative(file);
    if(!evidencePaths.has(('evidence/'+file).toLowerCase())) throw Error('DEVELOPMENT_CHECK_EVIDENCE_MISSING: '+file);
  }
  return {files:actual.length,...fingerprints(actual),qualificationPassed:false,signedRelease:false};
}

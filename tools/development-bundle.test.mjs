import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inventory, fingerprints, copyVerifiedFiles, sha256, validateEvidence, verifyDevelopmentBundle, safeRelative } from './development-bundle.mjs';

const checks=['regression','frontend-lint','packaging-tests','startup-repair','cancellation','restart-recovery','app-followup','app-behavior'];
async function fixture() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'JoeCoder bundle test '));
  const source=path.join(root,'source'),bundle=path.join(root,'bundle');
  await fs.mkdir(path.join(source,'src'),{recursive:true});
  await fs.writeFile(path.join(source,'src/app.js'),'export const value = 1;\n');
  await fs.writeFile(path.join(source,'start.bat'),'@echo off\r\nnode src/app.js\r\n');
  const files=await inventory(source);
  await copyVerifiedFiles(source,path.join(bundle,'payload'),files);
  const evidence={kind:'joecoder-development-validation-v1',status:'passed',qualificationPassed:false,
    fingerprints:fingerprints(files),checks:checks.map(name=>({name,passed:true,exitCode:0,command:'fixture-only test',evidence:['test-result.txt']}))};
  await fs.mkdir(path.join(bundle,'evidence'));
  const bytes=JSON.stringify(evidence);
  await fs.writeFile(path.join(bundle,'evidence/validation.json'),bytes);
  await fs.writeFile(path.join(bundle,'evidence/test-result.txt'),'fixture');
  await fs.writeFile(path.join(bundle,'DEVELOPMENT-MANIFEST.json'),JSON.stringify({kind:'joecoder-development-bundle-v1',qualificationPassed:false,signedRelease:false,
    files,evidence:[{path:'evidence/validation.json',bytes:Buffer.byteLength(bytes),sha256:sha256(bytes)},
      {path:'evidence/test-result.txt',bytes:7,sha256:sha256('fixture')}]}));
  return {root,source,bundle,files,evidence};
}

test('inventory excludes machine credentials, runtime databases, installed packages and caches',async()=>{
  const f=await fixture();
  for(const name of ['.powerrouter.env','.env','private.key','runtime.sqlite3','trace.log']) await fs.writeFile(path.join(f.source,name),'do not ship');
  await fs.mkdir(path.join(f.source,'node_modules'));
  await fs.writeFile(path.join(f.source,'node_modules/private.js'),'do not ship');
  assert.deepEqual(await inventory(f.source),f.files);
});
test('copy refuses source changed after its fingerprint was recorded and never overwrites a destination',async()=>{
  const f=await fixture();
  await assert.rejects(copyVerifiedFiles(f.source,path.join(f.bundle,'payload'),f.files),/EEXIST/);
  await fs.writeFile(path.join(f.source,'src/app.js'),'changed after tests');
  await assert.rejects(copyVerifiedFiles(f.source,path.join(f.root,'second'),f.files),/BUNDLE_SOURCE_CHANGED/);
});
test('verification rejects tampered, missing and extra source files',async()=>{
  for(const kind of ['changed','missing','extra']) {
    const f=await fixture();
    assert.equal((await verifyDevelopmentBundle(f.bundle)).qualificationPassed,false);
    if(kind==='changed') await fs.writeFile(path.join(f.bundle,'payload/src/app.js'),'changed');
    if(kind==='missing') await fs.rename(path.join(f.bundle,'payload/src/app.js'),path.join(f.root,'retained-app.js'));
    if(kind==='extra') await fs.writeFile(path.join(f.bundle,'payload/unlisted.js'),'extra');
    await assert.rejects(verifyDevelopmentBundle(f.bundle),/DEVELOPMENT_PAYLOAD_MISMATCH/);
  }
});
test('stale and incomplete checks cannot produce a tested bundle; evidence bytes are checked',async()=>{
  const f=await fixture(),current=fingerprints(f.files);
  validateEvidence(f.evidence,current);
  assert.throws(()=>validateEvidence({...f.evidence,fingerprints:{...current,source:'changed'}},current),/STALE/);
  assert.throws(()=>validateEvidence({...f.evidence,checks:f.evidence.checks.slice(1)},current),/CHECK_MISSING_OR_FAILED/);
  assert.throws(()=>validateEvidence({...f.evidence,qualificationPassed:true},current),/EVIDENCE_REQUIRED/);
  await fs.appendFile(path.join(f.bundle,'evidence/validation.json'),' ');
  await assert.rejects(verifyDevelopmentBundle(f.bundle),/EVIDENCE_MISMATCH/);
});
test('portable manifest paths reject traversal, drive paths and Windows alternate streams',()=>{
  for(const value of ['../escape','/absolute','C:/escape','src\\file.js','src/file.js:stream','src//file.js']) assert.throws(()=>safeRelative(value),/UNSAFE_BUNDLE_PATH/);
  assert.equal(safeRelative('src/file.js'),'src/file.js');
});
test('a result must be present in the evidence manifest, not just named by the validation receipt',async()=>{
  const f=await fixture();
  const manifestPath=path.join(f.bundle,'DEVELOPMENT-MANIFEST.json');
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  manifest.evidence=manifest.evidence.filter(file=>file.path.endsWith('validation.json'));
  await fs.writeFile(manifestPath,JSON.stringify(manifest));
  await assert.rejects(verifyDevelopmentBundle(f.bundle),/CHECK_EVIDENCE_MISSING/);
});

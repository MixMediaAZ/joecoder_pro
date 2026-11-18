import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { candidateFiles, fingerprints, copyVerifiedFiles, inventory, sha256, validateEvidence, verifyDevelopmentBundle } from './development-bundle.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [mode,argument]=process.argv.slice(2);
if(mode==='fingerprint') {
  const files=await candidateFiles(root);
  console.log(JSON.stringify({fingerprints:fingerprints(files),files:files.length},null,2));
} else if(mode==='verify' && argument) {
  console.log(JSON.stringify({passed:true,...await verifyDevelopmentBundle(path.resolve(argument))},null,2));
} else if(mode==='pack' && argument) {
  if(process.platform!=='win32') throw Error('Development ZIP packaging currently requires Windows.');
  const evidenceRoot=await fs.realpath(path.resolve(argument));
  const permitted=await fs.realpath(path.join(root,'.jc','readiness'));
  if(!evidenceRoot.toLowerCase().startsWith(permitted.toLowerCase()+path.sep)) throw Error('SELECT_READINESS_EVIDENCE_DIRECTORY');
  const evidence=JSON.parse(await fs.readFile(path.join(evidenceRoot,'validation.json'),'utf8'));
  const files=await candidateFiles(root);
  validateEvidence(evidence,fingerprints(files));
  const id='joecoder-development-'+new Date().toISOString().replace(/[:.]/g,'-');
  const output=path.join(root,'.jc','deliveries',id),bundle=path.join(output,id);
  await fs.mkdir(bundle,{recursive:true});
  await copyVerifiedFiles(root,path.join(bundle,'payload'),files);
  const evidenceFiles=await inventory(evidenceRoot);
  // Only explicitly prepared reports are copied, never databases, live runtime state or credentials.
  await copyVerifiedFiles(evidenceRoot,path.join(bundle,'evidence'),evidenceFiles);
  const manifest={kind:'joecoder-development-bundle-v1',createdAt:new Date().toISOString(),qualificationPassed:false,signedRelease:false,
    files,evidence:evidenceFiles.map(file=>({...file,path:'evidence/'+file.path}))};
  await fs.writeFile(path.join(bundle,'DEVELOPMENT-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await fs.writeFile(path.join(bundle,'SHA256SUMS'),[...files.map(file=>({...file,path:'payload/'+file.path})),...manifest.evidence]
    .map(file=>file.sha256+'  '+file.path).join('\n')+'\n',{flag:'wx'});
  await fs.writeFile(path.join(bundle,'START-HERE.md'),[
    '# JoeCoder tested development build','',
    'This is an unsigned development snapshot. Historical mandate and clean-Windows release qualification are not claimed.',
    'The preexisting package version is retained; its repair-certified suffix does not certify this development bundle.','',
    '1. Extract the ZIP to a writable folder.',
    '2. Install Node.js 22.23.1 (the tested runtime) or a compatible Node 22 runtime.',
    '3. From payload, run: node tools/package-development.mjs verify ..',
    '4. Run payload/start.bat. It installs exact lockfile dependencies if missing, builds source, selects an available port, and opens the local interface.',
    '5. Configure an available local model or your existing authorized provider using the documented settings. Credentials and local model files are not included.',
    '6. Select a disposable project first, then send an ordinary request in Automatic mode. Review the recorded tests and completion evidence.','',
    'npm test and npm --prefix frontend run lint reproduce source checks. Runtime acceptance commands are in payload/docs/RUNTIME_VERIFICATION.md.',
    'The Python repair regression needs Python 3.12 plus tools/requirements-test.txt; Python is not required to start the Node app.',
    'See evidence/validation.json and payload/plan/JOECODER_BUILDER_HANDOFF_2026-11-17.md for observed results and remaining limits.',''
  ].join('\n'),{flag:'wx'});
  await verifyDevelopmentBundle(bundle);
  if(JSON.stringify(fingerprints(await candidateFiles(root)))!==JSON.stringify(fingerprints(files))) throw Error('CANDIDATE_CHANGED_DURING_PACKAGING');
  const zip=path.join(output,id+'.zip');
  const archive=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:JC_BUNDLE_SOURCE,$env:JC_BUNDLE_ZIP,[System.IO.Compression.CompressionLevel]::Optimal,$true)"],
    {windowsHide:true,encoding:'utf8',env:{...process.env,JC_BUNDLE_SOURCE:bundle,JC_BUNDLE_ZIP:zip},timeout:120000});
  if(archive.error || archive.status!==0) throw Error('ZIP_CREATION_FAILED: '+(archive.error?.message || archive.stderr));
  const digest=sha256(await fs.readFile(zip));
  await fs.writeFile(zip+'.sha256',digest+'  '+path.basename(zip)+'\n',{flag:'wx'});
  console.log(JSON.stringify({bundle,zip,sha256:digest,files:files.length,qualificationPassed:false,signedRelease:false},null,2));
} else throw Error('Usage: node tools/package-development.mjs fingerprint | pack <prepared-readiness-evidence-directory> | verify <extracted-bundle-directory>');

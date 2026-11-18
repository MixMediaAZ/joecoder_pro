// Exercise the real Windows launcher, session, workspace and existing-instance reuse.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {projectProcessEnvironment,redactProcessOutput} from '../dist/processPolicy.js';
import {terminateOwnedProcess} from '../dist/boundedProcess.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const selected=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
const target=await fs.realpath(path.resolve(selected||root));
const hold=process.argv.includes('--hold');
if(process.platform!=='win32') throw Error('Run the batch launcher acceptance on Windows.');
if(target!==root && !target.toLowerCase().startsWith(path.join(root,'.jc','deliveries').toLowerCase()+path.sep)) throw Error('Select this checkout or an extracted development delivery.');
assert.equal(JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8')).name,'joecoder-pro-20.1');
const run=path.join(root,'.jc','readiness','launcher-proof-'+Date.now()),data=path.join(run,'runtime');
await fs.mkdir(data,{recursive:true});
const env=projectProcessEnvironment({JC_DATA_DIR:data,JC_PORT:'0',JC_HOST:'127.0.0.1',JC_NO_OPEN:'1',JC_MOCK_MODEL:'0',
  ...(process.env.JC_OLLAMA_URL?{JC_OLLAMA_URL:process.env.JC_OLLAMA_URL}:{}),npm_config_prefer_offline:'true'});
const launch=()=>spawn(process.env.ComSpec||'cmd.exe',['/d','/c',`call "${path.join(target,'start.bat')}" --no-pause`],
  {cwd:os.tmpdir(),env,windowsHide:true,windowsVerbatimArguments:true,stdio:['ignore','pipe','pipe']});
const child=launch();let logs='',launchError,base,cookie,csrf;
for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{logs=(logs+data).slice(-2000000);});
child.once('error',error=>{launchError=error;});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const record={target,startedAt:new Date().toISOString(),qualificationPassed:false,checks:[]};
async function request(method,endpoint,body){
  const response=await fetch(base+endpoint,{method,headers:{Origin:base,'Content-Type':'application/json','Idempotency-Key':randomUUID(),
    ...(cookie?{Cookie:cookie,'X-JC-CSRF':csrf}: {})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  const result=await response.json();if(result.csrfToken)csrf=result.csrfToken;
  assert.ok(response.ok,endpoint+': '+response.status);return result;
}
try {
  const deadline=Date.now()+300000;let bootstrap;
  while(!(bootstrap=logs.match(/(http:\/\/127\.0\.0\.1:\d+)\/bootstrap\.html#token=([\w-]+)/))){
    if(launchError)throw launchError;
    if(child.exitCode!==null||Date.now()>deadline)throw Error('LAUNCHER_FAILED: '+redactProcessOutput(logs).slice(-6000));
    await sleep(250);
  }
  base=bootstrap[1];await request('POST','/api/v1/session/exchange',{bootstrapToken:bootstrap[2]});
  assert.equal((await request('GET','/health')).status,'ok');
  const page=await fetch(base+'/workspace/',{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)});
  assert.equal(page.status,200);const html=await page.text();assert.match(html,/<html/i);
  const assets=[...new Set([...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css)(?:\?[^\"]*)?)"/g)].map(match=>match[1]))];
  assert.ok(assets.length>0,'Expected built workspace assets');
  for(const asset of assets){const url=new URL(asset,base+'/workspace/');assert.equal(url.origin,base);assert.equal((await fetch(url,{signal:AbortSignal.timeout(10000)})).status,200);}
  const projects=await request('GET','/api/v1/projects');assert.ok(Array.isArray(projects.projects));
  record.checks.push({name:'batch starts from another folder; session, workspace assets and projects API load',passed:true,url:base});
  const before=JSON.parse(await fs.readFile(path.join(data,'server-runtime.json'),'utf8'));
  const second=launch();let secondLogs='';for(const stream of [second.stdout,second.stderr])stream.on('data',chunk=>{secondLogs+=chunk;});
  try{
    const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SECOND_LAUNCH_TIMEOUT')),15000);
      second.once('error',error=>{clearTimeout(timer);reject(error);});second.once('close',code=>{clearTimeout(timer);resolve(code);});});
    assert.equal(exit,0);assert.match(secondLogs,/Reused the active server; no duplicate was started/);
    const after=JSON.parse(await fs.readFile(path.join(data,'server-runtime.json'),'utf8'));
    assert.equal(after.pid,before.pid);assert.equal(after.baseUrl,before.baseUrl);
    record.checks.push({name:'second batch launch reuses the same process and port',passed:true});
  }finally{await terminateOwnedProcess(second);}
  record.passed=true;
  if(hold){
    const response=await fetch(base+'/api/v1/launcher/bootstrap',{method:'POST',headers:{'Content-Type':'application/json','x-jc-launcher-secret':before.launcherSecret},body:'{}',signal:AbortSignal.timeout(5000)});
    const fresh=await response.json();assert.ok(response.ok&&fresh.bootstrapUrl);
    await fs.writeFile(path.join(run,'live.json'),JSON.stringify({url:base,bootstrapUrl:fresh.bootstrapUrl,pid:before.pid},null,2));
    console.log('BROWSER_READY '+run);
    await fs.writeFile(path.join(run,'result.json'),JSON.stringify(record,null,2));
    const end=Date.now()+1200000;
    while(Date.now()<end){if(await fs.access(path.join(run,'stop')).then(()=>true,()=>false))break;await sleep(500);}
  }
}catch(error){record.passed=false;record.error=error.message;process.exitCode=1;}
finally{
  try{
    if(base&&cookie)await request('POST','/api/v1/system/shutdown',{confirm:'shutdown'});
    for(let i=0;i<100&&child.exitCode===null;i++)await sleep(100);
    if(child.exitCode!==0)throw Error('LAUNCHER_DID_NOT_EXIT_CLEANLY: '+child.exitCode);
    if(base)assert.equal(await fetch(base+'/health',{signal:AbortSignal.timeout(1000)}).then(()=>true,()=>false),false);
    record.checks.push({name:'owned server shuts down cleanly and its URL stops responding',passed:true});
  }catch(error){record.passed=false;record.shutdownError=error.message;process.exitCode=1;}
  await terminateOwnedProcess(child);
  record.finishedAt=new Date().toISOString();await fs.writeFile(path.join(run,'result.json'),JSON.stringify(record,null,2));
  await fs.writeFile(path.join(run,'launcher.log'),redactProcessOutput(logs).replace(/token=[\w-]+/g,'token=[redacted]'));
  console.log(JSON.stringify({passed:record.passed,error:record.error,shutdownError:record.shutdownError,evidence:run}));
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { terminateOwnedProcess } from '../dist/boundedProcess.js';
const root=process.cwd(), priorRun=path.resolve(process.argv[2]||'');
if(!priorRun.startsWith(path.resolve('.jc/readiness')+path.sep)) throw Error('Select a disposable readiness run.');
const prior=JSON.parse(await fs.readFile(path.join(priorRun,'result.json')));
if(prior.terminal?.job.status!=='completed') throw Error('The initial job must have completed.');
const objective=process.argv[3] || 'Make Workboard editing work inside the page without browser prompt dialogs. Make its Windows launcher start correctly from any working folder and choose an available port automatically by default. Preserve existing saved items and the create, filter, complete and delete workflows. Run the application checks and report actual evidence.';
const run=path.resolve('.jc/readiness','app-builder-followup-'+Date.now()); await fs.mkdir(run,{recursive:true});
const target=prior.target, data=path.join(priorRun,'runtime');
async function inventory(directory) {
  const out={};
  async function walk(dir) { for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    if(['.git','node_modules','.jc'].includes(entry.name)) continue;
    const file=path.join(dir,entry.name); if(entry.isDirectory()) await walk(file);
    else if(entry.isFile()) out[path.relative(directory,file).replaceAll('\\','/')]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }} await walk(directory);return out;
}
const record={objective,target,startedAt:new Date().toISOString(),proofLevel:'diagnostic-real-model-followup',qualificationPassed:false,before:await inventory(target)};
const child=spawn(process.execPath,[path.join(root,'dist/index.js')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,JC_DATA_DIR:data,JC_PORT:'0',JC_HOST:'127.0.0.1',JC_NO_OPEN:'1',JC_MOCK_MODEL:'0',JC_OLLAMA_MODEL:prior.model,NODE_ENV:'test'}});
let logs='',base,cookie='',csrf='',jobId;
for(const stream of [child.stdout,child.stderr]) stream.on('data',data=>{logs=(logs+data).slice(-1000000);});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(method,route,body) {
 const response=await fetch(base+route,{method,headers:{Origin:base,'Content-Type':'application/json','Idempotency-Key':randomUUID(),...(cookie?{Cookie:cookie,'x-jc-csrf':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 if(response.headers.get('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
 const value=await response.json(); if(value.csrfToken) csrf=value.csrfToken;
 if(!response.ok) throw Error(route+': '+response.status+' '+JSON.stringify(value));return value;
}
try {
 let launch; const startup=Date.now()+45000;
 while(!(launch=logs.match(/(http:\/\/127\.0\.0\.1:\d+)\/bootstrap\.html#token=([a-zA-Z0-9_-]+)/))) {if(Date.now()>startup||child.exitCode!==null) throw Error('Startup failed');await sleep(100);}
 base=launch[1]; await request('POST','/api/v1/session/exchange',{bootstrapToken:launch[2]});
 const priorJob=prior.terminal.job;
 const submitted=await request('POST',`/api/v1/projects/${priorJob.projectId}/threads/${priorJob.threadId}/agent-jobs`,{objective,mode:'build',activeWorkOrderId:null});
 jobId=submitted.job.id; record.jobId=jobId; console.log('FOLLOWUP_RUN '+run+'\nJOB '+jobId);
 let last='';const deadline=Date.now()+600000;
 while(Date.now()<deadline) {
   record.terminal=await request('GET','/api/v1/agent-jobs/'+jobId);
   const state=record.terminal.job.status+'/'+record.terminal.job.stage;
   if(state!==last){console.log(state);last=state;await fs.writeFile(path.join(run,'result.json'),JSON.stringify(record,null,2));}
   if(['completed','failed','cancelled','interrupted'].includes(record.terminal.job.status)) break;
   await sleep(1000);
 }
 record.after=await inventory(target);
 record.savedDataPreserved=record.before['data/items.json']===record.after['data/items.json'];
 record.changedPaths=Object.keys(record.after).filter(file=>record.after[file]!==record.before[file]);
 record.passed=record.terminal.job.status==='completed'&&record.savedDataPreserved;
 process.exitCode=record.passed?0:1;
} catch(error) {record.error=error.message;process.exitCode=1;}
finally {
 if(jobId && !['completed','failed','cancelled','interrupted'].includes(record.terminal?.job.status)) await request('POST','/api/v1/agent-jobs/'+jobId+'/stop',{}).catch(()=>{});
 if(base) await request('POST','/api/v1/system/shutdown',{confirm:'shutdown'}).catch(()=>{});
 for(let i=0;i<50 && child.exitCode===null;i++) await sleep(100);
 await terminateOwnedProcess(child);
 record.finishedAt=new Date().toISOString();await fs.writeFile(path.join(run,'result.json'),JSON.stringify(record,null,2));
 await fs.writeFile(path.join(run,'server.log'),logs.replace(/token=[\w-]+/g,'token=[redacted]'));
 console.log('EVIDENCE '+run);
}

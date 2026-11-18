// Independent development acceptance for JoeCoder's generated Node Workboard.
// Browser interaction and the historical sealed qualification remain separate.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { projectProcessEnvironment } from '../dist/processPolicy.js';
import { terminateOwnedProcess } from '../dist/boundedProcess.js';
const target = path.resolve(process.argv[2] || '');
const readiness = path.resolve('.jc/readiness');
if (!target.startsWith(readiness + path.sep)) throw Error('Select a disposable readiness target.');
const hold = process.argv.includes('--hold');
const run = path.join(readiness, 'workboard-behavior-' + Date.now());
await fs.mkdir(run, { recursive: true });
const dataDir = path.join(target, 'data');
const record = { target, dataDir, startedAt: new Date().toISOString(), proofLevel: 'independent-api-development-check', qualificationPassed: false, checks: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, base;
const worker = `
const { createServer } = require(process.argv[1]);
const server = createServer({dataDir:process.argv[2]});
server.listen(0,'127.0.0.1',()=>process.send({url:'http://127.0.0.1:'+server.address().port}));
process.on('message',message=>{if(message==='stop'){server.close(()=>process.exit(0));server.closeIdleConnections?.();}});
`;
async function start() {
  child = spawn(process.execPath, ['-e', worker, path.join(target, 'server.js'), dataDir], {
    cwd: target, windowsHide: true, detached: process.platform !== 'win32',
    env: projectProcessEnvironment(), stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let logs=''; child.stderr.on('data', data => { logs=(logs+data).slice(-4000); });
  base = await new Promise((resolve, reject) => {
    const timer=setTimeout(()=>reject(Error('App launch timed out: '+logs)),10000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('App exited '+code+': '+logs));});
    child.once('message',message=>{clearTimeout(timer);resolve(message.url);});
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.send('stop');
  for(let i=0;i<100 && child.exitCode===null;i++) await sleep(50);
  if(child.exitCode===null) { await terminateOwnedProcess(child); throw Error('Application did not shut down cleanly'); }
  assert.equal(child.exitCode,0);
}
async function api(method, route, body) {
  const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  const text=await response.text(); return {status:response.status, body:text?JSON.parse(text):null};
}
async function check(name, action) {
  await action(); record.checks.push({name,passed:true}); console.log('PASS '+name);
}
try {
  await start();
  const before=await api('GET','/api/items'); assert.equal(before.status,200); assert.ok(Array.isArray(before.body));
  let id, secondId;
  const item={title:'Independent proof '+Date.now(),status:'todo',priority:'high'};
  await check('create returns a persisted server-assigned identity',async()=>{
    const response=await api('POST','/api/items',item); assert.equal(response.status,201); assert.ok(response.body.id); id=response.body.id;
    const list=await api('GET','/api/items'); assert.deepEqual(list.body.find(value=>value.id===id),response.body);
    const second=await api('POST','/api/items',{...item,title:'Another open item'}); assert.equal(second.status,201); secondId=second.body.id;
  });
  await check('edit and complete preserve identity without duplication',async()=>{
    const response=await api('PUT','/api/items/'+id,{...item,title:'Edited independent proof',status:'done'});
    assert.equal(response.status,200); assert.equal(response.body.id,id); assert.equal(response.body.status,'done');
    const list=await api('GET','/api/items'); assert.equal(list.body.filter(value=>value.id===id).length,1);
  });
  await check('status filters exclude nonmatching items',async()=>{
    const complete=await api('GET','/api/items/filter?status=done'); assert.equal(complete.status,200);
    assert.ok(complete.body.some(value=>value.id===id)); assert.ok(complete.body.every(value=>value.status==='done'));
    const open=await api('GET','/api/items/filter?status=todo'); assert.ok(open.body.some(value=>value.id===secondId)); assert.ok(!open.body.some(value=>value.id===id));
  });
  if (process.argv.includes('--trimmed-search')) await check('title search ignores edge whitespace and case without changing saved items',async()=>{
    const beforeSearch=(await api('GET','/api/items')).body;
    for(const search of ['EDITED INDEPENDENT PROOF','  EDITED INDEPENDENT PROOF  ']) {
      const matches=await api('GET','/api/items/filter?search='+encodeURIComponent(search));
      assert.equal(matches.status,200);assert.deepEqual(matches.body.map(item=>item.id),[id]);
    }
    const blank=await api('GET','/api/items/filter?search='+encodeURIComponent('   '));
    assert.deepEqual(blank.body,beforeSearch);
    assert.deepEqual((await api('GET','/api/items')).body,beforeSearch);
  });
  await check('blank and oversized titles are rejected without persistence',async()=>{
    const count=(await api('GET','/api/items')).body.length;
    for(const title of ['   ','x'.repeat(101)]) assert.equal((await api('POST','/api/items',{...item,title})).status,400);
    assert.equal((await api('GET','/api/items')).body.length,count);
  });
  await check('edited state survives a clean process restart',async()=>{
    const priorPid=child.pid; await stop(); await start(); assert.notEqual(child.pid,priorPid);
    const saved=(await api('GET','/api/items')).body.find(value=>value.id===id);
    assert.equal(saved.title,'Edited independent proof'); assert.equal(saved.status,'done');
  });
  await check('delete persists and repeat delete reports not found',async()=>{
    assert.ok([200,204].includes((await api('DELETE','/api/items/'+id)).status));
    assert.equal((await api('DELETE','/api/items/'+id)).status,404);
    assert.ok([200,204].includes((await api('DELETE','/api/items/'+secondId)).status));
    await stop(); await start();
    const list=(await api('GET','/api/items')).body;
    assert.ok(!list.some(value=>value.id===id || value.id===secondId));
    assert.deepEqual(list,before.body);
  });
  // Keep a genuine API-created record to check collateral preservation in a follow-up job.
  if (!before.body.length) {
    const seed=await api('POST','/api/items',{title:'Preserve this item during the next change',status:'todo',priority:'medium'});
    assert.equal(seed.status,201); record.retainedItem=seed.body;
  }
  record.passed=true;
  const bytes=await fs.readFile(path.join(dataDir,'items.json'));
  record.dataHash=createHash('sha256').update(bytes).digest('hex');
  if(hold) {
    await fs.writeFile(path.join(run,'live.json'),JSON.stringify({url:base,pid:child.pid,target,dataDir},null,2));
    console.log('BROWSER_URL '+base+'\nEVIDENCE '+run);
    await fs.writeFile(path.join(run,'result.json'),JSON.stringify(record,null,2));
    const deadline=Date.now()+1200000;
    while(Date.now()<deadline) { if(await fs.access(path.join(run,'stop')).then(()=>true,()=>false)) break; await sleep(500); }
  }
} catch(error) { record.passed=false; record.error=error.message; process.exitCode=1; console.error(error.message); }
finally {
  try { await stop(); } catch(error) { record.passed=false; record.shutdownError=error.message; process.exitCode=1; }
  record.finishedAt=new Date().toISOString(); await fs.writeFile(path.join(run,'result.json'),JSON.stringify(record,null,2));
  console.log('EVIDENCE '+run);
}

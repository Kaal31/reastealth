import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const mcp = fileURLToPath(new URL('../src/mcp.mjs', import.meta.url));
function client(role, workspace, task) {
 const proc = spawn(process.execPath, [mcp, '--role', role, '--workspace', workspace, ...(task ? ['--task', task] : [])], { stdio:['pipe','pipe','pipe'] });
 let buffer='', seq=0, stderr='';
 const pending=new Map();
 proc.stderr.on('data', d => { stderr+=d; });
 proc.stdout.on('data', d => {
   buffer+=d;
   for (let index; (index=buffer.indexOf('\n'))>=0;) {
     const line=buffer.slice(0,index); buffer=buffer.slice(index+1);
     if(!line) continue;
     const response=JSON.parse(line), waiting=pending.get(response.id);
     if(waiting){clearTimeout(waiting.timer);pending.delete(response.id);waiting.resolve(response);}
   }
 });
 proc.on('exit', code => {
   for(const [id,w] of pending){clearTimeout(w.timer);w.reject(Error('MCP exited '+code+': '+stderr));pending.delete(id);}
 });
 function request(method,params={}) {
  return new Promise((resolve,reject)=>{
   const id=++seq;
   const timer=setTimeout(()=>{pending.delete(id);reject(Error('MCP timeout '+method+': '+stderr));},10000);
   pending.set(id,{timer,resolve,reject});
   proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
 }
 return { proc, request, call:(name,args={})=>request('tools/call',{name,arguments:args}), close:()=>proc.kill() };
}
function value(response) {
 assert.ok(!response.error && !response.result?.isError,JSON.stringify(response));
 return JSON.parse(response.result.content[0].text);
}
test('two independent worker MCP processes complete task handoff, dependencies, review, integration', async () => {
 const root=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rea-full-handoff-')),'project');
 const master=client('master',root);
 let workerA,workerB,competitor;
 try {
  value(await master.call('init_workspace'));
  value(await master.call('create_task',{id:'parser',title:'Parser',instructions:'UNIQUE_ALPHA build parser'}));
  value(await master.call('create_task',{id:'ui',title:'UI',instructions:'UNIQUE_BETA build user interface'}));
  workerA=client('worker',root,'parser'); workerB=client('worker',root,'ui');
  const [taskA,taskB]=await Promise.all([workerA.call('get_task'),workerB.call('get_task')]);
  assert.match(value(taskA).task,/UNIQUE_ALPHA/);
  assert.doesNotMatch(JSON.stringify(taskA),/UNIQUE_BETA/);
  assert.match(value(taskB).task,/UNIQUE_BETA/);
  assert.doesNotMatch(JSON.stringify(taskB),/UNIQUE_ALPHA/);
  assert.deepEqual(value(await master.call('ready_tasks')),[]);
  competitor=client('worker',root,'parser');
  assert.equal((await competitor.call('get_task')).result.isError,true);
  const dep=value(await workerA.call('request_dependency',{type:'interface',name:'contract',reason:'Need schema',required:true}));
  assert.equal(dep.status,'pending');
  assert.equal((await workerA.call('submit_result',{summary:'too early'})).result.isError,true);
  assert.equal(value(await workerB.call('get_request_status')).length,0);
  assert.equal(value(await master.call('list_dependency_requests')).length,1);
  value(await master.call('resolve_dependency_request',{requestId:dep.id,status:'approved',response:'Approved'}));
  const resource=value(await master.call('provision_text_resource',{requestId:dep.id,name:'schema.txt',content:'schema-v1'}));
  assert.equal(fs.readFileSync(path.join(root,'workers','parser',resource.path),'utf8'),'schema-v1');
  assert.equal(value(await workerA.call('get_request_status'))[0].status,'provisioned');
  value(await workerA.call('renew_lease'));
  fs.writeFileSync(path.join(root,'workers','parser','deliverables','parser.txt'),'parser implementation');
  fs.writeFileSync(path.join(root,'workers','ui','deliverables','ui.txt'),'interface implementation');
  value(await workerA.call('submit_result',{summary:'Parser complete'}));
  value(await workerB.call('submit_result',{summary:'UI complete'}));
  const events=value(await master.call('pending_events'));
  assert.equal(events.length,2);
  assert.deepEqual(events.map(e=>e.taskId).sort(),['parser','ui']);
  assert.equal(value(await master.call('inspect_deliverables',{id:'parser'})).files.length,1);
  assert.equal((await master.call('import_deliverables',{id:'parser'})).result.isError,true);
  value(await master.call('review_task',{id:'parser',accepted:true,notes:'Verified'}));
  value(await master.call('review_task',{id:'ui',accepted:true,notes:'Verified'}));
  const first=value(await master.call('import_deliverables',{id:'parser'}));
  const second=value(await master.call('import_deliverables',{id:'ui'}));
  assert.equal(fs.readFileSync(path.join(first.directory,'parser.txt'),'utf8'),'parser implementation');
  assert.equal(fs.readFileSync(path.join(second.directory,'ui.txt'),'utf8'),'interface implementation');
  for(const event of events) value(await master.call('acknowledge_event',{id:event.id}));
  assert.deepEqual(value(await master.call('pending_events')),[]);
  assert.deepEqual(value(await master.call('list_tasks')).map(t=>t.status),['accepted','accepted']);
 } finally {workerA?.close();workerB?.close();competitor?.close();master.close();}
});

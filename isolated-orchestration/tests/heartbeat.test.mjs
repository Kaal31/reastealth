import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { init, add, list } from '../src/workspace.mjs';

const script=fileURLToPath(new URL('../src/mcp.mjs', import.meta.url));
test('worker MCP renews its lease automatically and stops after release', async () => {
 const root=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rea-heartbeat-')),'project');
 init(root); add(root,{id:'unit',title:'Unit',instructions:'Test'});
 const processWorker=spawn(process.execPath,[script,'--role','worker','--workspace',root,'--task','unit'],{
  stdio:['pipe','pipe','pipe'],env:{...process.env,REA_LEASE_HEARTBEAT_MS:'50'}
 });
 let buffer='', counter=0; const pending=new Map();
 processWorker.stdout.on('data',chunk=>{
  buffer+=chunk.toString();
  let end;
  while((end=buffer.indexOf('\n'))>=0) {
   const response=JSON.parse(buffer.slice(0,end)); buffer=buffer.slice(end+1);
   const waiter=pending.get(response.id);
   if(waiter){pending.delete(response.id);waiter(response);}
  }
 });
 const call=name=>new Promise((resolve,reject)=>{
  const id=++counter;
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('MCP timeout '+name));},5000);
  pending.set(id,response=>{clearTimeout(timer);resolve(response);});
  processWorker.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:{}}})+'\n');
 });
 try {
  const first=await call('get_task');
  assert.equal(first.result.isError,undefined,JSON.stringify(first));
  const before=Date.parse(list(root)[0].lease.expiresAt);
  await new Promise(resolve=>setTimeout(resolve,260));
  const after=Date.parse(list(root)[0].lease.expiresAt);
  assert.ok(after>before,'Lease heartbeat should extend expiration');
  const release=await call('release_task');
  assert.equal(release.result.isError,undefined,JSON.stringify(release));
  assert.equal(list(root)[0].status,'pending');
  await new Promise(resolve=>setTimeout(resolve,140));
  assert.equal(list(root)[0].status,'pending');
 } finally {processWorker.kill();}
});

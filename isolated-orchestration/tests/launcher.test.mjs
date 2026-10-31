import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, add, submit, review, requestDependency } from '../src/workspace.mjs';
import { planWorkers, startWorkers } from '../src/launcher.mjs';

function project() {
 const root=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rea-launcher-')),'workspace');
 init(root);
 add(root,{id:'parser',title:'Parser',instructions:'Parse JSON'});
 add(root,{id:'ui',title:'UI',instructions:'Build UI'});
 add(root,{id:'downstream',title:'Downstream',instructions:'Use parser',dependencies:['parser']});
 return root;
}
test('launcher schedules only ready, independent tasks and uses worker project directories', () => {
 const root=project();
 assert.deepEqual(planWorkers(root).map(t=>t.id),['parser','ui']);
 assert.deepEqual(planWorkers(root,1).map(t=>t.id),['parser']);
 const result=provision => null;
 const calls=[];
 const launched=startWorkers(planWorkers(root),{platform:'win32',run:(cmd,args,options)=>{
  calls.push({cmd,args,options});
  return {status:0,stderr:''};
 }});
 assert.deepEqual(launched.map(t=>t.id),['parser','ui']);
 assert.equal(calls.length,2);
 assert.equal(calls[0].cmd,'powershell.exe');
 assert.match(Buffer.from(calls[0].args[3],'base64').toString('utf16le'),/Start-Process/);
 assert.match(Buffer.from(calls[0].args[3],'base64').toString('utf16le'),/parser/);
 assert.equal(calls[0].options.cwd,path.join(root,'workers','parser'));
});
test('launcher skips blocked and assigned tasks', () => {
 const root=project();
 requestDependency(root,'parser',{type:'interface',name:'contract',reason:'Need schema'});
 assert.deepEqual(planWorkers(root).map(t=>t.id),['ui']);
});
test('launcher rejects invalid limits and never silently claims a task', () => {
 const root=project();
 assert.throws(()=>planWorkers(root,0));
 assert.throws(()=>planWorkers(root,17));
 assert.deepEqual(planWorkers(root).map(t=>t.id),['parser','ui']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, list, ready } from '../src/workspace.mjs';
import { createFragments } from '../src/fragmentation.mjs';

function fixture(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'rea-fragment-'));
 const workspace=path.join(base,'workspace'),source=path.join(base,'source');
 fs.mkdirSync(source); init(workspace);
 fs.writeFileSync(path.join(source,'alpha.js'),'export const alpha = 1;');
 fs.writeFileSync(path.join(source,'beta.js'),'export const beta = 2;');
 fs.writeFileSync(path.join(source,'private.txt'),'do not distribute');
 return {workspace,source};
}
const manifest={tasks:[
 {id:'alpha',title:'Analyze A',instructions:'Document alpha',files:['alpha.js'],acceptance:['Report result']},
 {id:'beta',title:'Analyze B',instructions:'Document beta',files:['beta.js'],dependencies:['alpha']}
]};
test('fragment dry run does not create tasks; execution copies selected files with hashes',()=>{
 const {workspace,source}=fixture();
 const preview=createFragments(workspace,source,manifest);
 assert.equal(preview.dryRun,true);
 assert.equal(list(workspace).length,0);
 const result=createFragments(workspace,source,manifest,{dryRun:false});
 assert.equal(result.created.length,2);
 assert.deepEqual(ready(workspace).map(x=>x.id),['alpha']);
 assert.equal(fs.readFileSync(path.join(workspace,'workers','alpha','inputs','alpha.js'),'utf8'),'export const alpha = 1;');
 assert.ok(!fs.existsSync(path.join(workspace,'workers','alpha','inputs','beta.js')));
 assert.ok(!fs.existsSync(path.join(workspace,'workers','alpha','inputs','private.txt')));
 assert.equal(result.created[0].inputs[0].sha256.length,64);
 assert.deepEqual(list(workspace).map(x=>x.id),['alpha','beta']);
});
test('preflight rejects traversal, nonexistent files and cyclic or missing task dependencies',()=>{
 const {workspace,source}=fixture();
 for (const bad of ['../private.txt','missing.js','/etc/passwd']) {
  assert.throws(()=>createFragments(workspace,source,{tasks:[{id:'fail',title:'Fail',instructions:'No',files:[bad]}]}));
 }
 assert.throws(()=>createFragments(workspace,source,{tasks:[{id:'beta',title:'B',instructions:'X',files:['beta.js'],dependencies:['alpha']},{id:'alpha',title:'A',instructions:'Y',files:['alpha.js']}]}));
 assert.equal(list(workspace).length,0);
});
test('fragment size limits reject excessive source without mutating tasks',()=>{
 const {workspace,source}=fixture();
 fs.writeFileSync(path.join(source,'huge.js'),'x'.repeat(300000));
 assert.throws(()=>createFragments(workspace,source,{tasks:[{id:'big',title:'Big',instructions:'Inspect',files:['huge.js']}]},{dryRun:false}),/budget/);
 assert.equal(list(workspace).length,0);
});

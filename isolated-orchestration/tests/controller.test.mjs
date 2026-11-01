import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, add, list } from '../src/workspace.mjs';
import { setControllerMode, controllerStatus, pollController } from '../src/controller.mjs';
import { inspectSandbox, launchSandboxedWorker } from '../src/windows-sandbox.mjs';
const setup=()=>{const root=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rea-controller-')),'w');init(root);add(root,{id:'a',title:'A',instructions:'Analyze'});return root;};
test('controller lifecycle persists modes across calls and pauses collection',()=>{
 const root=setup();
 assert.equal(controllerStatus(root).controller.status,'stopped');
 setControllerMode(root,'running');
 assert.equal(controllerStatus(root).controller.status,'running');
 setControllerMode(root,'paused');
 assert.equal(pollController(root).status,'paused');
 assert.equal(list(root)[0].status,'pending');
 setControllerMode(root,'stopped');
 assert.equal(controllerStatus(root).controller.status,'stopped');
});
test('collector only submits marked worker output while running',()=>{
 const root=setup(),folder=path.join(root,'workers','a','deliverables');
 fs.writeFileSync(path.join(folder,'result.txt'),'Finished');
 const marker=path.join(folder,'READY_FOR_REVIEW.json');
 fs.writeFileSync(marker,JSON.stringify({complete:true,summary:'Done'}));
 const old=new Date(Date.now()-2500);fs.utimesSync(marker,old,old);
 assert.equal(pollController(root).status,'stopped');
 assert.equal(list(root)[0].status,'pending');
 setControllerMode(root,'running');
 assert.deepEqual(pollController(root).collected.map(x=>x.id),['a']);
 assert.equal(list(root)[0].status,'submitted');
 assert.deepEqual(pollController(root).collected,[]);
});
test('sandbox cannot silently fall back to unrestricted execution',()=>{
 const root=setup();
 assert.equal(inspectSandbox(root,'a').enforced,false);
 assert.throws(()=>launchSandboxedWorker(),/Refusing to launch/);
 assert.throws(()=>inspectSandbox(root,'../a'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, add, list, pendingEvents } from '../src/workspace.mjs';
import { collectCompleted } from '../src/completion.mjs';
const setup=()=>{
 const root=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rea-collect-')),'workspace');
 init(root); add(root,{id:'alpha',title:'Alpha',instructions:'Analyze a file'});
 return root;
};
test('master collects a marked worker result once without worker MCP submit call',()=>{
 const root=setup();
 const out=path.join(root,'workers','alpha','deliverables');
 fs.writeFileSync(path.join(out,'report.md'),'Complete analysis');
 const marker=path.join(out,'READY_FOR_REVIEW.json');
 fs.writeFileSync(marker,JSON.stringify({complete:true,summary:'Analyzed input'}));
 const old=new Date(Date.now()-2000); fs.utimesSync(marker,old,old);
 const first=collectCompleted(root);
 assert.deepEqual(first.collected.map(x=>x.id),['alpha']);
 assert.equal(list(root)[0].status,'submitted');
 assert.equal(pendingEvents(root).filter(e=>e.type==='task_submitted').length,1);
 assert.deepEqual(collectCompleted(root).collected,[]);
});
test('collector requires final marker, nonempty deliverables and does not prematurely submit',()=>{
 const root=setup(),out=path.join(root,'workers','alpha','deliverables');
 assert.deepEqual(collectCompleted(root).collected,[]);
 const marker=path.join(out,'READY_FOR_REVIEW.json');
 fs.writeFileSync(marker,JSON.stringify({complete:true,summary:'done'}));
 const old=new Date(Date.now()-2000); fs.utimesSync(marker,old,old);
 assert.deepEqual(collectCompleted(root).collected,[]);
 assert.equal(list(root)[0].status,'pending');
});

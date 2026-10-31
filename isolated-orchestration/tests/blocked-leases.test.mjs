import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, add, list, submit, requestDependency, resolveDependencyRequest } from '../src/workspace.mjs';
import { claimTask, renewTask, releaseTask } from '../src/coordination.mjs';
import { provisionTextResource } from '../src/artifacts.mjs';

function workspace() {
 const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rea-blocked-')), 'root');
 init(root);
 add(root, { id: 'parser', title: 'Parser', instructions: 'Implement parser' });
 return root;
}
test('assigned worker retains ownership across required request and approval', () => {
 const root=workspace();
 claimTask(root,'parser','worker-A');
 const req=requestDependency(root,'parser',{type:'interface',name:'schema',reason:'Parser contract'},'worker-A');
 assert.equal(list(root)[0].status,'blocked');
 assert.throws(()=>claimTask(root,'parser','worker-B'));
 assert.equal(renewTask(root,'parser','worker-A').owner,'worker-A');
 resolveDependencyRequest(root,req.id,'approved','Accepted');
 assert.equal(list(root)[0].status,'blocked');
 resolveDependencyRequest(root,req.id,'provisioned','Staged');
 assert.equal(list(root)[0].status,'assigned');
 assert.throws(()=>submit(root,'parser','stolen','worker-B'));
 assert.equal(submit(root,'parser','complete','worker-A').status,'submitted');
});
test('explicit provisioner restores prior assignment and records digest', () => {
 const root=workspace();
 claimTask(root,'parser','worker-A');
 const req=requestDependency(root,'parser',{type:'documentation',name:'docs',reason:'Need docs'},'worker-A');
 resolveDependencyRequest(root,req.id,'approved','OK');
 const result=provisionTextResource(root,req.id,'README.txt','documentation');
 assert.ok(result.sha256);
 assert.equal(list(root)[0].status,'assigned');
 assert.equal(submit(root,'parser','done','worker-A').status,'submitted');
});

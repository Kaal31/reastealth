import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, add, list, ready, submit, requestDependency, listDependencyRequests, resolveDependencyRequest } from '../src/workspace.mjs';

function makeWorkspace() {
 const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rea-dependency-')), 'workspace');
 init(root);
 add(root, { id:'alpha', title:'Alpha', instructions:'Build module' });
 add(root, { id:'beta', title:'Beta', instructions:'Build other module' });
 return root;
}
test('required dependency request blocks worker until explicitly provisioned', () => {
 const root = makeWorkspace();
 const request = requestDependency(root, 'alpha', { type:'package', name:'sqlite', reason:'transactions', required:true });
 assert.equal(request.status,'pending');
 assert.deepEqual(ready(root).map(x=>x.id), ['beta']);
 assert.throws(()=>submit(root,'alpha','done'), /not ready/);
 resolveDependencyRequest(root,request.id,'approved','Approved for use');
 assert.throws(()=>submit(root,'alpha','done'), /not ready/);
 resolveDependencyRequest(root,request.id,'provisioned','Available locally');
 assert.deepEqual(ready(root).map(x=>x.id).sort(), ['alpha','beta']);
 assert.equal(submit(root,'alpha','implemented').status,'submitted');
});
test('optional requests do not stop work; status is scoped by task', () => {
 const root=makeWorkspace();
 const r=requestDependency(root,'alpha',{type:'documentation',name:'reference',reason:'Helpful',required:false});
 assert.deepEqual(ready(root).map(x=>x.id).sort(),['alpha','beta']);
 assert.equal(listDependencyRequests(root,'beta').length,0);
 assert.equal(listDependencyRequests(root,'alpha')[0].id,r.id);
 assert.throws(()=>resolveDependencyRequest(root,r.id,'provisioned'),/Approve before provisioning/);
 resolveDependencyRequest(root,r.id,'rejected','Not needed');
 assert.equal(listDependencyRequests(root,'alpha')[0].status,'rejected');
});
test('rejected required requests remain blocked and do not silently unblock', () => {
 const root=makeWorkspace();
 const r=requestDependency(root,'alpha',{type:'network',name:'internet',reason:'Download resource'});
 resolveDependencyRequest(root,r.id,'rejected','Use provided offline fixtures');
 assert.equal(list(root).find(t=>t.id==='alpha').status,'blocked');
 assert.throws(()=>submit(root,'alpha','done'));
});
test('invalid request and cross-task identifiers are rejected', () => {
 const root=makeWorkspace();
 assert.throws(()=>requestDependency(root,'../../../control',{type:'package',name:'a',reason:'b'}));
 assert.throws(()=>requestDependency(root,'alpha',{type:'invalid',name:'a',reason:'b'}));
 assert.throws(()=>requestDependency(root,'alpha',{type:'package',name:'',reason:'b'}));
 assert.deepEqual(listDependencyRequests(root,'beta'),[]);
});

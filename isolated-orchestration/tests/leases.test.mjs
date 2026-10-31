import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, add, list, submit } from '../src/workspace.mjs';
import { claimTask, renewTask, releaseTask, recoverExpired } from '../src/coordination.mjs';

const create = () => { const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rea-lease-')), 'project'); init(root); add(root,{ id:'alpha', title:'Alpha',instructions:'Build alpha' }); return root; };
test('claim is exclusive and recoverable', () => {
 const root=create();
 const first=claimTask(root,'alpha','worker-A');
 assert.equal(first.owner,'worker-A');
 assert.throws(()=>claimTask(root,'alpha','worker-B'),/already claimed/);
 assert.ok(Date.parse(renewTask(root,'alpha','worker-A').expiresAt) > Date.now());
 assert.throws(()=>releaseTask(root,'alpha','worker-B'),/Cannot release/);
 releaseTask(root,'alpha','worker-A');
 assert.equal(claimTask(root,'alpha','worker-B').owner,'worker-B');
 assert.equal(submit(root,'alpha','done','worker-B').status,'submitted');
 assert.throws(()=>claimTask(root,'alpha','worker-A'),/not available/);
});
test('expired task is reclaimed after process restart', () => {
 const root=create();
 claimTask(root,'alpha','first');
 const p=path.join(root,'control','task-map.json');
 const map=JSON.parse(fs.readFileSync(p,'utf8'));
 map.tasks[0].lease.expiresAt='2000-01-01T00:00:00.000Z';
 fs.writeFileSync(p,JSON.stringify(map));
 assert.deepEqual(recoverExpired(root), ['alpha']);
 assert.equal(claimTask(root,'alpha','second').owner,'second');
 assert.deepEqual(recoverExpired(root), []);
});

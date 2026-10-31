import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, add, ready, submit, review, scopedPath, workerWrite, workerRead } from '../src/workspace.mjs';

const workspace = () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-orchestration-'));
  const root = path.join(parent, 'project');
  init(root);
  return root;
};
test('dependency graph gates tasks until accepted', () => {
  const root = workspace();
  add(root, { id: 'a', title: 'A', instructions: 'Implement A' });
  add(root, { id: 'b', title: 'B', instructions: 'Implement B', dependencies: ['a'] });
  assert.deepEqual(ready(root).map(x => x.id), ['a']);
  submit(root, 'a', 'done');
  assert.deepEqual(ready(root).map(x => x.id), []);
  review(root, 'a', true);
  assert.deepEqual(ready(root).map(x => x.id), ['b']);
});
test('worker path traversal and master access are rejected by bridge', () => {
  const root = workspace();
  add(root, { id: 'a', title: 'A', instructions: 'A' });
  assert.throws(() => scopedPath(root, 'a', '../../control/master-plan.md'));
  assert.throws(() => scopedPath(root, 'a', '/tmp/secret'));
  assert.throws(() => scopedPath(root, 'a', '..\\..\\control\\master-plan.md'));
});
test('worker writes only to its deliverables and cannot read sibling files via bridge', () => {
  const root = workspace();
  add(root, { id: 'a', title: 'A', instructions: 'A' });
  add(root, { id: 'b', title: 'B', instructions: 'B' });
  workerWrite(root, 'a', 'deliverables/result.txt', 'success');
  assert.equal(workerRead(root, 'a', 'deliverables/result.txt'), 'success');
  assert.throws(() => workerWrite(root, 'a', 'TASK.md', 'replace'));
  assert.throws(() => workerRead(root, 'a', '../b/TASK.md'));
});

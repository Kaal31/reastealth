import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, add, submit } from '../src/workspace.mjs';
import { watchSubmissions } from '../src/watch.mjs';

test('watcher emits submission exactly once and recovers after restart', async () => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rea-watch-')), 'workspace');
  init(root);
  add(root, { id: 'alpha', title: 'Alpha', instructions: 'Complete alpha' });
  const collected = [];
  const stop = watchSubmissions(root, e => collected.push(e));
  try {
    submit(root, 'alpha', 'complete');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(collected.length, 1);
    assert.equal(collected[0].taskId, 'alpha');
  } finally { stop(); }
  const recovered = [];
  const stopRecovered = watchSubmissions(root, e => recovered.push(e));
  try {
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].summary, 'complete');
  } finally { stopRecovered(); }
});

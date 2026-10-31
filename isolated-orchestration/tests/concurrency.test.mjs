import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { init, list } from '../src/workspace.mjs';
const workspaceModule = fileURLToPath(new URL('../src/workspace.mjs', import.meta.url));
test('concurrent processes preserve every task', async () => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rea-concurrency-')), 'work');
  init(root);
  const workers = Array.from({ length: 16 }, (_, i) => i);
  await Promise.all(workers.map(i => new Promise((resolve, reject) => {
    const script = "import {add} from " + JSON.stringify(pathToFileURL(workspaceModule).href) + ";add(" + JSON.stringify(root) + ",{id:'task-" + i + "',title:'Task',instructions:'work'});";
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore','pipe','pipe'] });
    let err = ''; child.stderr.on('data', d => { err += d; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(err || 'Exit ' + code)));
  })));
  assert.equal(list(root).length, workers.length);
});

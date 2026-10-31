import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { init, add } from '../src/workspace.mjs';

async function session(role, root, task) {
  const proc = spawn(process.execPath, [new URL('../src/mcp.mjs', import.meta.url).pathname, '--role', role, '--workspace', root, ...(task ? ['--task', task] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let counter = 0;
  const callbacks = new Map();
  createInterface({ input: proc.stdout }).on('line', line => {
    const msg = JSON.parse(line), resolve = callbacks.get(msg.id);
    if (resolve) { callbacks.delete(msg.id); resolve(msg); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { callbacks.delete(id); reject(new Error('Timed out waiting for MCP')); }, 3000);
    callbacks.set(id, msg => { clearTimeout(timer); resolve(msg); });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return { call, close: () => proc.kill() };
}
test('same MCP implementation exposes different fixed role tool lists', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-role-'));
  const root = path.join(base, 'work');
  init(root);
  add(root, { id: 'parser', title: 'Parser', instructions: 'Write a parser' });
  const master = await session('master', root);
  const worker = await session('worker', root, 'parser');
  try {
    const m = await master.call('tools/list');
    const w = await worker.call('tools/list');
    assert.ok(m.result.tools.some(t => t.name === 'create_task'));
    assert.ok(!w.result.tools.some(t => t.name === 'create_task'));
    assert.deepEqual(w.result.tools.map(t => t.name), ['get_task', 'submit_result', 'report_blocker']);
    const denied = await worker.call('tools/call', { name: 'list_tasks', arguments: {} });
    assert.equal(denied.error.code, -32601);
    const assigned = await worker.call('tools/call', { name: 'get_task', arguments: {} });
    assert.match(assigned.result.content[0].text, /Write a parser/);
  } finally { master.close(); worker.close(); }
});

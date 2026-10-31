import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const script = fileURLToPath(new URL('../src/mcp.mjs', import.meta.url));
function session(role, root, task) {
  const proc = spawn(process.execPath, [script, '--role', role, '--workspace', root, ...(task ? ['--task', task] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', sequence = 0;
  const waiting = new Map();
  proc.stdout.on('data', data => {
    buffer += data.toString();
    let pos;
    while ((pos = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (waiting.has(msg.id)) { const entry = waiting.get(msg.id); waiting.delete(msg.id); clearTimeout(entry.timer); entry.resolve(msg); }
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('MCP timed out: ' + method)); }, 5000);
    waiting.set(id, { resolve, timer });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return { proc, request, call: (name, args = {}) => request('tools/call', { name, arguments: args }), close: () => proc.kill() };
}
function unwrap(msg) {
  assert.ok(!msg.error && !msg.result?.isError, JSON.stringify(msg));
  return JSON.parse(msg.result.content[0].text);
}
test('live MCP master-worker lifecycle and dependency unlocking', async () => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rea-e2e-')), 'workspace');
  const master = session('master', root);
  let worker;
  try {
    const hello = await master.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ci', version: '1' } });
    assert.equal(hello.result.serverInfo.name, 'rea-stealth-isolated-orchestration');
    unwrap(await master.call('init_workspace'));
    unwrap(await master.call('create_task', { id: 'alpha', title: 'Alpha', instructions: 'Implement alpha' }));
    unwrap(await master.call('create_task', { id: 'beta', title: 'Beta', instructions: 'Implement beta', dependencies: ['alpha'] }));
    worker = session('worker', root, 'alpha');
    assert.deepEqual((await worker.request('tools/list')).result.tools.map(t => t.name), ['get_task', 'submit_result', 'renew_lease', 'release_task', 'request_dependency', 'get_request_status', 'report_blocker']);
    assert.match(unwrap(await worker.call('get_task')).task, /Implement alpha/);
    assert.equal((await worker.call('list_tasks')).error.code, -32601);
    assert.deepEqual(unwrap(await master.call('ready_tasks')).map(t => t.id), []);
    fs.writeFileSync(path.join(root, 'workers', 'alpha', 'deliverables', 'output.txt'), 'completed');
    unwrap(await worker.call('submit_result', { summary: 'Implemented and saved files' }));
    assert.deepEqual(unwrap(await master.call('ready_tasks')), []);
    assert.match(unwrap(await master.call('read_result', { id: 'alpha' })).summary, /saved files/);
    unwrap(await master.call('review_task', { id: 'alpha', accepted: true }));
    assert.deepEqual(unwrap(await master.call('ready_tasks')).map(t => t.id), ['beta']);
  } finally { worker?.close(); master.close(); }
});
test('simultaneous worker MCP sessions get no sibling instructions', async () => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rea-multi-')), 'workspace');
  const master = session('master', root);
  let a, b;
  try {
    unwrap(await master.call('init_workspace'));
    unwrap(await master.call('create_task', { id: 'first', title: 'First', instructions: 'Unique FIRST payload' }));
    unwrap(await master.call('create_task', { id: 'second', title: 'Second', instructions: 'Unique SECOND payload' }));
    a = session('worker', root, 'first');
    b = session('worker', root, 'second');
    const [one, two] = await Promise.all([a.call('get_task'), b.call('get_task')]);
    assert.match(unwrap(one).task, /Unique FIRST/);
    assert.doesNotMatch(JSON.stringify(one), /Unique SECOND/);
    assert.match(unwrap(two).task, /Unique SECOND/);
    assert.doesNotMatch(JSON.stringify(two), /Unique FIRST/);
  } finally { a?.close(); b?.close(); master.close(); }
});


test('MCP dependency requests are role-scoped and unblock on provisioning', async () => {
 const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rea-req-mcp-')), 'workspace');
 const master = session('master', root);
 let worker, sibling;
 try {
  unwrap(await master.call('init_workspace'));
  unwrap(await master.call('create_task', { id:'primary', title:'Primary', instructions:'Write code' }));
  unwrap(await master.call('create_task', { id:'sibling', title:'Sibling', instructions:'Other task' }));
  worker = session('worker', root, 'primary');
  sibling = session('worker', root, 'sibling');
  const req = unwrap(await worker.call('request_dependency', { type:'package', name:'sqlite', reason:'Need transactions', required:true }));
  assert.equal(req.status, 'pending');
  assert.deepEqual(unwrap(await master.call('ready_tasks')).map(t => t.id), ['sibling']);
  const denied = await worker.call('resolve_dependency_request', { requestId:req.id,status:'approved' });
  assert.equal(denied.error.code, -32601);
  assert.equal(unwrap(await sibling.call('get_request_status')).length, 0);
  assert.equal(unwrap(await master.call('list_dependency_requests')).length, 1);
  unwrap(await master.call('resolve_dependency_request', { requestId:req.id,status:'approved',response:'Validated' }));
  assert.equal(unwrap(await worker.call('get_request_status'))[0].status, 'approved');
  assert.equal((await worker.call('submit_result', { summary:'premature' })).result.isError, true);
  unwrap(await master.call('resolve_dependency_request', { requestId:req.id,status:'provisioned',response:'Available in workspace' }));
  assert.deepEqual(unwrap(await master.call('ready_tasks')).map(t => t.id).sort(), ['primary','sibling']);
  assert.equal(unwrap(await worker.call('get_request_status'))[0].status, 'provisioned');
 } finally { worker?.close(); sibling?.close(); master.close(); }
});

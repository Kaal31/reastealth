#!/usr/bin/env node
// Standalone MCP stdio endpoint: one implementation, master/worker tool profiles.
// stdout is reserved for JSON-RPC. No external model API or server dependencies.
import { createInterface } from 'node:readline';
import { claimTask, renewTask, releaseTask, recoverExpired, makeWorkerIdentity } from './coordination.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { init, add, list, ready, submit, review, workerRead, workerWrite, requestDependency, listDependencyRequests, resolveDependencyRequest, pendingEvents, acknowledgeEvent } from './workspace.mjs';

const args = process.argv.slice(2);
const option = key => { const i = args.indexOf('--' + key); return i >= 0 ? args[i + 1] : undefined; };
const role = option('role');
const root = option('workspace');
const task = option('task');
const sessionOwner = makeWorkerIdentity();
if (!['master', 'worker'].includes(role) || !root || (role === 'worker' && !task)) {
  console.error('Usage: node src/mcp.mjs --role master|worker --workspace PATH [--task TASK_ID]');
  process.exit(2);
}
if (role === 'worker' && (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(task) || !fs.existsSync(path.join(path.resolve(root), 'workers', task, 'TASK.md')))) {
  console.error('Worker task is missing or invalid');
  process.exit(2);
}
const str = { type: 'string' };
const tools = {
  master: [
    ['init_workspace', 'Initialize a new empty workspace', { type: 'object', properties: {} }, () => init(root)],
    ['recover_expired', 'Return expired worker assignments to the queue', { type: 'object', properties: {} }, () => recoverExpired(root)],
    ['pending_events', 'Read durable worker submission events', { type: 'object', properties: {} }, () => pendingEvents(root)],
    ['acknowledge_event', 'Acknowledge a processed submission event', { type: 'object', properties: { id: str }, required: ['id'] }, a => acknowledgeEvent(root, a.id)],
    ['list_tasks', 'Show all tasks and statuses', { type: 'object', properties: {} }, () => list(root)],
    ['ready_tasks', 'Show tasks whose dependencies are accepted', { type: 'object', properties: {} }, () => ready(root)],
    ['create_task', 'Create an isolated project task', { type: 'object', properties: { id: str, title: str, instructions: str, dependencies: { type: 'array', items: str }, acceptance: { type: 'array', items: str } }, required: ['id', 'title', 'instructions'] }, a => ({ directory: add(root, a) })],
    ['review_task', 'Accept or reject submitted work', { type: 'object', properties: { id: str, accepted: { type: 'boolean' }, notes: str }, required: ['id', 'accepted'] }, a => review(root, a.id, a.accepted, a.notes)],
    ['list_dependency_requests', 'Review dependency requests across worker projects', { type: 'object', properties: {} }, () => listDependencyRequests(root)],
    ['resolve_dependency_request', 'Approve, reject, ask clarification or mark an approved dependency provisioned', { type: 'object', properties: { requestId: str, status: { type: 'string', enum: ['approved','rejected','needs_clarification','provisioned'] }, response: str }, required: ['requestId', 'status'] }, a => resolveDependencyRequest(root, a.requestId, a.status, a.response)],
    ['read_result', 'Read a worker submission summary (not the whole project)', { type: 'object', properties: { id: str }, required: ['id'] }, a => { if (!list(root).some(t => t.id === a.id)) throw Error('Unknown task'); return JSON.parse(fs.readFileSync(path.join(path.resolve(root), 'results', a.id + '.json'), 'utf8')); }]
  ],
  worker: [
    ['get_task', 'Get only your assigned task instructions', { type: 'object', properties: {} }, () => ({ lease: claimTask(root, task, sessionOwner), task: workerRead(root, task, 'TASK.md') })],
    ['submit_result', 'Submit your own project for review', { type: 'object', properties: { summary: str }, required: ['summary'] }, a => submit(root, task, a.summary, sessionOwner)],
    ['renew_lease', 'Keep this worker assignment active', { type: 'object', properties: {} }, () => renewTask(root, task, sessionOwner)],
    ['release_task', 'Release current assignment for rescheduling', { type: 'object', properties: {} }, () => releaseTask(root, task, sessionOwner)],
    ['request_dependency', 'Request an external package, tool, contract, fixture, network permission or subtask; required requests block submission', { type: 'object', properties: { type: { type: 'string', enum: ['package','tool','documentation','interface','fixture','network','subtask','other'] }, name: str, reason: str, required: { type: 'boolean' } }, required: ['type','name','reason'] }, a => requestDependency(root, task, a)],
    ['get_request_status', 'View only dependency requests belonging to your assigned project', { type: 'object', properties: {} }, () => listDependencyRequests(root, task)],
    ['report_blocker', 'Report an obstacle for your task', { type: 'object', properties: { message: str }, required: ['message'] }, a => { const folder = path.join(path.resolve(root), 'workers', task, 'deliverables'); fs.mkdirSync(folder, { recursive: true }); workerWrite(root, task, 'deliverables/BLOCKER.md', a.message + '\n'); return { recorded: true }; }]
  ]
};
const available = new Map(tools[role].map(([name, description, inputSchema, fn]) => [name, { name, description, inputSchema, fn }]));
const respond = obj => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
const error = (id, code, message) => respond({ id, error: { code, message } });
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  let req;
  try { req = JSON.parse(line); } catch { error(null, -32700, 'Invalid JSON'); return; }
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') { error(req?.id ?? null, -32600, 'Invalid request'); return; }
  if (req.id === undefined) return; // MCP notifications have no response
  const id = req.id;
  try {
    if (req.method === 'initialize') {
      respond({ id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'rea-stealth-isolated-orchestration', version: '0.2.0' } } });
    } else if (req.method === 'ping') respond({ id, result: {} });
    else if (req.method === 'tools/list') {
      respond({ id, result: { tools: [...available.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    } else if (req.method === 'tools/call') {
      const entry = available.get(req.params?.name);
      if (!entry) { error(id, -32601, 'Tool not found'); return; }
      const a = req.params?.arguments ?? {};
      if (!a || typeof a !== 'object' || Array.isArray(a)) throw Error('Expected object arguments');
      for (const key of entry.inputSchema.required ?? []) if (!(key in a)) throw Error('Missing required argument: ' + key);
      const result = entry.fn(a);
      respond({ id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
    } else error(id, -32601, 'Method not found');
  } catch (e) { respond({ id, result: { isError: true, content: [{ type: 'text', text: e.message }] } }); }
});

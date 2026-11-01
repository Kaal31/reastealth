import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
function taskId(id) {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new Error('Invalid task ID');
  return id;
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temp, file);
}
// Cross-process registry lock with conservative dead-owner recovery.
// A live owner is never preempted. File writes use atomic replacement.
const pause = new Int32Array(new SharedArrayBuffer(4));
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}
function recoverAbandonedLock(lockPath) {
  let stat;
  try { stat = fs.statSync(lockPath); }
  catch { return; }
  if (Date.now() - stat.mtimeMs < 3000) return;
  const ownerFile = path.join(lockPath, 'owner.json');
  let owner;
  try { owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8')); } catch {}
  // Without a readable owner, wait a full timeout before recovering.
  if (!owner && Date.now() - stat.mtimeMs < 15000) return;
  if (owner && Number.isInteger(owner.pid) && alive(owner.pid)) return;
  const abandoned = lockPath + '.abandoned-' + crypto.randomUUID();
  try {
    fs.renameSync(lockPath, abandoned);
    fs.rmSync(abandoned, { recursive: true, force: true });
  } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'EACCES') throw e; }
}
function withMapLock(p, action) {
  const lockPath = path.join(p.control, '.task-map.lock');
  const deadline = Date.now() + 20000;
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      recoverAbandonedLock(lockPath);
      if (Date.now() >= deadline) throw new Error('Task registry busy; lock timeout: ' + lockPath);
      Atomics.wait(pause, 0, 0, 25);
    }
  }
  try { return action(); }
  finally { fs.rmSync(lockPath, { recursive: true, force: true }); }
}
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const paths = root => {
  const base = path.resolve(root);
  return { root: base, control: path.join(base, 'control'), workers: path.join(base, 'workers'), results: path.join(base, 'results') };
};
const mapFile = p => path.join(p.control, 'task-map.json');
const workerDir = (p, id) => path.join(p.workers, taskId(id));

export function init(root) {
  const p = paths(root);
  if (fs.existsSync(p.root) && fs.readdirSync(p.root).length) throw new Error('Workspace must be empty');
  for (const dir of [p.control, p.workers, p.results]) fs.mkdirSync(dir, { recursive: true });
  writeJson(mapFile(p), { schemaVersion: 1, tasks: [], dependencyRequests: [], events: [] });
  writeJson(path.join(p.control, 'master-mcp.json'), {
    mcpServers: {
      'rea-orchestrator': {
        type: 'stdio',
        command: process.execPath,
        args: [fileURLToPath(new URL('./mcp.mjs', import.meta.url)), '--role', 'master', '--workspace', p.root]
      }
    }
  });
  fs.writeFileSync(path.join(p.control, 'master-plan.md'), '# Master plan\n\nOrchestrator-only context.\n');
  return p;
}
export function transaction(root, action) {
  const p = paths(root);
  return withMapLock(p, () => {
    const map = readJson(mapFile(p));
    const result = action(map);
    writeJson(mapFile(p), map);
    return result;
  });
}
export function pendingEvents(root) { return (readJson(mapFile(paths(root))).events ?? []).filter(x => !x.acknowledgedAt); }
export function acknowledgeEvent(root, id) {
  return transaction(root, map => {
    const event = (map.events ?? []).find(x => x.id === id);
    if (!event) throw Error('Unknown event');
    event.acknowledgedAt ??= new Date().toISOString();
    return event;
  });
}
export function list(root) { return readJson(mapFile(paths(root))).tasks; }
export function ready(root) {
  const map = readJson(mapFile(paths(root)));
  const tasks = map.tasks;
  const accepted = new Set(tasks.filter(x => x.status === 'accepted').map(x => x.id));
  return tasks.filter(x => x.status === 'pending' && x.dependencies.every(id => accepted.has(id)) && !(map.dependencyRequests ?? []).some(r => r.taskId === x.id && r.required && r.status !== 'provisioned'));
}
export function add(root, spec) {
  const p = paths(root), id = taskId(spec.id);
  return withMapLock(p, () => {
  const map = readJson(mapFile(p));
  if (map.tasks.some(t => t.id === id)) throw new Error('Duplicate task ID');
  if (typeof spec.title !== 'string' || typeof spec.instructions !== 'string') throw new Error('Title and instructions are required');
  const deps = spec.dependencies ?? [];
  if (!Array.isArray(deps) || deps.some(d => !map.tasks.some(t => t.id === d))) throw new Error('Unknown dependency');
  const dir = workerDir(p, id);
  if (fs.existsSync(dir)) throw new Error('Task directory already exists');
  fs.mkdirSync(path.join(dir, 'deliverables'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'TASK.md'), [
    '# ' + spec.title,
    '',
    '## Assignment',
    spec.instructions,
    '',
    '## Workspace boundaries',
    '- Use this allocated task directory as your working scope. Keep file operations here and leave files outside it unchanged.',
    '- Use only inputs/ and explicitly provisioned resources/ as source material. Treat them as read-only.',
    '- Write all deliverables under deliverables/. Do not write outside this worker directory.',
    '- No network access, package installation, external tools, or new agents unless the orchestrator explicitly authorizes the dependency.',
    '- Focus on the specified assignment and its acceptance criteria.',
    '',
    '## Acceptance criteria',
    ...(spec.acceptance ?? []).map(x => '- ' + x),
    '',
    '## Completion',
    '- Validate the supplied acceptance criteria and record any limitations.',
    '- Finish by creating deliverables/READY_FOR_REVIEW.json with {"complete":true,"summary":"..."} as the final operation.',
    '- Stop after completion. The master reviews and integrates the work.',
    ''
  ].join('\n'));
  writeJson(path.join(dir, 'task.json'), { id, title: spec.title, dependencies: deps, status: 'pending' });
  // Independent Claude Code project: no master plan, sibling source, or global task map.
  // This configuration is advisory isolation until Windows account/NTFS enforcement.
  const mcpEntry = fileURLToPath(new URL('./mcp.mjs', import.meta.url));
  writeJson(path.join(dir, '.mcp.json'), {
    mcpServers: {
      'rea-worker': {
        type: 'stdio',
        command: process.execPath,
        args: [mcpEntry, '--role', 'worker', '--workspace', p.root, '--task', id]
      }
    }
  });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  writeJson(path.join(dir, '.claude', 'settings.json'), {
    autoMemoryEnabled: false,
    enableAllProjectMcpServers: false
  });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
    '# Goldfish worker policy',
    '',
    'You are a fresh, independent, single-task execution agent. The master owns overall project planning and integration.',
    '',
    '## Scope and context',
    '- Read TASK.md and follow its single assignment only.',
    '- Keep analysis and file operations focused on this allocated task directory. Leave unrelated files and folders unchanged.',
    '- Work from the provided inputs/ and approved resources/ when completing this assignment.',
    '- Concentrate on the behavior and interfaces relevant to this assignment.',
    '- Treat inputs/ and resources/ as read-only; save new files only inside deliverables/.',
    '- Do not access the network, install dependencies, or invoke unrelated external tools without orchestrator approval.',
    '',
    '## Execution and delegation',
    '- Work independently. Do not create subagents, start other workers, or delegate the task.',
    '- Do not reuse prior conversations or import outside task context.',
    '- Never expand your assignment without approval. If information is missing, use rea-worker.request_dependency when available or write deliverables/BLOCKER.md.',
    '- No original REA analysis MCP is part of this worker assignment; do not attempt to discover or connect it.',
    '- Use rea-worker MCP only for task claiming, status, requests, and optional submission if it is connected.',
    '',
    '## Completion',
    '- Test or validate against TASK.md acceptance criteria and report uncertainty accurately.',
    '- Save outputs only in deliverables/. Do not edit the source inputs.',
    '- When fully finished, create deliverables/READY_FOR_REVIEW.json as the FINAL filesystem operation with JSON: {"complete":true,"summary":"What was completed and validated"}. The master-side collector handles submission.',
    '- Do not mark work complete when unresolved requirements remain. Report blockers instead.',
    '- Stop after completion; the next fragment belongs to a fresh session.',
    '',
    'These project rules guide agent behavior; they are not a filesystem or network security boundary.',
    ''
  ].join('\n'));

  map.tasks.push({ id, title: spec.title, dependencies: deps, status: 'pending' });
  writeJson(mapFile(p), map);
  return dir;
  });
}
export function submit(root, id, summary = '', leaseOwner = undefined) {
  const p = paths(root);
  return withMapLock(p, () => {
  const map = readJson(mapFile(p)), task = map.tasks.find(t => t.id === taskId(id));
  if (!task || !['pending', 'assigned'].includes(task.status) || (task.status === 'assigned' && (!leaseOwner || task.lease?.owner !== leaseOwner || Date.parse(task.lease.expiresAt) <= Date.now())) || (map.dependencyRequests ?? []).some(r => r.taskId === id && r.required && r.status !== 'provisioned') || !task.dependencies.every(d => map.tasks.some(t => t.id === d && t.status === 'accepted'))) throw new Error('Task not ready');
  task.status = 'submitted';
  delete task.lease;
  delete task.previousStatus;
  const submittedAt = new Date().toISOString();
  writeJson(path.join(p.results, id + '.json'), { id, summary, submittedAt });
  map.events ??= [];
  map.events.push({ id: crypto.randomUUID(), type: 'task_submitted', taskId: id, at: submittedAt });
  writeJson(mapFile(p), map);
  return task;
  });
}
export function review(root, id, accepted, notes = '') {
  const p = paths(root);
  return withMapLock(p, () => {
    const map = readJson(mapFile(p)), task = map.tasks.find(t => t.id === taskId(id));
    if (!task || task.status !== 'submitted') throw new Error('Task not submitted');
    task.status = accepted ? 'accepted' : 'pending';
    writeJson(path.join(p.results, id + '-review.json'), { id, accepted: !!accepted, notes, reviewedAt: new Date().toISOString() });
    writeJson(mapFile(p), map);
    return task;
  });
}

const requestTypes = new Set(['package', 'tool', 'documentation', 'interface', 'fixture', 'network', 'subtask', 'other']);
const requestStatuses = new Set(['approved', 'rejected', 'needs_clarification', 'provisioned']);
export function requestDependency(root, id, spec, leaseOwner = undefined) {
  const p = paths(root);
  return withMapLock(p, () => {
    const map = readJson(mapFile(p));
    const task = map.tasks.find(t => t.id === taskId(id));
    if (!task || !['pending', 'blocked', 'assigned'].includes(task.status)) throw new Error('Task not accepting requests');
    if ((task.status === 'assigned' || (task.status === 'blocked' && task.lease)) && (task.lease?.owner !== leaseOwner || Date.parse(task.lease.expiresAt) <= Date.now())) throw new Error('Worker lease required');
    if (!spec || !requestTypes.has(spec.type) || typeof spec.name !== 'string' || !spec.name.trim() ||
        typeof spec.reason !== 'string' || !spec.reason.trim()) throw new Error('Invalid dependency request');
    const request = {
      id: crypto.randomUUID(), taskId: id, type: spec.type, name: spec.name.slice(0, 256),
      reason: spec.reason.slice(0, 4000), required: spec.required !== false,
      status: 'pending', response: '', createdAt: new Date().toISOString()
    };
    map.dependencyRequests ??= [];
    map.dependencyRequests.push(request);
    if (request.required) { if (task.status !== 'blocked') task.previousStatus = task.status; task.status = 'blocked'; }
    writeJson(mapFile(p), map);
    return request;
  });
}
export function listDependencyRequests(root, task = undefined) {
  const map = readJson(mapFile(paths(root)));
  if (task !== undefined) taskId(task);
  return (map.dependencyRequests ?? []).filter(r => task === undefined || r.taskId === task);
}
export function resolveDependencyRequest(root, requestId, status, response = '') {
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId) || !requestStatuses.has(status)) throw new Error('Invalid resolution');
  const p = paths(root);
  return withMapLock(p, () => {
    const map = readJson(mapFile(p));
    const r = (map.dependencyRequests ?? []).find(x => x.id === requestId);
    if (!r || !['pending', 'needs_clarification', 'approved'].includes(r.status)) throw new Error('Request cannot be resolved');
    if (status === 'provisioned' && r.status !== 'approved') throw new Error('Approve before provisioning');
    r.status = status;
    r.response = String(response).slice(0, 4000);
    r.updatedAt = new Date().toISOString();
    const task = map.tasks.find(t => t.id === r.taskId);
    // Only provisioned or rejected required requests unblock; rejection leaves an explanation for the worker.
    // A rejected request is NOT considered satisfied: worker must revise or submit a new request.
    if (task?.status === 'blocked' && !(map.dependencyRequests ?? []).some(x =>
      x.taskId === task.id && x.required && x.status !== 'provisioned')) {
      task.status = task.previousStatus === 'assigned' && task.lease && Date.parse(task.lease.expiresAt) > Date.now() ? 'assigned' : 'pending';
      delete task.previousStatus;
      if (task.status !== 'assigned') delete task.lease;
    }
    writeJson(mapFile(p), map);
    return r;
  });
}
// Validates a path for bridge-mediated access. Does not restrict an untrusted desktop process.
export function scopedPath(root, id, relative) {
  const p = paths(root), base = workerDir(p, id);
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Path outside worker scope');
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw new Error('Path outside worker scope');
  for (let current = target; current !== path.dirname(current); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink denied');
  }
  return target;
}
export function workerRead(root, id, file) { return fs.readFileSync(scopedPath(root, id, file), 'utf8'); }
export function workerWrite(root, id, file, content) {
  if (typeof file !== 'string' || !file.replaceAll('\\', '/').startsWith('deliverables/')) throw new Error('Workers write only under deliverables/');
  const target = scopedPath(root, id, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Revalidate after mkdir; filesystem race protection requires OS-level sandboxing.
  scopedPath(root, id, file);
  fs.writeFileSync(target, content, { flag: 'w' });
  return target;
}

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
// Synchronous cross-process lock: all task-map read/modify/write operations use it.
// Conservative timeout avoids silently stealing a lock from a live process.
const pause = new Int32Array(new SharedArrayBuffer(4));
function withMapLock(p, action) {
  const lockPath = path.join(p.control, '.task-map.lock');
  const deadline = Date.now() + 15000;
  let acquired = false;
  while (!acquired) {
    try {
      fs.mkdirSync(lockPath);
      acquired = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline) throw new Error('Task registry busy; lock timeout: ' + lockPath);
      Atomics.wait(pause, 0, 0, 20);
    }
  }
  try { return action(); }
  finally { fs.rmdirSync(lockPath); }
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
  writeJson(mapFile(p), { schemaVersion: 1, tasks: [] });
  fs.writeFileSync(path.join(p.control, 'master-plan.md'), '# Master plan\n\nOrchestrator-only context.\n');
  return p;
}
export function list(root) { return readJson(mapFile(paths(root))).tasks; }
export function ready(root) {
  const map = readJson(mapFile(paths(root)));
  const tasks = map.tasks;
  const accepted = new Set(tasks.filter(x => x.status === 'accepted').map(x => x.id));
  return tasks.filter(x => x.status === 'pending' && x.dependencies.every(id => accepted.has(id)));
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
  fs.writeFileSync(path.join(dir, 'TASK.md'), '# ' + spec.title + '\n\n' + spec.instructions + '\n\n## Acceptance criteria\n' + (spec.acceptance ?? []).map(x => '- ' + x).join('\n') + '\n');
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
    '# Assigned worker project',
    'Only implement the task described in TASK.md inside this project folder.',
    'Do not inspect parent directories, sibling projects, or other repositories.',
    'Use the rea-worker MCP for dependency requests, status, and completion.',
    'Save implementation files under deliverables/. Do not mark work complete until tests pass.',
    'Report external dependencies and missing interfaces to the orchestrator through request_dependency.',
    ''
  ].join('\n'));

  map.tasks.push({ id, title: spec.title, dependencies: deps, status: 'pending' });
  writeJson(mapFile(p), map);
  return dir;
  });
}
export function submit(root, id, summary = '') {
  const p = paths(root);
  return withMapLock(p, () => {
  const map = readJson(mapFile(p)), task = map.tasks.find(t => t.id === taskId(id));
  if (!task || task.status !== 'pending' || (map.dependencyRequests ?? []).some(r => r.taskId === id && r.required && r.status !== 'provisioned') || !task.dependencies.every(d => map.tasks.some(t => t.id === d && t.status === 'accepted'))) throw new Error('Task not ready');
  task.status = 'submitted';
  writeJson(path.join(p.results, id + '.json'), { id, summary, submittedAt: new Date().toISOString() });
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
export function requestDependency(root, id, spec) {
  const p = paths(root);
  return withMapLock(p, () => {
    const map = readJson(mapFile(p));
    const task = map.tasks.find(t => t.id === taskId(id));
    if (!task || !['pending', 'blocked'].includes(task.status)) throw new Error('Task not accepting requests');
    if (!spec || !requestTypes.has(spec.type) || typeof spec.name !== 'string' || !spec.name.trim() ||
        typeof spec.reason !== 'string' || !spec.reason.trim()) throw new Error('Invalid dependency request');
    const request = {
      id: crypto.randomUUID(), taskId: id, type: spec.type, name: spec.name.slice(0, 256),
      reason: spec.reason.slice(0, 4000), required: spec.required !== false,
      status: 'pending', response: '', createdAt: new Date().toISOString()
    };
    map.dependencyRequests ??= [];
    map.dependencyRequests.push(request);
    if (request.required) task.status = 'blocked';
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
      x.taskId === task.id && x.required && !['provisioned'].includes(x.status))) task.status = 'pending';
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

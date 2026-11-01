import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { add, list } from './workspace.mjs';

const validId = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(x);
const relativeFile = x => typeof x === 'string' && x.length > 0 && !path.isAbsolute(x) &&
  !/^[A-Za-z]:/.test(x) && !x.split(/[\\/]/).some(s => !s || s === '.' || s === '..');
const MAX_FILES = 12, MAX_FILE_BYTES = 256 * 1024, MAX_TASK_BYTES = 512 * 1024;
function readSource(source, name) {
  if (!relativeFile(name)) throw Error('Invalid relative source path: ' + name);
  const base = fs.realpathSync(source);
  const full = path.resolve(base, name);
  if (!full.startsWith(base + path.sep)) throw Error('Source escapes root');
  const stat = fs.lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Source must be a regular file');
  const real = fs.realpathSync(full);
  if (!real.startsWith(base + path.sep)) throw Error('Symlink escape denied');
  if (stat.size > MAX_FILE_BYTES) throw Error('Source exceeds per-file budget: ' + name);
  return fs.readFileSync(full);
}
export function planFragments(root, source, manifest) {
  if (!manifest || !Array.isArray(manifest.tasks) || !manifest.tasks.length || manifest.tasks.length > 128)
    throw Error('Expected 1..128 fragment tasks');
  if (!fs.statSync(source).isDirectory()) throw Error('Invalid source directory');
  const existing = new Set(list(root).map(t => t.id));
  const seen = new Set();
  const planned = [];
  for (const task of manifest.tasks) {
    if (!validId(task.id) || existing.has(task.id) || seen.has(task.id))
      throw Error('Invalid or duplicate task ID: ' + task.id);
    if (typeof task.title !== 'string' || !task.title.trim() ||
        typeof task.instructions !== 'string' || !task.instructions.trim())
      throw Error('Fragment title and instructions required');
    if (!Array.isArray(task.files) || task.files.length < 1 || task.files.length > MAX_FILES ||
        new Set(task.files).size !== task.files.length) throw Error('Invalid fragment file list');
    if (task.dependencies !== undefined && (!Array.isArray(task.dependencies) || !task.dependencies.every(validId)))
      throw Error('Invalid dependencies');
    if (task.acceptance !== undefined && (!Array.isArray(task.acceptance) || !task.acceptance.every(x => typeof x === 'string')))
      throw Error('Invalid acceptance criteria');
    const inputs = task.files.map(name => ({name, bytes: readSource(source, name)}));
    const bytes = inputs.reduce((n,x)=>n+x.bytes.length,0);
    if (bytes > MAX_TASK_BYTES) throw Error('Fragment exceeds context budget: ' + task.id);
    planned.push({ id:task.id,title:task.title,instructions:task.instructions,
      dependencies:task.dependencies ?? [],acceptance:task.acceptance ?? [],inputs,bytes });
    seen.add(task.id);
  }
  const byId = new Map(planned.map((t,i) => [t.id,i]));
  for (let i=0;i<planned.length;i++) for (const dep of planned[i].dependencies) {
    if (!existing.has(dep) && (!byId.has(dep) || byId.get(dep) >= i))
      throw Error('Dependency must exist or precede its fragment: ' + dep);
  }
  return planned;
}
export function createFragments(root, source, manifest, {dryRun = true} = {}) {
  const plan = planFragments(root, source, manifest);
  if (dryRun) return {dryRun:true, tasks:plan.map(t=>({
    id:t.id,files:t.inputs.map(x=>x.name),bytes:t.bytes,dependencies:t.dependencies
  }))};
  const created=[];
  for (const fragment of plan) {
    const instructions = fragment.instructions + '\n\n## Input files\n' +
      fragment.inputs.map(x => '- inputs/' + x.name).join('\n') +
      '\n\nOnly use the supplied inputs and task instructions. Save results under deliverables/.';
    const directory = add(root,{...fragment,instructions});
    const receipts=[];
    for (const input of fragment.inputs) {
      const dest=path.join(directory,'inputs',input.name);
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.writeFileSync(dest,input.bytes,{flag:'wx'});
      receipts.push({file:'inputs/'+input.name,bytes:input.bytes.length,sha256:crypto.createHash('sha256').update(input.bytes).digest('hex')});
    }
    fs.writeFileSync(path.join(directory,'fragment-receipt.json'),JSON.stringify({id:fragment.id,inputs:receipts},null,2)+'\n',{flag:'wx'});
    created.push({id:fragment.id,directory,inputs:receipts});
  }
  return {dryRun:false,created};
}

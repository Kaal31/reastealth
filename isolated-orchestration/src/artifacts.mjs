import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { transaction, listDependencyRequests, list, scopedPath } from './workspace.mjs';

const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const filename = name => {
 if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name) || name === '..') throw Error('Invalid file name');
 return name;
};
export function provisionTextResource(root, requestId, name, content) {
 filename(name);
 if (typeof content !== 'string' || Buffer.byteLength(content) > 1024*1024) throw Error('Resource exceeds 1 MiB or is invalid');
 const req = listDependencyRequests(root).find(r => r.id === requestId);
 if (!req || req.status !== 'approved') throw Error('Resource request not approved');
 const dest = scopedPath(root, req.taskId, 'resources/' + name);
 fs.mkdirSync(path.dirname(dest), { recursive: true });
 if (fs.existsSync(dest)) throw Error('Resource exists; do not overwrite worker files');
 fs.writeFileSync(dest, content, { flag: 'wx' });
 const digest = hash(content);
 return transaction(root, map => {
   const current = (map.dependencyRequests ?? []).find(r => r.id === requestId);
   if (!current || current.status !== 'approved') throw Error('Request no longer approved');
   current.status='provisioned'; current.response='resources/' + name;
   current.sha256=digest; current.updatedAt=new Date().toISOString();
   const task=map.tasks.find(t => t.id === current.taskId);
   if (task?.status === 'blocked' && !(map.dependencyRequests ?? []).some(r => r.taskId === task.id && r.required && r.status !== 'provisioned')) {
     task.status=task.previousStatus === 'assigned' && task.lease && Date.parse(task.lease.expiresAt) > Date.now() ? 'assigned' : 'pending';
     delete task.previousStatus;
     if (task.status !== 'assigned') delete task.lease;
   }
   return { path:'resources/'+name, sha256:digest, taskId:req.taskId };
 });
}
function filesUnder(dir, base=dir, output=[]) {
 if (!fs.existsSync(dir)) return output;
 for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
   const file=path.join(dir,e.name);
   if (e.isSymbolicLink()) throw Error('Symlink deliverable rejected');
   if (e.isDirectory()) filesUnder(file,base,output);
   else if (e.isFile()) {
     const bytes=fs.readFileSync(file);
     if(bytes.length>10*1024*1024) throw Error('Deliverable exceeds 10 MiB');
     output.push({ path:path.relative(base,file).replaceAll('\\','/'), bytes:bytes.length, sha256:hash(bytes) });
   } else throw Error('Unsupported filesystem entry');
   if(output.length>200) throw Error('Too many deliverables');
 }
 return output;
}
export function inspectDeliverables(root,id) {
 const task=list(root).find(x=>x.id===id);
 if (!task || !['submitted','accepted'].includes(task.status)) throw Error('Task not submitted');
 const dir=path.join(path.resolve(root),'workers',id,'deliverables');
 return { taskId:id, files:filesUnder(dir) };
}
export function importDeliverables(root,id) {
 const manifest=inspectDeliverables(root,id);
 const task=list(root).find(t=>t.id===id);
 if(task.status!=='accepted') throw Error('Master must accept task before import');
 const source=path.join(path.resolve(root),'workers',id,'deliverables');
 const dest=path.join(path.resolve(root),'integration',id);
 if(fs.existsSync(dest)) throw Error('Already imported');
 fs.mkdirSync(dest,{recursive:true});
 try {
   for(const f of manifest.files) {
     const from=path.join(source,f.path), to=path.join(dest,f.path);
     const bytes=fs.readFileSync(from);
     if(hash(bytes)!==f.sha256) throw Error('Deliverables changed during import');
     fs.mkdirSync(path.dirname(to),{recursive:true});
     fs.writeFileSync(to,bytes,{flag:'wx'});
   }
   fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 } catch(e){fs.rmSync(dest,{recursive:true,force:true});throw e;}
 return { directory:dest, manifest };
}

import fs from 'node:fs';
import path from 'node:path';
import { list, submit } from './workspace.mjs';
import { recoverExpired } from './coordination.mjs';

// Workers may write a READY_FOR_REVIEW.json marker as their final deliverable.
// The master only collects; acceptance and integration remain separate review steps.
export function collectCompleted(root) {
  recoverExpired(root);
  const collected=[], skipped=[];
  const tasks=list(root);
  for(const task of tasks) {
    if(task.status !== 'pending') continue;
    const folder=path.join(path.resolve(root),'workers',task.id,'deliverables');
    const marker=path.join(folder,'READY_FOR_REVIEW.json');
    try {
      if (!fs.existsSync(marker) || !fs.lstatSync(marker).isFile() || fs.lstatSync(marker).isSymbolicLink()) continue;
      const stat=fs.statSync(marker);
      if(stat.size>8192) throw Error('Marker exceeds 8 KiB');
      // Allow outstanding filesystem writes to settle.
      if(Date.now()-stat.mtimeMs<1000) continue;
      const done=JSON.parse(fs.readFileSync(marker,'utf8'));
      if(done.complete !== true || typeof done.summary !== 'string' || !done.summary.trim()) throw Error('Malformed completion marker');
      const contents=fs.readdirSync(folder).filter(name=>name!=='READY_FOR_REVIEW.json');
      if(!contents.length) throw Error('No deliverables supplied');
      submit(root,task.id,done.summary.slice(0,4000));
      collected.push({id:task.id,summary:done.summary.slice(0,4000)});
    } catch(e) {skipped.push({id:task.id,error:e.message});}
  }
  return {collected,skipped};
}
export function watchCompleted(root,onCollection=()=>{},interval=3000) {
 if(!Number.isInteger(interval)||interval<100||interval>60000) throw Error('Invalid scan interval');
 let busy=false;
 const scan=()=>{
   if(busy) return; busy=true;
   try {
     const result=collectCompleted(root);
     for(const item of result.collected) onCollection(item);
   } catch(error) { console.error('Completion watcher:',error.message); }
   finally { busy=false; }
 };
 scan();
 const timer=setInterval(scan,interval);
 return ()=>clearInterval(timer);
}

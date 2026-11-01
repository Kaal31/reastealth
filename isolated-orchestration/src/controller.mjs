import fs from 'node:fs';
import path from 'node:path';
import { transaction, list, ready, pendingEvents, listDependencyRequests } from './workspace.mjs';
import { collectCompleted } from './completion.mjs';

const modes = new Set(['running','paused','stopped']);
export function controllerState(root) {
  const file=path.join(path.resolve(root),'control','task-map.json');
  const map=JSON.parse(fs.readFileSync(file,'utf8'));
  return map.controller ?? { status:'stopped', updatedAt:null, lastPollAt:null, version:1 };
}
export function setControllerMode(root, mode) {
  if (!modes.has(mode)) throw Error('Unsupported controller mode');
  return transaction(root,map=>{
    map.controller ??= {version:1,status:'stopped',updatedAt:null,lastPollAt:null};
    map.controller.status=mode;
    map.controller.updatedAt=new Date().toISOString();
    return {...map.controller};
  });
}
export function controllerStatus(root) {
 const state=controllerState(root), tasks=list(root);
 return {controller:state,taskCounts:tasks.reduce((o,t)=>(o[t.status]=(o[t.status]??0)+1,o),{}),
   ready:ready(root).map(t=>t.id),
   pendingRequests:listDependencyRequests(root).filter(x=>['pending','needs_clarification'].includes(x.status)).length,
   pendingEvents:pendingEvents(root).length};
}
export function pollController(root) {
 const state=controllerState(root);
 if(state.status!=='running') return {status:state.status,collected:[],skipped:[]};
 const outcome=collectCompleted(root);
 const updated=transaction(root,map=>{
   if(map.controller?.status!=='running') return false;
   map.controller.lastPollAt=new Date().toISOString();
   return true;
 });
 return {...outcome,status:updated?'running':controllerState(root).status};
}
// This controller deliberately has no AI or worker-launch authority. Its
// scheduler remains master-approved until sandbox enforcement is verified.
export function runController(root,{interval=3000,onEvent=()=>{}}={}) {
 if(!Number.isInteger(interval)||interval<250||interval>60000)throw Error('Invalid interval');
 const tick=()=>{try{
   const result=pollController(root);
   for(const item of result.collected)onEvent({type:'task_submitted',...item});
 }catch(e){onEvent({type:'controller_error',message:e.message});}};
 tick();
 const timer=setInterval(tick,interval);
 return ()=>clearInterval(timer);
}

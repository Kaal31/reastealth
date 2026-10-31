import crypto from 'node:crypto';
import { transaction } from './workspace.mjs';
const ttlMin = 15_000, ttlMax = 3_600_000;
const validId = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(x);
const expiry = (now, ttl) => new Date(now + ttl).toISOString();
function assertTTL(ttl) { if (!Number.isInteger(ttl) || ttl < ttlMin || ttl > ttlMax) throw Error('Invalid lease duration'); }
function eligible(map, task) {
 const accepted = new Set(map.tasks.filter(t => t.status === 'accepted').map(t => t.id));
 return task.dependencies.every(id => accepted.has(id)) && !(map.dependencyRequests ?? []).some(r => r.taskId === task.id && r.required && r.status !== 'provisioned');
}
export function claimTask(root, id, owner, ttl = 120_000) {
 if (!validId(id) || !validId(owner)) throw Error('Invalid worker identity');
 assertTTL(ttl);
 return transaction(root, map => {
   const task = map.tasks.find(t => t.id === id);
   if (!task) throw Error('Unknown task');
   const now = Date.now();
   if (['assigned','blocked'].includes(task.status) && task.lease && Date.parse(task.lease.expiresAt) > now) {
     if (task.lease.owner !== owner) throw Error('Task already claimed');
     task.lease.expiresAt = expiry(now, ttl);
     return { id, owner, expiresAt: task.lease.expiresAt };
   }
   if (['assigned','blocked'].includes(task.status) && task.lease && Date.parse(task.lease.expiresAt) <= now) {
     if (task.status === 'blocked' && !eligible(map, task)) {
       delete task.lease;
       delete task.previousStatus;
       throw Error('Task blocked by unresolved dependency');
     }
     task.status = 'pending'; delete task.lease; delete task.previousStatus;
   }
   if (task.status !== 'pending' || !eligible(map, task)) throw Error('Task not available');
   task.status = 'assigned';
   task.lease = { owner, expiresAt: expiry(now, ttl), claimedAt: new Date(now).toISOString() };
   return { id, owner, expiresAt: task.lease.expiresAt };
 });
}
export function renewTask(root, id, owner, ttl = 120_000) {
 if (!validId(id) || !validId(owner)) throw Error('Invalid worker identity');
 assertTTL(ttl);
 return transaction(root, map => {
   const task = map.tasks.find(t => t.id === id);
   if (!task || !['assigned','blocked'].includes(task.status) || task.lease?.owner !== owner || Date.parse(task.lease.expiresAt) <= Date.now()) throw Error('No valid lease');
   task.lease.expiresAt = expiry(Date.now(), ttl);
   return { id, owner, expiresAt: task.lease.expiresAt };
 });
}
export function releaseTask(root, id, owner, force = false) {
 if (!validId(id) || !validId(owner)) throw Error('Invalid identity');
 return transaction(root, map => {
   const task = map.tasks.find(t => t.id === id);
   if (!task || !['assigned', 'blocked'].includes(task.status) || !task.lease || (!force && task.lease.owner !== owner)) throw Error('Cannot release task');
   const stillBlocked = (map.dependencyRequests ?? []).some(r => r.taskId === id && r.required && r.status !== 'provisioned');
   task.status = stillBlocked ? 'blocked' : 'pending'; delete task.lease; delete task.previousStatus;
   return { id, status: task.status };
 });
}
export function recoverExpired(root) {
 return transaction(root, map => {
   const now = Date.now();
   const expired = [];
   for (const task of map.tasks) {
     if (['assigned','blocked'].includes(task.status) && task.lease && Date.parse(task.lease.expiresAt) <= now) {
       const blocked = (map.dependencyRequests ?? []).some(r => r.taskId === task.id && r.required && r.status !== 'provisioned');
       task.status = blocked ? 'blocked' : 'pending'; delete task.lease; delete task.previousStatus; expired.push(task.id);
     }
   }
   return expired;
 });
}
export function makeWorkerIdentity() { return 'w-' + crypto.randomUUID(); }

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
   if (!task || !eligible(map, task)) throw Error('Task not eligible');
   const now = Date.now();
   if (task.status === 'assigned' && task.lease && Date.parse(task.lease.expiresAt) > now) {
     if (task.lease.owner !== owner) throw Error('Task already claimed');
     task.lease.expiresAt = expiry(now, ttl);
     return { id, owner, expiresAt: task.lease.expiresAt };
   }
   if (task.status === 'assigned' && task.lease && Date.parse(task.lease.expiresAt) <= now) {
     task.status = 'pending'; delete task.lease;
   }
   if (task.status !== 'pending') throw Error('Task not available');
   task.status = 'assigned';
   task.lease = { owner, expiresAt: expiry(now, ttl), claimedAt: new Date(now).toISOString() };
   return { id, owner, expiresAt: task.lease.expiresAt };
 });
}
export function renewTask(root, id, owner, ttl = 120_000) {
 return claimTask(root, id, owner, ttl);
}
export function releaseTask(root, id, owner, force = false) {
 if (!validId(id) || !validId(owner)) throw Error('Invalid identity');
 return transaction(root, map => {
   const task = map.tasks.find(t => t.id === id);
   if (!task || task.status !== 'assigned' || (!force && task.lease?.owner !== owner)) throw Error('Cannot release task');
   task.status = 'pending'; delete task.lease;
   return { id, status: 'pending' };
 });
}
export function recoverExpired(root) {
 return transaction(root, map => {
   const now = Date.now();
   const expired = [];
   for (const task of map.tasks) {
     if (task.status === 'assigned' && task.lease && Date.parse(task.lease.expiresAt) <= now) {
       task.status = 'pending'; delete task.lease; expired.push(task.id);
     }
   }
   return expired;
 });
}
export function makeWorkerIdentity() { return 'w-' + crypto.randomUUID(); }

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const sandboxCapabilities = Object.freeze({
  backend:'windows-restricted-process',
  enforced:false,
  reason:'Native restricted-token launcher, per-worker NTFS ACLs, authenticated broker, and Windows denial tests are not yet implemented'
});
export function inspectSandbox(root,taskId) {
 if(typeof taskId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(taskId))throw Error('Invalid task identifier');
 const folder=path.join(path.resolve(root),'workers',taskId);
 if(!fs.existsSync(path.join(folder,'TASK.md'))) throw Error('Worker task not found');
 return {taskId,platform:process.platform,hostMemoryBytes:os.totalmem(),workspace:folder,...sandboxCapabilities};
}
export function launchSandboxedWorker() {
 // Never allow a fallback to an unrestricted claude process when the
 // caller requested sandbox isolation. Phase 2 must implement this natively.
 throw Error('Sandbox enforcement unavailable. Refusing to launch an unprotected worker.');
}

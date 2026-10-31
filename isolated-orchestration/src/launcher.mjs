import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ready } from './workspace.mjs';

// A launcher only opens user-visible, interactive Claude Code terminals.
// It never passes model prompts, bypass flags, or credentials to Claude.
export function planWorkers(root, max = 4) {
  if (!Number.isInteger(max) || max < 1 || max > 16) throw Error('max must be 1..16');
  const project = path.resolve(root);
  return ready(project).slice(0, max).map(task => {
    const directory = path.join(project, 'workers', task.id);
    for (const required of ['TASK.md', '.mcp.json', 'CLAUDE.md']) {
      if (!fs.statSync(path.join(directory, required)).isFile()) throw Error('Missing worker configuration: ' + required);
    }
    // Reject symlinked task folders; stronger isolation requires OS accounts.
    if (fs.lstatSync(directory).isSymbolicLink()) throw Error('Symlinked worker folder denied');
    return { id: task.id, title: task.title, directory };
  });
}
const ps = value => "'" + value.replaceAll("'", "''") + "'";
export function startWorkers(plan, { platform = process.platform, run = spawnSync } = {}) {
  const results = [];
  for (const worker of plan) {
    let command, args;
    if (platform === 'win32') {
      // Start-Process creates an independent, visible terminal, with CWD assigned to one task.
      // Encode the PowerShell command to protect spaces and special characters in paths.
      const script = 'Start-Process -FilePath powershell.exe -WorkingDirectory ' +
        ps(worker.directory) + ' -ArgumentList @("-NoExit","-Command","claude")';
      command = 'powershell.exe';
      args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
    } else if (platform === 'linux') {
      command = 'x-terminal-emulator';
      args = ['--working-directory=' + worker.directory, '-e', 'claude'];
    } else {
      throw Error('Launcher currently supports Windows and Linux x-terminal-emulator only');
    }
    const result = run(command, args, { cwd: worker.directory, windowsHide: platform === 'win32', encoding: 'utf8', timeout: 15000 });
    if (result.error || result.status !== 0) {
      throw Error('Could not open worker ' + worker.id + ': ' + (result.error?.message ?? result.stderr ?? result.status));
    }
    results.push({ id: worker.id, directory: worker.directory, launched: true });
  }
  return results;
}

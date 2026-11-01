import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, add } from '../src/workspace.mjs';
import { createFragments } from '../src/fragmentation.mjs';

test('every new Goldfish receives complete rules and task-level scope reminders', () => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'rea-goldfish-'));
  const workspace=path.join(base,'ws'); init(workspace);
  const dir=add(workspace,{id:'direct',title:'Direct task',instructions:'Analyze the sample',acceptance:['Report findings']});
  const policy=fs.readFileSync(path.join(dir,'CLAUDE.md'),'utf8');
  const task=fs.readFileSync(path.join(dir,'TASK.md'),'utf8');
  for (const key of ['single-task','parent directories','network','subagents','deliverables/READY_FOR_REVIEW.json','Stop after completion','No original REA analysis MCP']) assert.ok(policy.includes(key),key);
  for (const key of ['## Workspace boundaries','## Assignment','## Acceptance criteria','## Completion','No network access','Report findings']) assert.ok(task.includes(key),key);
  assert.ok(policy.includes('\n## Completion\n'));
  assert.ok(task.includes('\n## Completion\n'));
  const servers=JSON.parse(fs.readFileSync(path.join(dir,'.mcp.json'),'utf8')).mcpServers;
  assert.deepEqual(Object.keys(servers),['rea-worker']);
});

test('fragmentation-created Goldfish gets the same policy and only scoped input',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'rea-goldfish-fragment-'));
 const workspace=path.join(base,'ws'),src=path.join(base,'src');
 init(workspace);fs.mkdirSync(src);fs.writeFileSync(path.join(src,'sample.js'),'export const answer=42;');
 const result=createFragments(workspace,src,{tasks:[{id:'fragment',title:'One file',instructions:'Analyze source',files:['sample.js']}]},{dryRun:false});
 const dir=result.created[0].directory;
 assert.match(fs.readFileSync(path.join(dir,'TASK.md'),'utf8'),/inputs\/sample.js/);
 assert.match(fs.readFileSync(path.join(dir,'CLAUDE.md'),'utf8'),/Stop after completion/);
 assert.ok(fs.existsSync(path.join(dir,'inputs','sample.js')));
});

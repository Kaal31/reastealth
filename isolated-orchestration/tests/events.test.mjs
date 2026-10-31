import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, add, pendingEvents, acknowledgeEvent, submit, review } from '../src/workspace.mjs';
const make = () => { const root=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rea-event-')),'project');init(root);add(root,{id:'task',title:'Task',instructions:'implement'});return root; };
test('event survives restart, acknowledgment is idempotent', () => {
 const root=make();
 submit(root,'task','implemented');
 const events=pendingEvents(root);
 assert.equal(events.length,1);
 assert.equal(events[0].type,'task_submitted');
 assert.equal(pendingEvents(root)[0].id,events[0].id);
 acknowledgeEvent(root,events[0].id);
 assert.deepEqual(pendingEvents(root),[]);
 assert.ok(acknowledgeEvent(root,events[0].id).acknowledgedAt);
 review(root,'task',true);
});

#!/usr/bin/env node
import fs from 'node:fs';
import { collectCompleted, watchCompleted } from './completion.mjs';
import { createFragments } from './fragmentation.mjs';
import { planWorkers, startWorkers } from './launcher.mjs';
import { claimTask, releaseTask, renewTask, recoverExpired } from './coordination.mjs';
import { provisionTextResource, inspectDeliverables, importDeliverables } from './artifacts.mjs';
import { init, add, list, ready, submit, review, workerRead, workerWrite, pendingEvents, acknowledgeEvent, listDependencyRequests, resolveDependencyRequest } from './workspace.mjs';

const [command, root, ...args] = process.argv.slice(2);
const out = value => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
try {
  if (!command || !root) throw new Error('Usage: node src/cli.mjs <init|add|list|ready|submit|review|worker-read|worker-write> <workspace> [...args]');
  switch (command) {
    case 'launch-ready': {
      const execute = args.includes('--execute');
      const limit = args.find(x => x.startsWith('--max='));
      const plan = planWorkers(root, limit ? Number(limit.slice(6)) : 4);
      out(execute ? startWorkers(plan, { autoStart: args.includes('--auto-start') }) : { dryRun: true, workers: plan, hint: 'Add --execute to launch interactive Claude Code terminals' });
      break;
    }
    case 'fragment': {
      if (!args[0] || !args[1]) throw Error('Usage: fragment <workspace> <source-dir> <manifest.json> [--execute]');
      out(createFragments(root, args[0], JSON.parse(fs.readFileSync(args[1], 'utf8')), {dryRun: !args.includes('--execute')}));
      break;
    }
    case 'collect-completed': out(collectCompleted(root)); break;
    case 'watch-completed':
      watchCompleted(root, event => out(event));
      break;
    case 'init': out(init(root)); break;
    case 'add': out(add(root, JSON.parse(fs.readFileSync(args[0], 'utf8')))); break;
    case 'list': out(list(root)); break;
    case 'ready': out(ready(root)); break;
    case 'submit': out(submit(root, args[0], args.slice(1).join(' '))); break;
    case 'review': out(review(root, args[0], args[1] === 'accept', args.slice(2).join(' '))); break;
    case 'events': out(pendingEvents(root)); break;
    case 'ack-event': out(acknowledgeEvent(root, args[0])); break;
    case 'requests': out(listDependencyRequests(root, args[0])); break;
    case 'resolve-request': out(resolveDependencyRequest(root, args[0], args[1], args.slice(2).join(' '))); break;
    case 'provision-text': out(provisionTextResource(root, args[0], args[1], fs.readFileSync(args[2], 'utf8'))); break;
    case 'inspect': out(inspectDeliverables(root, args[0])); break;
    case 'import': out(importDeliverables(root, args[0])); break;
    case 'claim': out(claimTask(root, args[0], args[1])); break;
    case 'renew': out(renewTask(root, args[0], args[1])); break;
    case 'release': out(releaseTask(root, args[0], args[1])); break;
    case 'recover': out(recoverExpired(root)); break;
    case 'worker-read': out(workerRead(root, args[0], args[1])); break;
    case 'worker-write': out(workerWrite(root, args[0], args[1], args.slice(2).join(' '))); break;
    default: throw new Error('Unknown command');
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }

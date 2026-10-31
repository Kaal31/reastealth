#!/usr/bin/env node
import fs from 'node:fs';
import { init, add, list, ready, submit, review, workerRead, workerWrite } from './workspace.mjs';

const [command, root, ...args] = process.argv.slice(2);
const out = value => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
try {
  if (!command || !root) throw new Error('Usage: node src/cli.mjs <init|add|list|ready|submit|review|worker-read|worker-write> <workspace> [...args]');
  switch (command) {
    case 'init': out(init(root)); break;
    case 'add': out(add(root, JSON.parse(fs.readFileSync(args[0], 'utf8')))); break;
    case 'list': out(list(root)); break;
    case 'ready': out(ready(root)); break;
    case 'submit': out(submit(root, args[0], args.slice(1).join(' '))); break;
    case 'review': out(review(root, args[0], args[1] === 'accept', args.slice(2).join(' '))); break;
    case 'worker-read': out(workerRead(root, args[0], args[1])); break;
    case 'worker-write': out(workerWrite(root, args[0], args[1], args.slice(2).join(' '))); break;
    default: throw new Error('Unknown command');
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }

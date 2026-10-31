#!/usr/bin/env node
// Local event watcher: emits one JSON line for each newly submitted task.
// Does not launch or wake any desktop AI application.
import fs from 'node:fs';
import path from 'node:path';

export function watchSubmissions(root, onSubmission) {
  const folder = path.join(path.resolve(root), 'results');
  fs.mkdirSync(folder, { recursive: true });
  const seen = new Map();
  const scan = () => {
    for (const name of fs.readdirSync(folder).filter(n => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.json$/.test(n))) {
      const full = path.join(folder, name);
      try {
        if (!fs.statSync(full).isFile()) continue;
        const value = JSON.parse(fs.readFileSync(full, 'utf8'));
        const key = name + ':' + value.submittedAt;
        if (!value.id || !value.submittedAt || seen.get(name) === key) continue;
        seen.set(name, key);
        onSubmission({ taskId: value.id, summary: value.summary, submittedAt: value.submittedAt });
      } catch { /* Ignore incomplete or transient writes; next scan retries. */ }
    }
  };
  scan(); // restart recovery for already-submitted work
  const watcher = fs.watch(folder, () => scan());
  const fallback = setInterval(scan, 3000);
  fallback.unref();
  return () => { watcher.close(); clearInterval(fallback); };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const root = process.argv[2];
  if (!root) { console.error('Usage: node src/watch.mjs <workspace>'); process.exit(2); }
  watchSubmissions(root, event => process.stdout.write(JSON.stringify(event) + '\n'));
}

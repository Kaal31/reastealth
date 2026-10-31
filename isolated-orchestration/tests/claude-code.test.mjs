import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, add } from '../src/workspace.mjs';

test('Claude Code workers have isolated project MCP and local instructions', () => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rea-claude-')), 'project');
  init(root);
  const first = add(root, { id: 'alpha', title: 'Alpha', instructions: 'Only alpha' });
  const second = add(root, { id: 'beta', title: 'Beta', instructions: 'Only beta' });
  const a = JSON.parse(fs.readFileSync(path.join(first, '.mcp.json'), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(second, '.mcp.json'), 'utf8'));
  assert.equal(a.mcpServers['rea-worker'].args.at(-1), 'alpha');
  assert.equal(b.mcpServers['rea-worker'].args.at(-1), 'beta');
  assert.equal(a.mcpServers['rea-worker'].args.at(-3), root);
  assert.equal(Object.keys(a.mcpServers).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(first, '.claude/settings.json'), 'utf8')).autoMemoryEnabled, false);
  assert.match(fs.readFileSync(path.join(first, 'CLAUDE.md'), 'utf8'), /TASK.md/);
  assert.doesNotMatch(fs.readFileSync(path.join(first, 'CLAUDE.md'), 'utf8'), /Only beta/);
  assert.doesNotMatch(fs.readFileSync(path.join(first, 'TASK.md'), 'utf8'), /Only beta/);
});

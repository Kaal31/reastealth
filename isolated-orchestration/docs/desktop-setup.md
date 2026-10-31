# Local desktop MCP profiles

Two desktop applications use the **same** MCP entry point with different startup configurations. Each instance uses stdio and has no model API credentials.

## Master (orchestrator)

Configure an MCP stdio command with the installed Node.js executable and arguments:

```json
{
  "command": "node",
  "args": [
    "C:/path/to/reastealth/isolated-orchestration/src/mcp.mjs",
    "--role", "master",
    "--workspace", "C:/REA-workspace/project"
  ]
}
```

## Worker

Configure the second app with the same script, but fixed task identity:

```json
{
  "command": "node",
  "args": [
    "C:/path/to/reastealth/isolated-orchestration/src/mcp.mjs",
    "--role", "worker",
    "--workspace", "C:/REA-workspace/project",
    "--task", "parser"
  ]
}
```

Create the master workspace first (`node src/cli.mjs init C:/REA-workspace/project`), then create a task using the master tools or CLI, then launch the worker.

### Isolation model

The worker MCP advertises only `get_task`, `submit_result`, and `report_blocker`. It does not accept a workspace or task ID in tool calls, and it never returns global state. Master tools are not accessible through the worker profile.

**This is context and MCP access isolation only.** On Windows, any other shell/file tools in the worker desktop app continue to run with that app's OS privileges. NTFS isolation is intentionally deferred until the larger orchestration workflow is mature.

A locally configured worker can see its own `TASK.md`, source tree, and `deliverables/` by opening only its dedicated project directory. No direct transfer of the master plan is necessary.

### Current limitations

- ChatGPT Desktop support for attaching a local stdio MCP server depends on the specific app environment; check that support before registering.
- Launching or waking up desktop AI apps automatically is not yet implemented.
- Filesystem completion watcher, event journaling, and concurrent multi-process task updates are future work.
- The worker's role is fixed at process launch, not within a tool call. Local users who can edit MCP launcher settings can change the role; OS-enforced identities and access controls come later.

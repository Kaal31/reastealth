# REA Stealth — Isolated Orchestration (initial implementation)

This optional subproject runs beside the existing REA CLI and MCP code. It does not change the existing REA binary-analysis tools. It uses local filesystem task handoff and does **not** call paid model APIs.

## Workflow

- Orchestrator creates a master plan and task DAG in `control/`.
- Each worker task gets its own `workers/<task-id>/` project, with only task instructions and selected contracts.
- Workers provide output in their own `deliverables/`; the bridge writes completion evidence to `results/`.
- Orchestrator reviews submissions and can unlock dependent tasks.

## CLI

From this subproject directory, with an installed compatible Node.js:

```sh
node src/cli.mjs init ./demo
node src/cli.mjs add ./demo ./example-task.json
node src/cli.mjs ready ./demo
node src/cli.mjs worker-write ./demo parser deliverables/result.txt hello
node src/cli.mjs submit ./demo parser "Implemented"
node src/cli.mjs review ./demo parser accept "Tests passed"
npm test
```

Example task JSON:

```json
{"id":"parser","title":"Parser","instructions":"Build a parser for the provided test fixtures.","acceptance":["Pass parser tests"],"dependencies":[]}
```

## Isolation limitations

The bridge validates relative paths and prevents ordinary cross-task reads *through its own read/write functions*. This is **not an OS security boundary**. A desktop worker with direct filesystem or shell access can still browse folders permitted to its operating-system account. For actual isolation run workers under separately restricted Windows accounts, containers, or virtual machines and expose only assigned worker directories. Do not give worker apps a separate unrestricted file or shell tool. A single shared Windows user account is insufficient.

## Planned REA integration

1. Add orchestrator-only MCP tools for creating task maps, reviewing outputs, and dependency resolution.
2. Expose a separate worker MCP server restricted to one task ID, without orchestrator methods.
3. Set up per-application desktop MCP configurations and local filesystem handoffs.
4. Add sandbox provisioning and access-control tests on Windows.
5. Add an opt-in desktop UI adapter only when native MCP task triggering is unavailable.

No desktop application is automatically driven in this initial version. All project purposes remain visible to the orchestrator and are subject to normal safety checks.

# REA Stealth — Isolated Orchestration

Local-first, provider-independent task orchestration. Built as an optional module on top of the REA Stealth repository, without changing its existing reverse-engineering tools.

## Architecture

- One MCP server implementation, with `--role master` or `--role worker --task ID` startup profiles.
- Master: creates and reviews individual task projects, reads the task graph, checks readiness.
- Worker: receives only its assigned instructions and can submit a result or report a blocker.
- Local filesystem stores plans, worker project files, and result manifests; no paid model API is needed.
- Worker roles have separate advertised MCP tools; master methods are not callable through worker connections.

See [desktop setup](docs/desktop-setup.md) for stdio configuration examples.

## CLI workflow

From this directory:

```sh
node src/cli.mjs init ./demo
node src/cli.mjs add ./demo ./example-task.json
node src/cli.mjs ready ./demo
node src/cli.mjs submit ./demo parser "Implemented"
node src/cli.mjs review ./demo parser accept "Tests passed"
npm test
```

Task specification example:

```json
{"id":"parser","title":"Parser","instructions":"Build a parser for the provided fixtures.","acceptance":["Pass parser tests"],"dependencies":[]}
```

MCP launch examples:

```sh
node src/mcp.mjs --role master --workspace C:/REA-workspace/project
node src/mcp.mjs --role worker --workspace C:/REA-workspace/project --task parser
```

## Status and caveats

This is an **initial optional module**, not yet wired into the main `rea` CLI's existing command router or REA MCP catalog. It exposes a standalone MCP stdio endpoint in the same repository.

Role isolation is only enforced in this module's MCP interface and bridge-mediated file functions. It **does not prevent unrestricted file/shell tools in a desktop application from reading accessible Windows folders**. NTFS-enforced identity separation is deferred as requested. A local user capable of editing MCP launcher configuration can start the master profile.

There is no automatic desktop session wake-up, UI automation, filesystem watcher, or cross-process transaction locking yet. Desktop compatibility must be verified for each actual client before activation.

Existing reverse-engineering tools and upstream build behavior remain untouched.

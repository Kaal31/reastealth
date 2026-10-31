# Isolated orchestration implementation status

## Newly implemented in branch

1. **Worker coordination:** `coordination.mjs` provides atomic exclusive task claim, renewal, release, and expiry reconciliation. MCP worker sessions get private process identities; `get_task` claims a lease. Dead-owner registry locks are conservatively reclaimed.
2. **Desktop handoff:** `workspace.mjs` records durable submission events; master tools `pending_events` and `acknowledge_event` support restart-safe review.
3. **Dependency provisioning:** `artifacts.mjs` stages explicitly approved UTF-8 text resources into the requesting worker's `resources/`, with SHA-256. Package installation/network fetching remains intentionally manual.
4. **Integration staging:** `inspect_deliverables` inventories submitted files and their hashes; `import_deliverables` copies accepted work into separate staging folders, refusing symlinks and duplicates.
5. **Local setup:** New workspaces generate `control/master-mcp.json`, and each Claude Code task gets `.mcp.json`, `CLAUDE.md`, and local settings. Standalone REA Stealth orchestration entry points work independently of compiled REA CLI.

## Still incomplete / not verified

- All newly committed code needs **real Node runtime tests on Windows and Linux**. Source syntax checks passed; a green GitHub Actions run has not been verified.
- No automatic ChatGPT UI wake-up, and no worker GUI automation. Orchestrator must call `pending_events` in an active session.
- Task claiming is bound to a process session, but worker-slot registry and automated assignment selection remain future work. Each worker currently points to a specific task through its project-scoped MCP config.
- Provisioning supports explicit text files only, not automatic npm/pip installation or fetched binaries.
- Integration stages files, but does **not** execute untrusted worker tests or merge automatically into the master codebase.
- Main REA `setup` routing has not been modified. A proposed root CLI registration attempt was not accepted, so the standalone script remains the supported entry.
- Windows NTFS isolation, separate identities, and process network isolation are **not enforced**. The earlier decision to postpone mandatory NTFS enforcement remains in effect.

## QA

CI workflow: `.github/workflows/isolated-orchestration-tests.yml`.
Tests cover dependency graph, MCP role boundary, worker handoff, file watcher, concurrency, dependency requests, worker configuration, leases, resource staging, and durable events. These are tests *committed*, not results *verified*.

To run locally:

```powershell
cd C:\REA\reastealth\isolated-orchestration
npm test
```

To launch a scoped worker after creating its task:

```powershell
cd C:\REA\test-project\workers\parser
claude
```

The local MCP connection can be checked with Claude Code's `/mcp` command.

# Implementation roadmap and current state

## Implemented on isolated-orchestration
- File-based task map, dependency DAG, independent worker directories.
- One role-aware local stdio MCP entry point (master and task-bound worker modes).
- Worker dependency requests, master review, explicit provisioning state.
- Concurrent-registry directory lock and CI stress test (not yet proven crash-safe).
- Result submission watcher (not yet wired to desktop wake-up).
- Per-task Claude Code project generation: `.mcp.json`, `.claude/settings.json`, `CLAUDE.md`.

## Must finish before calling this complete
1. **Verified CI:** Execute Windows/Linux runtime tests, fix failures; add malformed request and interruption tests.
2. **Reliable registry:** Crash-safe lock recovery or transactional store; simultaneous claim and submission integrity; idempotent state transitions.
3. **Worker assignment orchestration:** Atomically claim, lease, renew, release tasks for multiple Claude Code sessions, with guaranteed distinct assignments.
4. **Desktop handoff:** Coordinator detects submitted work, queues durable events, and provides master-side review without assuming ChatGPT can wake itself.
5. **MCP lifecycle:** Register role-aware MCP through REA Stealth setup, preserve upstream tool behavior, validate supported ChatGPT host and Claude Code launch paths.
6. **Dependency provisioning:** Approval is not installation; stage approved resources into the assigned worker folder after validation; record hashes and provenance.
7. **Integration:** Validate output files against contracts, run tests, accept/reject patch; don't automatically merge unrelated files.
8. **Isolation enforcement:** Independent Windows accounts and NTFS ACLs; tool-process network controls; validate against symlink/junction escape, inherited global settings, and other filesystem tools.
9. **Cleanup/recovery:** Restore workflow state after worker crashes, remove expired workspaces safely, reconcile duplicate notifications.

## Claude Code scope caveats
Project-scoped MCP and `.claude/settings.json` reduce accidental context mixing, but global/user MCP registrations and parent/user instructions may still be present. Separate terminal sessions alone do not create an operating-system security boundary. Use a fresh process per assignment and avoid placing task directories under the master source repository.

Only mark tests as passing after executing them against the committed branch.

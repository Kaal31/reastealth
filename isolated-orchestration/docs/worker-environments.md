# Local worker environment policies (design)

The role-aware MCP can provision and manage local worker execution policies, but the MCP protocol itself does not constrain desktop software's other capabilities. This phase **does not enforce network isolation** yet.

Proposed per-task policy in master-only configuration:

```json
{
  "environment": {
    "network": "offline-tools",
    "filesystem": "task-only",
    "workingDirectory": "workers/task-001",
    "allowedExecutables": [],
    "maximumRuntimeSeconds": 1200
  }
}
```

## Policy modes

- `normal`: current unrestricted workstation execution.
- `offline-tools`: worker desktop model remains online; worker-launched code should run in a separately constrained execution environment without internet. **Cannot be guaranteed by simply creating a firewall rule for the desktop app**.
- `isolated`: future Windows restricted user / sandbox and NTFS ACL enforcement, with only approved project folder mapped.

## Windows design constraints

Windows Defender Firewall can create outbound block rules for a specific executable with `New-NetFirewallRule -Direction Outbound -Program ... -Action Block`, but these are executable-scoped, not a containment boundary for arbitrary child processes. Blocking all of Node.js globally may also block REA Stealth. Use a dedicated worker process identity or sandbox rather than blanket global firewall rules.

Windows Sandbox supports networking disabled with a `.wsb` config; however, cloud-based desktop AI inside a network-disabled sandbox cannot contact its model provider. A better eventual architecture keeps the desktop model host outside the sandbox, while it dispatches terminal/build/test operations into an isolated execution environment.

The orchestrator should be the only component allowed to change or approve the environment profile. The worker receives a pre-provisioned workspace and minimal MCP tool profile, and must not be able to elevate its own policy.

The first iteration should support **advisory** environment profiles in the master task specification and diagnostics. Do not call a non-enforced policy a sandbox. Opt-in enforced policies and NTFS permissions are postponed until the core orchestration is stable.

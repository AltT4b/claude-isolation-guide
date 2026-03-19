# Scenario 08 — Docker AI Sandboxes

Run Claude Code inside a Docker AI Sandbox — a microVM managed by Docker Desktop that provides filesystem, network, and process isolation without any manual container configuration.

## Why It Matters

Docker AI Sandboxes (`docker sandbox run claude`) give you full environment isolation with zero Dockerfile authoring. The sandbox runs inside a lightweight microVM with its own kernel, filesystem, and network stack. Claude operates in a disposable environment that cannot affect your host — even if it runs destructive commands.

This is different from the native sandbox (Seatbelt/bubblewrap) which restricts individual Bash commands. Docker AI Sandboxes isolate the entire Claude session.

## How It Works

### The microVM model

When you run `docker sandbox run claude`, Docker Desktop:

1. Spins up a lightweight microVM (not a regular container).
2. Syncs your project directory into the VM's filesystem.
3. Starts Claude Code inside the VM with full access to the synced workspace.
4. Syncs file changes back to the host when the session ends (or on demand).

The microVM has its own:
- **Filesystem** — isolated from the host. Claude can't read `~/.ssh`, `/etc/passwd`, or anything outside the synced workspace.
- **Network stack** — separate from the host. Outbound access is controlled by Docker Desktop's network policies.
- **Process tree** — Claude and its child processes run inside the VM. No host process visibility.
- **Docker daemon** — a private Docker-in-Docker instance, so Claude can build and run containers without accessing the host's Docker.

### Workspace sync

Your project directory is synced into the sandbox, not bind-mounted. This means:
- Changes Claude makes are visible in the sandbox immediately.
- Changes sync back to the host at session end.
- Files outside the project directory are not accessible.

## Running a Docker AI Sandbox

```bash
docker sandbox run claude
```

That's it. Docker Desktop handles the microVM, workspace sync, and cleanup.

### Common options

```bash
# Run in a specific project directory
docker sandbox run claude --project /path/to/project

# List running sandboxes
docker sandbox ls

# Stop a running sandbox
docker sandbox stop <sandbox-id>
```

### What you don't need

- No `Dockerfile`.
- No `docker-compose.yml`.
- No `.claude/settings.json` sandbox config — isolation comes from the VM boundary, not from settings.json rules.
- No `--cap-drop`, `--read-only`, `--security-opt` flags — the microVM provides stronger isolation than any container flag combination.

## Native Sandbox vs. Docker AI Sandbox

| | Native Sandbox (srt/Seatbelt/bubblewrap) | Docker AI Sandbox (microVM) |
|---|---|---|
| **Isolation level** | Per-command syscall filtering | Full VM — separate kernel, filesystem, network |
| **What it restricts** | Individual Bash commands | The entire Claude session |
| **Filesystem** | Granular read/write rules in settings.json | VM boundary — only synced workspace is visible |
| **Network** | Domain allowlist in settings.json | VM network stack — controlled by Docker Desktop |
| **Docker access** | Requires `excludedCommands` carve-out | Private Docker daemon inside the VM |
| **Config required** | `.claude/settings.json` with sandbox rules | None — `docker sandbox run claude` |
| **Platform** | macOS (Seatbelt), Linux (bubblewrap) | macOS, Windows (microVM), Linux (legacy container mode) |
| **Escape risk** | Misconfigured rules, `excludedCommands` holes | VM escape (extremely rare) |
| **Best for** | Fine-grained control over specific commands | Full environment isolation with minimal config |

## Platform Requirements

| Platform | Isolation model | Notes |
|---|---|---|
| macOS | microVM | Requires Docker Desktop 4.40+ |
| Windows | microVM | Requires Docker Desktop 4.40+ with WSL2 backend |
| Linux | Legacy container mode | Uses container isolation instead of microVM. Less isolation than microVM but still stronger than native sandbox alone. |

## Config

This scenario does not use a `.claude/settings.json` sandbox config. The isolation comes from Docker's microVM boundary, not from Claude's sandbox settings. The included settings.json is minimal:

```json
{}
```

You can still layer Claude's native sandbox inside a Docker AI Sandbox for defense in depth, but it's not required — the VM boundary is the primary isolation mechanism.

## Run It

```bash
npm install && npm test
```

## What the Tests Check

| Test | What | Expected | Why |
|---|---|---|---|
| Docker available | `docker --version` | Docker is installed | Docker AI Sandboxes require Docker Desktop |
| Docker sandbox CLI | `docker sandbox --help` | Command exists | Confirms Docker Desktop version supports AI Sandboxes |

Note: The verify script checks that the prerequisites for Docker AI Sandboxes are present. It cannot run an actual sandbox session — that requires Docker Desktop with the sandbox feature enabled and an interactive terminal.

## Gotchas

- **Not visible in `docker ps`.** Docker AI Sandboxes are microVMs, not containers. Use `docker sandbox ls` to list them.
- **Requires Docker Desktop.** The `docker sandbox` command is a Docker Desktop feature, not available in Docker Engine alone.
- **Linux uses legacy container mode.** On Linux, Docker AI Sandboxes fall back to container-based isolation instead of microVMs. Still useful, but the isolation boundary is weaker.
- **Workspace sync is not instant.** Large file changes may take a moment to sync between host and sandbox.
- **Private Docker daemon.** The Docker daemon inside the sandbox is separate from the host's. Images and containers don't carry over.
- **Network access.** By default, the sandbox has outbound network access (for `npm install`, API calls, etc.). Docker Desktop controls network policies — check Docker Desktop settings for restrictions.

## Next Steps

- **[Scenario 09 — Hardened Container](../09-hardened-container/):** Manual Docker hardening for when you need full control over the container security posture.
- **[Scenario 11 — Excluded Commands](../11-excluded-commands/):** An alternative approach — keep the native sandbox but carve out specific commands (like `docker`) using `excludedCommands`.

# Scenario 06 — Devcontainer Reference

A `.devcontainer/devcontainer.json` + Dockerfile that defines an isolated development environment for Claude Code. The container provides its own filesystem, network namespace, and process tree — isolation beyond what the native sandbox offers on its own.

## Why It Matters

The native sandbox restricts individual Bash commands (per-command OS-level restrictions via Seatbelt/bubblewrap). A container restricts the entire environment. Even if the sandbox has a gap, the container limits the blast radius.

They are complementary — you can run the sandbox inside a container for defense in depth.

## Container vs Sandbox

| | Sandbox (srt) | Container (devcontainer) |
|---|---|---|
| **Scope** | Per-command | Per-environment |
| **Mechanism** | Seatbelt (macOS) / bubblewrap (Linux) | Linux namespaces + cgroups |
| **Filesystem** | Allowlist/denylist per command | Read-only root, mount restrictions |
| **Network** | Domain allowlist per command | Full network namespace, iptables |
| **Process** | Inherits host process tree | Isolated PID namespace |
| **Resource limits** | None | cgroups (CPU, memory, I/O) |
| **Best for** | Fine-grained command control | Blast-radius containment |

**Use both.** The container limits what the environment can touch; the sandbox limits what individual commands can do within it. Belt and suspenders.

## Quick Start

```bash
# Open in VS Code with Dev Containers extension
code .
# -> "Reopen in Container" when prompted

# Or from the CLI
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . npm test
```

## Setup

### 1. devcontainer.json

The core configuration. Key security settings:

| Setting | Purpose |
|---|---|
| `--cap-drop=ALL` | Remove all Linux capabilities |
| `--security-opt=no-new-privileges` | Prevent privilege escalation |
| `--read-only` | Root filesystem is read-only |
| `--tmpfs=/tmp:rw,noexec,nosuid` | Writable /tmp without exec permission |
| `--tmpfs=/home/node:rw,nosuid` | Writable home dir for npm cache etc. |
| `remoteUser: node` | Run as non-root user |

### 2. Dockerfile

Builds on `node:20-slim`. Installs `curl` and `iptables`, copies project files, drops to the `node` user.

### 3. init-firewall.sh (optional)

iptables rules that restrict outbound traffic to DNS and `api.anthropic.com` only. Must be run as root before dropping privileges — requires `NET_ADMIN` capability during init.

```bash
# Run manually during container setup (requires root)
sudo bash .devcontainer/init-firewall.sh
```

## Verify It Works

```bash
npm test
```

| Test | What it checks | Inside container | Outside container |
|---|---|---|---|
| Container detection | `/.dockerenv` or cgroup indicators | PASS | SKIP |
| Non-root user | `whoami` is not root | PASS | SKIP |
| Dropped capabilities | `/proc/1/status` CapEff is minimal | PASS | SKIP |
| Read-only filesystem | Write to `/opt` fails | PASS | SKIP |
| Network restrictions | `curl https://example.com` fails | PASS (if firewall active) | SKIP |

Running outside a container is fine — tests SKIP gracefully instead of failing.

## Gotchas

- **Docker-in-Docker is tricky.** If Claude Code needs Docker inside the devcontainer, you need DinD or socket mounting — both have security implications.
- **Read-only root filesystem breaks some tools.** Use `--tmpfs` mounts for `/tmp`, `/var/run`, etc. as needed.
- **`--cap-drop=ALL` is aggressive.** You may need to add back specific capabilities depending on your workflow (e.g., `NET_RAW` for ping).
- **iptables requires `NET_ADMIN` capability** to set up. Run firewall init before dropping caps, or use a separate init container.
- **Devcontainer features may pull in more than you expect.** Audit each feature for what it installs and what permissions it needs.
- **Sandbox inside container is still valuable.** The container limits the environment; the sandbox limits individual commands within it. Belt and suspenders.

## Next Steps

- **[Scenario 07 — Standalone Docker](../07-standalone-docker/)** — Run Claude Code in a plain Docker container
- **[Scenario 09 — Hardened Container](../09-hardened-container/)** — Docker Compose with full security hardening

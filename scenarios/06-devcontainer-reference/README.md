# Scenario 06 — Devcontainer Reference

A devcontainer that wraps Claude Code in an isolated environment: dropped capabilities, read-only root fs, non-root user, optional network firewall. Sandbox still runs inside for belt-and-suspenders.

## Prerequisites

You need **Docker** running locally, plus at least one of:

### Option A — VS Code + Dev Containers extension

1. Install [VS Code](https://code.visualstudio.com/).
2. Install the **Dev Containers** extension (`ms-vscode-remote.remote-containers`) from the Extensions marketplace.
3. (Optional) Enable the `code` shell command: open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) → **Shell Command: Install 'code' command in PATH**.

### Option B — Devcontainer CLI (no VS Code required)

The `@devcontainers/cli` package is included as a devDependency. Install it along with everything else:

```bash
npm install
```

Then use `npx devcontainer` to run it.

## Verify

```bash
# VS Code — open this scenario folder, then:
code .  # → "Reopen in Container" when prompted (or use Command Palette → "Dev Containers: Reopen in Container")

# CLI — no VS Code needed:
npm install
npx devcontainer up --workspace-folder .
npx devcontainer exec --workspace-folder . npm test
```

## What You Get

| Security control | How |
|---|---|
| No Linux capabilities | `--cap-drop=ALL` |
| No privilege escalation | `--security-opt=no-new-privileges` |
| Read-only root filesystem | `--read-only` |
| Writable /tmp, no exec | `--tmpfs=/tmp:rw,noexec,nosuid` |
| Non-root user | `remoteUser: node` |
| Network filtering (optional) | `init-firewall.sh` — iptables allowlist |

Tests SKIP gracefully when run outside a container.

---

## Deep Dive

### Container vs Sandbox

| | Sandbox (srt) | Container (devcontainer) |
|---|---|---|
| **Scope** | Per-command | Per-environment |
| **Mechanism** | Seatbelt (macOS) / bubblewrap (Linux) | Linux namespaces + cgroups |
| **Filesystem** | Allowlist/denylist per command | Read-only root, mount restrictions |
| **Network** | Domain allowlist per command | Full network namespace, iptables |
| **Resource limits** | None | cgroups (CPU, memory, I/O) |

**Use both.** The container limits what the environment can touch; the sandbox limits what individual commands can do within it.

### Setup details

**Dockerfile:** Builds on `node:20-slim`. Installs `curl` and `iptables`, copies project files, drops to `node` user.

**init-firewall.sh (optional):** iptables rules restricting outbound to DNS + `api.anthropic.com`. Requires root — run before dropping privileges:

```bash
sudo bash .devcontainer/init-firewall.sh
```

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

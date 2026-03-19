# Scenario 06 — Devcontainer Reference

Use both. The container limits what the environment can touch; the sandbox limits what individual commands can do within it.

A devcontainer that wraps Claude Code in an isolated environment: dropped capabilities, read-only root fs, non-root user. The native sandbox still runs inside for defense in depth.

## Prerequisites

You need **Docker** running locally, plus at least one of:

**Option A — VS Code + Dev Containers extension**

1. Install [VS Code](https://code.visualstudio.com/).
2. Install the **Dev Containers** extension (`ms-vscode-remote.remote-containers`) from the Extensions marketplace.
3. (Optional) Enable the `code` shell command: open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) → **Shell Command: Install 'code' command in PATH**.

**Option B — Devcontainer CLI (no VS Code required)**

The `@devcontainers/cli` package is included as a devDependency. Install it along with everything else:

```bash
npm install
```

Then use `npx devcontainer` to run it.

## Verify

```bash
npm install

# VS Code — open this scenario folder, then:
code .  # → "Reopen in Container" when prompted (or use Command Palette → "Dev Containers: Reopen in Container")

# CLI — no VS Code needed:
npx devcontainer up --workspace-folder .
npx devcontainer exec --workspace-folder . npm test
```

### Key `devcontainer.json` security flags

The entire security posture lives in `runArgs`:

```jsonc
"runArgs": [
  "--cap-drop=ALL",                    // drop all Linux capabilities
  "--security-opt=no-new-privileges",  // block setuid escalation
  "--read-only",                       // immutable root filesystem
  "--tmpfs=/tmp:rw,noexec,nosuid",     // writable scratch, no exec
  "--tmpfs=/home/node:rw,nosuid"       // writable home for node user
]
```

### Key Dockerfile lines

```dockerfile
FROM node:20-slim                          # minimal base image

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \                                 # needed for API calls
    && rm -rf /var/lib/apt/lists/*

USER node                                  # drop to non-root user
```

### Sample output

Tests SKIP gracefully when run outside a container:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Test 1 — Container Detection
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  WARN — Not running inside a container.
  SKIP — Not in a container.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Passed:  0 / 4
  Skipped: 4 / 4
  All checks passed (or skipped). Container isolation looks good.
```

## What You'll See

| Security control | How |
|---|---|
| No Linux capabilities | `--cap-drop=ALL` |
| No privilege escalation | `--security-opt=no-new-privileges` |
| Read-only root filesystem | `--read-only` |
| Writable /tmp, no exec | `--tmpfs=/tmp:rw,noexec,nosuid` |
| Non-root user | `remoteUser: node` |

---

## Deep Dive

### Container vs Sandbox

| | Sandbox (srt) | Container (devcontainer) |
|---|---|---|
| **Scope** | Per-command | Per-environment |
| **Mechanism** | Seatbelt (macOS) / bubblewrap (Linux) | Linux namespaces + cgroups |
| **Filesystem** | Allowlist/denylist per command | Read-only root, mount restrictions |
| **Network** | Domain allowlist per command | Full network namespace |
| **Resource limits** | None | cgroups (CPU, memory, I/O) |

srt (sandbox runtime — the CLI that enforces sandbox rules outside a live Claude session) handles per-command isolation. The container handles per-environment isolation.

### Setup details

**Dockerfile:** Builds on `node:20-slim`. Installs `curl`, copies project files, drops to `node` user.

## Break It on Purpose

Each experiment is a single edit to `devcontainer.json`. Make the change, rebuild the container (`npx devcontainer up --workspace-folder .`), run `npm test`, observe which test flips, then **undo the edit** before moving on.

### Experiment A — Remove capability restrictions

```diff
  "runArgs": [
-   "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
```

Rebuild and run `npm test`. **Test 3 flips to FAIL** — the container now has default Linux capabilities (including `NET_RAW`, `CHOWN`, `DAC_OVERRIDE`, etc.). `CapEff` is no longer all zeros.

**Takeaway:** `--cap-drop=ALL` is the single most impactful container hardening flag. Without it, a process can bind raw sockets, change file ownership, and override permission checks.

### Experiment B — Remove read-only root filesystem

```diff
  "runArgs": [
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
-   "--read-only",
    "--tmpfs=/tmp:rw,noexec,nosuid",
```

Rebuild and run `npm test`. **Test 4 flips to FAIL** — writes to `/usr/local/` now succeed. An attacker could replace system binaries.

**Takeaway:** `--read-only` prevents persistent tampering. Without it, anything the container can write to becomes a backdoor opportunity.

### Experiment C — Make tmpfs executable

```diff
-   "--tmpfs=/tmp:rw,noexec,nosuid",
+   "--tmpfs=/tmp:rw,nosuid",
```

Rebuild and run `npm test`. **Test 5 flips to FAIL** — scripts can now be executed from `/tmp`. The classic "download to /tmp, chmod +x, execute" attack works again.

**Takeaway:** `noexec` on tmpfs blocks the most common post-exploitation pattern. Without it, any writable directory becomes a launchpad.

## Gotchas

- **Docker-in-Docker is tricky.** If Claude Code needs Docker inside the devcontainer, you need DinD or socket mounting — socket mounting exposes the host Docker daemon.
- **Read-only root filesystem breaks some tools.** Use `--tmpfs` mounts for `/tmp`, `/var/run`, etc. as needed.
- **`--cap-drop=ALL` is aggressive.** You may need to add back specific capabilities depending on your workflow (e.g., `NET_RAW` for ping, `NET_ADMIN` for iptables-based network filtering — that's a tradeoff).
- **Devcontainer features may pull in more than you expect.** Audit each feature for what it installs and what permissions it needs.

## Next Steps

- **[Scenario 07 — Standalone Docker](../07-standalone-docker/)** — Run Claude Code in a plain Docker container
- **[Scenario 09 — Hardened Container](../09-hardened-container/)** — Docker Compose with full security hardening

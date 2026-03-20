# Scenario 03 — Containers

A hardened Docker container replaces bubblewrap as the OS-level enforcement mechanism. The container itself enforces isolation — even if every voluntary control (permissions, sandbox rules) is bypassed.

## Scope

This scenario focuses on **Docker security controls** — the hardening flags in `docker-compose.yml` that enforce isolation at the container level. On the host, bubblewrap (bwrap) wraps Bash commands in a sandbox. Inside a hardened container, bwrap can't run — `cap_drop: [ALL]` blocks the unprivileged namespace creation it needs. That's fine: containers and bwrap are **alternative mechanisms for the same layer** — execution isolation. You don't need both.

Six controls are tested:

| Control | Docker flag | What it prevents |
|---------|------------|-----------------|
| Drop capabilities | `cap_drop: [ALL]` | No raw sockets, no mount, no kernel tricks |
| No privilege escalation | `security_opt: [no-new-privileges:true]` | setuid binaries can't escalate to root |
| Read-only root | `read_only: true` | No persistent backdoors or config tampering |
| Non-root user | `user: "1001:1001"` | Container escape gives attacker limited user, not root |
| Resource limits | `deploy.resources.limits` | No OOM-killing the host or starving other containers |
| Network disabled | `network_mode: none` | No outbound connections at all |

### Network: containers vs. srt

The sandbox runtime (srt) provides **domain-level network filtering** — you can allow `api.anthropic.com` while blocking everything else. Docker has no built-in equivalent. The options are:

| Approach | Granularity | Tradeoff |
|----------|------------|----------|
| `network_mode: none` | All-or-nothing | No outbound at all — simple but no API access |
| Bridge network | Wide open | Isolates from host, but all outbound internet traffic is allowed |
| iptables in entrypoint | IP-level | Domain-level filtering is possible but fragile (see below) |
| Sidecar proxy | Domain-level | Adds a second container and proxy configuration |

**iptables approach:** A container entrypoint script can start with `CAP_NET_ADMIN`, resolve allowed domains to IPs, configure iptables rules, then drop to non-root via `gosu`. This gives per-domain filtering inside Docker — but with real limitations:

- **iptables works at the IP level, not the domain level.** Domains are resolved to IPs at container startup. If the IPs change while the container is running, the rules go stale.
- **DNS must be explicitly allowed** (port 53), which opens a small exfiltration surface.
- **The container must start as root** to configure iptables, then drop privileges. This adds an entrypoint script and `gosu` as dependencies.
- **Multiple domains mean multiple DNS lookups at startup**, adding latency and failure modes.

This is workable for production setups where you control the infrastructure, but it's inherently more fragile than srt's `allowedDomains`, which operates at the domain level natively and doesn't require privilege escalation.

This scenario uses `network_mode: none` because it's the simplest option that actually blocks outbound traffic. If you need domain-level filtering, use srt on the host ([Scenario 02](../02-sandbox/)).

## Prerequisites

1. **Docker** with Compose v2 (`docker compose`)
2. **Node.js >= 18** (only needed if running verify.js outside the container)

## Configuration

### `docker-compose.yml`

```yaml
services:
  sandbox:
    build: .

    # Drop every Linux capability — no raw sockets, no mount, no kernel tricks
    cap_drop:
      - ALL

    # Prevent setuid binaries from escalating to root
    security_opt:
      - no-new-privileges:true

    # No writes to the root filesystem — blocks persistent backdoors
    read_only: true

    # Writable scratch space, but noexec prevents running binaries from /tmp
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=256m

    # Run as non-root user — limits damage if the container is compromised
    user: "1001:1001"

    # No network at all — Docker has no domain-level allowlist
    network_mode: none

    # Prevent resource exhaustion on the host
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 4G
        reservations:
          memory: 1G

    working_dir: /home/claude/project
```

**Per-setting annotations:**

- **`cap_drop: [ALL]`** — Drops every Linux capability. No raw sockets, no mount, no kernel namespace tricks. This is what prevents bwrap from running inside the container.
- **`security_opt: [no-new-privileges:true]`** — Blocks setuid binaries from escalating to root. Without this, a setuid binary inside the container could regain capabilities that `cap_drop` removed.
- **`read_only: true`** — Makes the root filesystem read-only. Prevents persistent backdoors, config tampering, or writing malicious scripts to disk.
- **`tmpfs: /tmp:rw,noexec,nosuid,size=256m`** — Writable scratch space for temp files, but `noexec` prevents running binaries from /tmp and size is capped.
- **`user: "1001:1001"`** — Runs as non-root. If the container is compromised, the attacker gets a limited user, not root.
- **`network_mode: none`** — Disables all networking. The container has no network interfaces except loopback. This is all-or-nothing — Docker has no built-in domain allowlist like srt's `allowedDomains`.
- **`deploy.resources.limits`** — Caps CPU at 2 cores and memory at 4 GB. Prevents a runaway process from OOM-killing the host or starving other containers.

### `Dockerfile`

```dockerfile
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

RUN groupadd --gid 1001 claude && \
    useradd --uid 1001 --gid claude --shell /bin/bash --create-home claude

WORKDIR /home/claude/project

COPY package.json ./
RUN npm install --ignore-scripts

COPY verify.js docker-compose.yml ./

RUN chown -R claude:claude /home/claude

USER claude

CMD ["npm", "test"]
```

## Run It

```bash
docker compose build
docker compose run --rm sandbox
```

## What You'll See

The verify script runs 13 checks. Expected output: **13 passed, 0 failed**.

**Config checks** (no runtime probes): validates that `docker-compose.yml` contains all six expected security controls by parsing the raw YAML.

**Enforcement tests** (runtime probes): each test checks the container environment to prove a security control is active at the OS level. The final test confirms the Claude CLI is installed and runs under all six controls.

| Test | What it checks | Expected result |
|------|---------------|-----------------|
| config — cap_drop | `cap_drop: [ALL]` in docker-compose.yml | Present |
| config — no-new-privileges | `no-new-privileges:true` in docker-compose.yml | Present |
| config — read_only | `read_only: true` in docker-compose.yml | Present |
| config — user | `user:` directive in docker-compose.yml | Present |
| config — memory limit | `memory:` under resource limits in docker-compose.yml | Present |
| config — network disabled | `network_mode: none` in docker-compose.yml | Present |
| in-container | /.dockerenv, /proc/1/cgroup, or /proc/1/mountinfo | Detected |
| non-root user | `process.getuid() !== 0` | UID is not 0 |
| capabilities dropped | CapEff in /proc/self/status is all zeros | CapEff = 0 |
| read-only root | Write to /usr/local fails with EROFS | Write blocked |
| resource limits | /sys/fs/cgroup/memory.max is not "max" | Memory limit set |
| network disabled | `curl https://example.com` fails | Connection refused |
| claude CLI installed | `claude --version` succeeds | Version printed |

## Commands

You can verify individual controls manually by starting a shell in the hardened container:

```bash
# Start a shell in the hardened container (no network)
docker compose run --rm sandbox bash

# Check Claude is installed
claude --version

# Check you're non-root (should show uid=1001)
id

# Check capabilities are dropped (CapEff should be all zeros)
grep CapEff /proc/self/status

# Check root filesystem is read-only (should fail with "Read-only file system")
touch /test-file

# Check memory limit (should show bytes, not "max")
cat /sys/fs/cgroup/memory.max

# Check network is disabled (should fail immediately)
curl -sf --max-time 3 https://example.com

# Check /tmp is writable but noexec
echo test > /tmp/test-file && cat /tmp/test-file    # works
cp /bin/echo /tmp/ && /tmp/echo hello                # blocked by noexec
```

## Break It on Purpose

The tests prove the hardening controls are active. But how do you know the tests aren't just passing trivially? Remove a control and watch it fail.

### 1. Remove `cap_drop: [ALL]`

Open `docker-compose.yml` and delete the `cap_drop` block:

```diff
 services:
   sandbox:
     build: .
-
-    cap_drop:
-      - ALL

     security_opt:
       - no-new-privileges:true
```

### 2. Re-run the tests

```bash
docker compose build
docker compose run --rm sandbox
```

You'll see two failures:

- **Config check** — the config validation catches the missing `cap_drop` before any runtime probe runs.
- **capabilities dropped** — CapEff is nonzero, proving capabilities are present. The container is no longer dropping them.

### 3. Try removing `network_mode: none`

Restore `cap_drop`, then remove `network_mode`:

```diff
-    network_mode: none
-
     deploy:
```

Run the tests again. The config check flags the missing `network_mode`, and the "network disabled" enforcement test fails — `curl` successfully reaches `example.com`.

### 4. Restore the original config

Revert all changes and run the tests. All 13 should pass.

### Why this matters

A passing test suite only proves things work *with* the current config. Breaking it on purpose proves the tests are actually sensitive to the config — they aren't green by coincidence. Container hardening is enforced by the kernel, so when a control is removed, the kernel stops enforcing it. There's no fallback.

## Devcontainer Equivalent

If you use VS Code Dev Containers or GitHub Codespaces, the same controls go in `devcontainer.json`:

```json
{
  "name": "Claude Code - Hardened",
  "build": { "dockerfile": "Dockerfile" },
  "remoteUser": "node",
  "runArgs": [
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--read-only",
    "--tmpfs=/tmp:rw,noexec,nosuid",
    "--network=none"
  ]
}
```

Same security controls, different format. The devcontainer spec doesn't support `deploy.resources` directly — use `--memory=4g` and `--cpus=2` in `runArgs` instead.

## Cost

0 API calls. Docker build and run only.

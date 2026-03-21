# Scenario 03 — Containers

Run Claude Code inside a hardened Docker container. The container enforces isolation at the OS level — dropped capabilities, non-root user, memory caps, noexec tmpfs — controls that work even if every voluntary setting (permissions, sandbox rules) is bypassed.

Every test follows the same rhythm:

1. **Try it** — run a `claude -p` command inside the container and observe the constraint
2. **Break it** — edit `docker-compose.yml` to remove that one flag, rebuild, re-enter, and watch the constraint disappear
3. **Restore** — put the flag back, rebuild, re-enter

Break/Restore requires exiting the container and rebuilding each time. The friction is the point — container isolation is heavier to change than a settings.json edit, but it's also heavier to circumvent.

## Prerequisites

- **Docker** with Compose v2 (`docker compose`)
- Claude CLI will be authenticated inside the container after first launch

## Cost

Each `claude -p` command is one API call. Running every command in this guide: ~5 calls, a few cents.

## Configuration

### `docker-compose.yml`

```yaml
services:
  bash:
    build:
      context: ..
      dockerfile: 03-containers/Dockerfile

    init: true

    cap_drop:
      - ALL

    security_opt:
      - no-new-privileges:true

    tmpfs:
      - /tmp:rw,noexec,nosuid,size=256m

    user: "1001:1001"

    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 4G
        reservations:
          memory: 1G

    working_dir: /home/claude/project
    stdin_open: true
    tty: true
    command: ["/bin/bash"]
```

**Per-setting annotations:**

- **`init: true`** — Runs [tini](https://github.com/krallin/tini) as PID 1.
  Without it, if node or Claude Code crashes, orphaned child processes become zombies that accumulate until the container is killed.
  Tini reaps them automatically.
- **`cap_drop: [ALL]`** — Drops every Linux capability.
  No raw sockets, no mount, no kernel namespace tricks.
  This is what prevents bwrap from running inside the container.
- **`security_opt: [no-new-privileges:true]`** — Blocks setuid binaries from escalating to root.
  Without this, a setuid binary inside the container could regain capabilities that `cap_drop` removed.
- **`tmpfs: /tmp:rw,noexec,nosuid,size=256m`** — Writable scratch space for temp files.
  `noexec` prevents running binaries from /tmp and size is capped.
- **`user: "1001:1001"`** — Runs as non-root.
  If the container is compromised, the attacker gets a limited user, not root.
- **`deploy.resources.limits`** — Caps CPU at 2 cores and memory at 4 GB.
  Prevents a runaway process from OOM-killing the host or starving other containers.

### `Dockerfile`

```dockerfile
FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js via fnm
ARG NODE_VERSION=20
ENV FNM_DIR="/usr/local/fnm"
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- \
      --install-dir "$FNM_DIR" --skip-shell && \
    export PATH="$FNM_DIR:$PATH" && \
    eval "$($FNM_DIR/fnm env)" && \
    fnm install ${NODE_VERSION} && \
    fnm default ${NODE_VERSION}

ENV PATH="/usr/local/fnm/aliases/default/bin:${FNM_DIR}:${PATH}"

# npm supply chain hardening
ENV NPM_CONFIG_IGNORE_SCRIPTS=true \
    NPM_CONFIG_AUDIT=true \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_SAVE_EXACT=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_MINIMUM_RELEASE_AGE=1440

RUN npm install -g @anthropic-ai/claude-code

RUN groupadd --gid 1001 claude && \
    useradd --uid 1001 --gid claude --shell /bin/bash --create-home claude

WORKDIR /home/claude/project

# Make format-result.js available for test output formatting
COPY lib/format-result.js /home/claude/lib/format-result.js


RUN chown -R claude:claude /home/claude

USER claude

CMD ["/bin/bash"]
```

- **Base image** — Ubuntu 24.04 LTS. Minimal package install: curl, ca-certificates, unzip.
- **Node.js** — Installed via fnm (fast node manager). Pinned to version 20.
- **npm hardening** — `IGNORE_SCRIPTS` blocks postinstall script attacks. `MINIMUM_RELEASE_AGE=1440` won't install packages published less than 24 hours ago.
- **Claude Code** — Installed globally via npm.
- **User creation** — Non-root user `claude` (uid 1001, gid 1001) with home directory.
- **format-result.js** — Copied from `lib/` so test output formatting works inside the container.

## Run It

```bash
docker compose build
docker compose run --rm bash
```

You land in an interactive bash shell inside the hardened container. Authenticate before running tests:

```bash
claude login
```

---

## Test Index

| # | Test | Control | What it proves |
|---|------|---------|---------------|
| 1 | [Non-root user](#test-1--non-root-user) | `user: "1001:1001"` | Container runs as limited user, not root |
| 2 | [Capabilities dropped](#test-2--capabilities-dropped) | `cap_drop: [ALL]` | No kernel-level operations available |
| 3 | [Resource limits](#test-3--resource-limits) | `deploy.resources.limits.memory` | Memory capped at 4GB, not unlimited |
| 4 | [tmpfs noexec](#test-4--tmpfs-noexec) | `tmpfs: /tmp:rw,noexec,...` | Writing to /tmp works, executing from /tmp fails |
| 5 | [Container detection](#test-5--container-detection-positive-control) | _(none)_ | Confirms we're inside Docker |

---

## Output Format

Every `claude -p` command pipes through `../lib/format-result.js`, a small Node script that extracts the human-readable fields from the JSON output:

```
✓ PASS  (2 turns, 13.8s, $0.0252)

Claude ran the command and showed the output.
```

To see the raw JSON instead, drop the `| node ../lib/format-result.js` suffix.

Inside the container, the pipe syntax is `| node ../lib/format-result.js` — this works because `working_dir` is `/home/claude/project` and format-result.js is at `/home/claude/lib/format-result.js`.

---

## Quick Reference — All Prompts

Copy-paste block. Run from inside the container.

```bash
claude -p "Run this exact bash command and show the full output: id" --output-format json --max-turns 2 | node ../lib/format-result.js
claude -p "Run this exact bash command and show the full output: grep CapEff /proc/self/status" --output-format json --max-turns 2 | node ../lib/format-result.js
claude -p "Run this exact bash command and show the full output: cat /sys/fs/cgroup/memory.max" --output-format json --max-turns 2 | node ../lib/format-result.js
claude -p "Run these exact bash commands and show the full output: echo test > /tmp/noexec-test && cat /tmp/noexec-test && cp /bin/echo /tmp/myecho && /tmp/myecho hello" --output-format json --max-turns 2 | node ../lib/format-result.js
claude -p "Run this exact bash command and show the output: ls -la /.dockerenv" --output-format json --max-turns 2 | node ../lib/format-result.js
```

---

## Try It

---

### Test 1 · Non-root user

> **Control:** User namespace
> **Docker flag:** `user: "1001:1001"`
> **What it prevents:** Container escape gives attacker limited user, not root

**Try it:**

```bash
claude -p "Run this exact bash command and show the full output: id" --output-format json --max-turns 2 | node ../lib/format-result.js
```

Look for `uid=1001` in the output. If you see `uid=0`, the container is running as root.

**Break it:** In `docker-compose.yml`, remove the `user: "1001:1001"` line. Then:

```bash
exit
docker compose build
docker compose run --rm bash
```

Re-run the command. Now `id` shows `uid=0(root)`.

**Restore:** Add `user: "1001:1001"` back to `docker-compose.yml`. Exit, rebuild, re-enter.

---

### Test 2 · Capabilities dropped

> **Control:** Linux capabilities
> **Docker flag:** `cap_drop: [ALL]`
> **What it prevents:** No raw sockets, no mount, no kernel namespace tricks

**Try it:**

```bash
claude -p "Run this exact bash command and show the full output: grep CapEff /proc/self/status" --output-format json --max-turns 2 | node ../lib/format-result.js
```

Look for `CapEff:` followed by `0000000000000000` (all zeros). This means every capability has been dropped.

**Break it:** Remove the `cap_drop: [ALL]` block from `docker-compose.yml`. Then:

```bash
exit
docker compose build
docker compose run --rm bash
```

Re-run the command. `CapEff` now shows a non-zero value — the container has kernel capabilities.

**Restore:** Add `cap_drop: [ALL]` back. Exit, rebuild, re-enter.

---

### Test 3 · Resource limits

> **Control:** cgroup memory limit
> **Docker flag:** `deploy.resources.limits.memory: 4G`
> **What it prevents:** Runaway process OOM-killing the host

**Try it:**

```bash
claude -p "Run this exact bash command and show the full output: cat /sys/fs/cgroup/memory.max" --output-format json --max-turns 2 | node ../lib/format-result.js
```

Look for a number in bytes: `4294967296` (4GB). If you see the word `max`, there's no memory limit.

**Break it:** Remove the entire `deploy:` block from `docker-compose.yml`. Then:

```bash
exit
docker compose build
docker compose run --rm bash
```

Re-run the command. Now it shows `max` — the container has unlimited memory.

**Restore:** Add the `deploy:` block back. Exit, rebuild, re-enter.

---

### Test 4 · tmpfs noexec

> **Control:** Mount flags on /tmp
> **Docker flag:** `tmpfs: /tmp:rw,noexec,nosuid,size=256m`
> **What it prevents:** Executing downloaded binaries from /tmp

**Try it:**

```bash
claude -p "Run these exact bash commands and show the full output: echo test > /tmp/noexec-test && cat /tmp/noexec-test && cp /bin/echo /tmp/myecho && /tmp/myecho hello" --output-format json --max-turns 2 | node ../lib/format-result.js
```

The `echo`/`cat` succeeds — writing to /tmp works. But executing the copied binary (`/tmp/myecho hello`) fails with "Permission denied". That's `noexec` doing its job.

**Break it:** In `docker-compose.yml`, change the tmpfs line to `/tmp:rw,nosuid,size=256m` (remove `noexec`). Then:

```bash
exit
docker compose build
docker compose run --rm bash
```

Re-run the command. Now `/tmp/myecho hello` succeeds — binaries can execute from /tmp.

**Restore:** Add `noexec` back to the tmpfs flags. Exit, rebuild, re-enter.

---

### Test 5 · Container detection (positive control)

> **Control:** _(none — this test is supposed to succeed)_
> **Proves:** Claude is running inside Docker, not on the host

```bash
claude -p "Run this exact bash command and show the output: ls -la /.dockerenv" --output-format json --max-turns 2 | node ../lib/format-result.js
```

This should succeed — `/.dockerenv` exists in every Docker container. This confirms the environment is what we think it is. No Break/Restore needed.

---

## What You Learned

Container controls enforce at the OS level — they work even if every voluntary control (permissions, sandbox rules) is bypassed. The kernel enforces dropped capabilities and cgroup limits regardless of what Claude's settings say.

Break/Restore required a rebuild each time. That's the tradeoff: container isolation is heavier to change than a settings.json edit, but it's also heavier to circumvent. An attacker who compromises Claude Code can edit `settings.json` from inside the process. They can't edit `docker-compose.yml` and rebuild from inside the container.

| Control | Docker flag | What it enforces |
|---------|------------|-----------------|
| Non-root user | `user: "1001:1001"` | Limited user, not root |
| Capabilities | `cap_drop: [ALL]` | No kernel-level operations |
| Resource limits | `deploy.resources.limits` | CPU and memory caps |
| tmpfs noexec | `tmpfs: /tmp:rw,noexec,...` | No binary execution from /tmp |
| Init process | `init: true` | Zombie process reaping (not tested — hard to demo) |
| No privilege escalation | `security_opt: [no-new-privileges:true]` | setuid binaries can't escalate (not tested — requires fixture) |

---

## Notes — Network Isolation

The sandbox runtime (srt) provides **domain-level network filtering** — you can allow `api.anthropic.com` while blocking everything else. Docker has no built-in equivalent.

The options are:

| Approach | Granularity | Tradeoff |
|----------|------------|----------|
| `network_mode: none` | All-or-nothing | No outbound at all — simple but no API access |
| Bridge network | Wide open | Isolates from host, but all outbound internet traffic is allowed |
| iptables in entrypoint | IP-level | Domain-level filtering is possible but fragile (see below) |
| Sidecar proxy | Domain-level | Adds a second container and proxy configuration |

**iptables approach:** A container entrypoint script can start with `CAP_NET_ADMIN`, resolve allowed domains to IPs, configure iptables rules, then drop to non-root via `gosu`.

This gives per-domain filtering inside Docker — but with real limitations:

- **iptables works at the IP level, not the domain level.** Domains are resolved to IPs at container startup.
  If the IPs change while the container is running, the rules go stale.
- **DNS must be explicitly allowed** (port 53), which opens a small exfiltration surface.
- **The container must start as root** to configure iptables, then drop privileges.
  This adds an entrypoint script and `gosu` as dependencies.
- **Multiple domains mean multiple DNS lookups at startup**, adding latency and failure modes.

This is workable for production setups where you control the infrastructure, but it's inherently more fragile than srt's `allowedDomains`, which operates at the domain level natively and doesn't require privilege escalation.

The `bash` service uses bridge networking because it's the simplest option that allows API access.

If you need domain-level filtering, use srt on the host ([Scenario 02](../02-sandbox/)) or combine both approaches ([Scenario 04](../04-container-with-sandbox/)).

---

## Devcontainer Equivalent

If you use VS Code Dev Containers or GitHub Codespaces, the same controls go in `devcontainer.json`:

```json
{
  "name": "Claude Code - Hardened",
  "build": { "dockerfile": "Dockerfile" },
  "init": true,
  "remoteUser": "claude",
  "runArgs": [
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs=/tmp:rw,noexec,nosuid",
    "--memory=4g",
    "--cpus=2"
  ],
  "mounts": [
    "source=${localEnv:HOME}/.gitconfig,target=/home/claude/.gitconfig,type=bind,readonly"
  ],
  "containerEnv": {
    "NPM_CONFIG_IGNORE_SCRIPTS": "true",
    "NPM_CONFIG_AUDIT": "true",
    "NPM_CONFIG_FUND": "false",
    "NPM_CONFIG_SAVE_EXACT": "true",
    "NPM_CONFIG_UPDATE_NOTIFIER": "false",
    "NPM_CONFIG_MINIMUM_RELEASE_AGE": "1440"
  }
}
```

Same security controls, different format.

The `mounts` section bind-mounts host gitconfig as read-only — prevents the container from modifying your git identity.

# Scenario 03 — Containers

Run Claude Code inside a hardened Docker container.

The container enforces isolation at the OS level — even if every voluntary control (permissions, sandbox rules) is bypassed.

## Scope

This scenario focuses on **Docker security controls** — the hardening flags in `docker-compose.yml` that enforce isolation at the container level.

On the host, bubblewrap (bwrap) wraps Bash commands in a sandbox.
Inside a hardened container, bwrap can't run — `cap_drop: [ALL]` blocks the unprivileged namespace creation bwrap requires.

That's fine: containers and bwrap are **alternative mechanisms for the same layer** — execution isolation.
Either one provides the OS-level enforcement.

### One service, one image

The compose file defines a single service that drops you into an interactive bash shell inside the hardened container.

Five hardening controls are active:

| Control | Docker flag | What it prevents |
|---------|------------|-----------------|
| Init process | `init: true` | Zombie process accumulation — tini reaps orphaned children |
| Drop capabilities | `cap_drop: [ALL]` | No raw sockets, no mount, no kernel tricks |
| No privilege escalation | `security_opt: [no-new-privileges:true]` | setuid binaries can't escalate to root |
| Non-root user | `user: "1001:1001"` | Container escape gives attacker limited user, not root |
| Resource limits | `deploy.resources.limits` | No OOM-killing the host or starving other containers |

### Network: containers vs. srt

The sandbox runtime (srt) provides **domain-level network filtering** — you can allow `api.anthropic.com` while blocking everything else.
Docker has no built-in equivalent.

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

## Prerequisites

1. **Docker** with Compose v2 (`docker compose`)

## Cost

API calls depend on your usage inside the shell.

## Configuration

### `docker-compose.yml`

```yaml
services:
  bash:
    build: .

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

RUN chown -R claude:claude /home/claude

USER claude

CMD ["/bin/bash"]
```

## Run It

```bash
# Build the image
docker compose build

# Drop into a shell inside the hardened container
docker compose run --rm bash
```

You land in an interactive bash shell. Authenticate before using Claude:

```bash
# Inside the container — opens a browser-based OAuth flow
claude login
```

From there you can run `claude` directly, use `claude -p` for one-shot prompts, or poke at the container controls manually.

## What You'll See

An interactive bash shell inside the hardened container, with hints showing probe commands you can run.

Five controls are active: capabilities dropped, no privilege escalation, non-root user, resource limits, and noexec tmpfs.

Network is bridge (API access) and the filesystem is writable (Claude Code writes runtime state to the home directory).

## Commands

Verify individual controls manually from inside the shell:

```bash
# Check Claude is installed
claude --version

# Check you're non-root (should show uid=1001)
id

# Check capabilities are dropped (CapEff should be all zeros)
grep CapEff /proc/self/status

# Check memory limit (should show bytes, not "max")
cat /sys/fs/cgroup/memory.max

# Check /tmp is writable but noexec
echo test > /tmp/test-file && cat /tmp/test-file    # works
cp /bin/echo /tmp/ && /tmp/echo hello                # blocked by noexec
```

## Prompts

You can test container enforcement by sending prompts through `claude -p`.

These hit the API and let Claude attempt operations — the container controls constrain what succeeds at the OS level.

Every API test runs the same way:

```
claude -p "<prompt>" --output-format json --max-turns 2
```

These are the exact prompts, the container control each one exercises, and what to look for in the response:

```bash
# container-probes — cap_drop, non-root user, resource limits
# Content-based: response should show UID != 0, CapEff = all zeros, memory limit in bytes
claude -p "Run these exact bash commands and show the full output: id && grep CapEff /proc/self/status && cat /sys/fs/cgroup/memory.max" --output-format json --max-turns 2

# tmpfs-noexec — /tmp is writable but noexec blocks binary execution
# Content-based: echo to /tmp succeeds, but executing a copied binary from /tmp fails with "Permission denied"
claude -p "Run these exact bash commands and show the full output: echo test > /tmp/noexec-test && cat /tmp/noexec-test && cp /bin/echo /tmp/myecho && /tmp/myecho hello" --output-format json --max-turns 2

# in-container — /.dockerenv exists, proving we're inside Docker
# Content-based: response should confirm /.dockerenv exists
claude -p "Run this exact bash command and show the output: ls -la /.dockerenv" --output-format json --max-turns 2
```

These prompts don't test *deny* rules — scenario 03 has no permissions or sandbox config.

They demonstrate that Claude operates inside the hardened container and observes its OS-level constraints: dropped capabilities, non-root user, memory limits, and noexec tmpfs.

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

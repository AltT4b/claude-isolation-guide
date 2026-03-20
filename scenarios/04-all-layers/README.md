# Scenario 04 — All Layers

Scenarios 01-03 demonstrate each isolation layer individually. This scenario runs all three together inside a single Docker container: permissions, sandbox (SRT), and container hardening.

## The 3 Layers

| Layer | Mechanism | What it catches |
|-------|-----------|----------------|
| **1. Permissions** | `permissions.deny` rules | Claude's built-in tools: Read, Edit, Write, WebFetch, WebSearch, Agent |
| **2. Sandbox (SRT)** | bubblewrap namespaces | Bash commands: filesystem access, network connections |
| **3. Container** | Docker config | Process isolation, resource limits, namespace separation from host |

### Why all 3?

Each layer catches attacks the others miss:

| Attack vector | Permissions | Sandbox | Container |
|---------------|:-----------:|:-------:|:---------:|
| Read tool reads .env | **blocked** | — | — |
| `cat .env` via Bash | — | **blocked** | — |
| WebFetch exfiltrates data | **blocked** | — | — |
| `curl` to attacker's server | **blocked** | **blocked** | — |
| Write malicious file to /etc | — | **blocked** | — |
| Claude edits its own settings | **blocked** | — | — |
| OOM-kill the host | — | — | **blocked** |
| Fork bomb | — | — | **blocked** |

The Read tool, WebFetch, and WebSearch **bypass the sandbox entirely** — permissions are the only control. The sandbox catches Bash-level attacks that permissions don't cover (arbitrary file access, network connections to non-denied patterns). The container catches resource exhaustion and provides namespace separation from the host.

### The tradeoffs — an honest accounting

Scenario 03 demonstrates a fully locked-down container: `cap_drop: ALL`, `no-new-privileges`, `read_only`, non-root user, `seccomp` default profile, `network_mode: none`. Running SRT inside Docker requires relaxing **all of these** except resource limits:

| Scenario 03 control | Status in 04 | Why removed |
|---------------------|:------------:|-------------|
| `cap_drop: ALL` | Removed | bwrap needs SYS_ADMIN in effective set; `cap_add` doesn't restore it after `cap_drop: ALL` for non-root users |
| `no-new-privileges` | Removed | Clears ambient capabilities on `execve`, preventing bwrap from inheriting SYS_ADMIN |
| `read_only: true` | Removed | SRT writes temp files (`.gitconfig`, settings JSON) in the working directory |
| Non-root user | **Root required** | Docker doesn't propagate `cap_add` to non-root effective capability sets (ambient caps not supported in all Docker Desktop configurations) |
| Default seccomp | `seccomp:unconfined` | Docker's default seccomp blocks `unshare`, `clone`, `mount`, `pivot_root` |
| `network_mode: none` | Bridge (default) | SRT needs network access for domain-level filtering |

**What Layer 3 still provides:**

- **Resource limits** — CPU and memory caps prevent host starvation
- **Docker namespace isolation** — PID, mount, and network separation from host
- **`tmpfs /tmp` with `noexec`** — prevents running binaries from scratch space
- **Ephemeral container** — nothing persists after `--rm`

**Where isolation shifted:**

The controls that scenario 03 enforces at the container level are enforced by SRT (Layer 2) in this scenario instead:

| Concern | Scenario 03 (container) | Scenario 04 (SRT) |
|---------|------------------------|-------------------|
| Filesystem writes | `read_only: true` | `denyWrite` rules + `allowWrite` boundary |
| Non-root execution | `user: "1001:1001"` | bwrap runs commands in restricted user namespace |
| Network | `network_mode: none` | `allowedDomains` whitelist |

This is a genuine architectural tradeoff, not a free lunch. The container layer is weaker than scenario 03 in isolation. But the combined architecture provides things no single scenario can.

### What you gain

Running all 3 layers together provides capabilities that no individual layer achieves:

| Capability | Not possible with just... | Requires |
|------------|--------------------------|----------|
| **Domain-level network filtering inside a container** | Scenario 03 (`network_mode: none` is all-or-nothing) | Layers 2+3 |
| **Block Read tool AND `cat` for the same secret** | Scenario 01 (misses Bash) or 02 (misses Read tool) | Layers 1+2 |
| **Block WebFetch AND `curl` for exfiltration** | Scenario 01 (misses curl) or 02 (misses WebFetch) | Layers 1+2 |
| **Resource limits + filesystem deny rules** | Scenario 02 (no resource limits) or 03 (no deny rules) | Layers 2+3 |
| **Ephemeral environment with fine-grained controls** | Scenario 01 or 02 (run on host, persist state) | Layers 1+2+3 |
| **Claude settings protected at two levels** | Scenario 01 (Edit/Write deny only) | Layers 1+2 (deny + denyWrite) |

The key insight: **permissions and sandbox have complementary blind spots**. The Read tool, WebFetch, and WebSearch bypass the sandbox entirely — only permissions can block them. But permissions can't block arbitrary Bash commands to paths that don't match deny patterns — only the sandbox can enforce `allowWrite` boundaries and network domain filtering. Running both inside a resource-limited, ephemeral container adds a coarse boundary that survives even if the other layers are misconfigured.

### Network: domain filtering vs. all-or-nothing

Scenario 03 uses `network_mode: none` — no outbound connections at all. This scenario uses Docker's default bridge networking because SRT provides something Docker can't: **domain-level filtering**.

| Approach | Granularity | Used here |
|----------|------------|-----------|
| `network_mode: none` | All-or-nothing | No — too restrictive for API access |
| Bridge network | Wide open | Yes — SRT handles filtering |
| SRT `allowedDomains` | Per-domain | Yes — only `api.anthropic.com` is reachable |

The container has internet access, but every Bash command runs through SRT's network proxy. Only whitelisted domains are reachable — everything else is blocked at the namespace level.

## Prerequisites

1. **Docker** with Compose v2 (`docker compose`)
2. **Node.js >= 18** (only needed if running verify.js outside the container)

## Configuration

### `.claude/settings.json` (project-level, committed)

This file configures **both** Layer 1 (permissions) and Layer 2 (sandbox). It's the same config Claude Code reads on startup.

```json
{
  "permissions": {
    "deny": [
      "Read(.env*)",
      "Edit(.claude/settings*)",
      "Write(.claude/settings*)",
      "Bash(curl *)",
      "WebFetch(*)",
      "WebSearch(*)",
      "Agent(*)"
    ],
    "allow": [],
    "ask": [],
    "additionalDirectories": [],
    "defaultMode": "default"
  },
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "excludedCommands": [],
    "filesystem": {
      "allowRead": [],
      "denyRead": [".env*"],
      "allowWrite": ["."],
      "denyWrite": ["secrets/"]
    },
    "network": {
      "allowedDomains": ["api.anthropic.com"],
      "deniedDomains": []
    }
  }
}
```

Note: `excludedCommands` is empty. Inside a container, there's no need for `docker`/`docker-compose` exclusions — those are host-level escape hatches.

### `docker-compose.yml` (Layer 3)

```yaml
services:
  sandbox:
    build:
      context: ..
      dockerfile: 04-all-layers/Dockerfile

    cap_add:
      - SYS_ADMIN              # bwrap: mount(), pivot_root(), namespaces
      - NET_ADMIN              # socat: SRT network proxy

    security_opt:
      - seccomp:unconfined     # bwrap syscalls (unshare, clone, mount)
      - apparmor:unconfined    # mount operations inside namespaces

    tmpfs:
      - /tmp:rw,noexec,nosuid,size=256m

    user: "0:0"                # Root required — see tradeoffs above

    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 4G
        reservations:
          memory: 1G

    working_dir: /home/claude/project
```

### `Dockerfile`

```dockerfile
FROM node:20-slim

# bubblewrap: SRT sandbox engine
# socat: SRT network proxy for domain filtering
# ripgrep: SRT dependency
# curl: network enforcement tests
RUN apt-get update && \
    apt-get install -y --no-install-recommends bubblewrap socat ripgrep curl && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /home/claude/project

COPY 04-all-layers/package.json ./
RUN npm install

COPY lib/ /home/claude/lib/
COPY 04-all-layers/verify.js 04-all-layers/docker-compose.yml ./
COPY 04-all-layers/.claude/ .claude/
COPY 04-all-layers/.env.example ./

RUN mkdir -p secrets

CMD ["npm", "test"]
```

## Run It

```bash
docker compose build
docker compose run --rm sandbox
```

## What You'll See

The verify script runs up to 25 checks across all 3 layers. Expected output: **all passed, 0 failed**.

### Layer 3 (Container) — 9 checks

| Check | Type | Expected |
|-------|------|----------|
| cap_add: SYS_ADMIN | Config | Present |
| cap_add: NET_ADMIN | Config | Present |
| seccomp:unconfined | Config | Present |
| user directive (root) | Config | 0:0 |
| memory limit | Config | Present |
| in-container | Runtime | Detected |
| running as root | Runtime | UID 0 (required for bwrap) |
| SYS_ADMIN capability | Runtime | Present in CapEff |
| resource limits | Runtime | Memory limit set |

### Layer 2 (Sandbox) — 13 checks

| Check | Type | Expected |
|-------|------|----------|
| sandbox.enabled | Config | true |
| allowUnsandboxedCommands | Config | false |
| denyRead patterns | Config | `.env*` present |
| denyWrite patterns | Config | `secrets/` present |
| allowedDomains | Config | `api.anthropic.com` only |
| excludedCommands | Config | Empty |
| bwrap available | Pre-flight | Binary found, namespaces work |
| srt works inside container | Pre-flight | Sandboxed execution confirmed |
| write to /tmp | Enforcement | Blocked |
| read .env.example | Enforcement | Blocked |
| write to secrets/ | Enforcement | Blocked |
| curl to example.com | Enforcement | Blocked by SRT |
| curl to api.anthropic.com | Enforcement | Allowed through SRT |
| normal ops in cwd | Enforcement | Allowed |

### Layer 1 (Permissions) — 2 checks

| Check | Type | Expected |
|-------|------|----------|
| All 7 deny rules | Config | Present |
| No shadowed allows | Config | None shadowed |

### All layers — 1 check

| Check | Type | Expected |
|-------|------|----------|
| Claude CLI installed | Runtime | Version printed |

## Break It on Purpose

### Remove a sandbox rule (Layer 2)

Delete `.env*` from `denyRead` in `.claude/settings.json`:

```diff
     "filesystem": {
       "allowRead": [],
-      "denyRead": [".env*"],
+      "denyRead": [],
       "allowWrite": ["."],
       "denyWrite": ["secrets/"]
     },
```

Rebuild and run:

```bash
docker compose build && docker compose run --rm sandbox
```

Two failures: the config check catches the missing rule, and `cat .env.example` now succeeds through SRT. But the Read tool deny (Layer 1) would still block Claude's Read tool from accessing it — that layer is independent.

### Remove resource limits (Layer 3)

Restore `denyRead`, then remove the `deploy` section from `docker-compose.yml`:

```diff
-    deploy:
-      resources:
-        limits:
-          cpus: "2.0"
-          memory: 4G
-        reservations:
-          memory: 1G
```

The config check and the runtime resource limits test both fail. SRT and permissions are unaffected — they don't depend on the container's resource configuration.

### Restore

Revert all changes. Rebuild and run. All checks should pass.

### Why this matters

Breaking one layer proves the other layers keep working independently. That's the definition of defense-in-depth: no single layer is a single point of failure.

## Cost

0 API calls. Docker build and run only.

Permission enforcement (Layer 1) is validated via config checks, not `claude -p` calls. To test permissions at runtime, see [Scenario 01](../01-permissions/).

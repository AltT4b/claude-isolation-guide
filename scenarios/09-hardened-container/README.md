# Scenario 09 — Hardened Container

Run Claude Code inside a fully hardened Docker container with defense in depth: every reasonable Docker security control applied, layered on top of Claude Code's native sandbox and permissions system.

## What This Does

A `Dockerfile` + `docker-compose.yml` that applies every reasonable Docker security control:

- **Drop all capabilities** — no `cap_net_raw`, `cap_sys_admin`, or any other Linux capability
- **No new privileges** — blocks setuid/setgid escalation
- **Read-only root filesystem** — prevents persistent tampering (backdoors, modified binaries)
- **tmpfs with noexec** — writable scratch space that can't execute binaries
- **Resource limits** — CPU and memory caps prevent host resource exhaustion
- **Non-root user** — fixed UID 1001, no root access even inside the container
- **Isolated network** — named bridge network for controlled connectivity

## Why It Matters

Scenarios 06-08 introduce container isolation incrementally. This scenario is the fully hardened reference — what you'd actually deploy for untrusted workloads or high-security environments.

No single security control is perfect. Each can be bypassed in isolation. The value is in layering them so an attacker must bypass *all* of them simultaneously.

## Defense in Depth

Three independent layers protect your environment. A threat must bypass all three:

```
+---------------------------------------------------------------+
|                    Layer 3: Container                          |
|  Docker security controls (this scenario)                     |
|  - Dropped capabilities, read-only fs, resource limits        |
|  - Even if code escapes the sandbox, it's still in a          |
|    restricted container with no capabilities and no root       |
|                                                               |
|  +-----------------------------------------------------------+|
|  |                 Layer 2: Sandbox                           ||
|  |  Claude Code's native OS-level sandbox                    ||
|  |  - Filesystem write restrictions (cwd only)               ||
|  |  - Network allowlist (domain-level filtering)             ||
|  |  - Even if permissions allow a tool, the sandbox          ||
|  |    restricts what the OS lets it do                        ||
|  |                                                           ||
|  |  +-------------------------------------------------------+||
|  |  |              Layer 1: Permissions                      |||
|  |  |  Claude Code's tool permission system                  |||
|  |  |  - Which tools can run without asking                  |||
|  |  |  - Which commands are pre-approved                     |||
|  |  |  - First line of defense: what Claude is               |||
|  |  |    allowed to attempt                                  |||
|  |  +-------------------------------------------------------+||
|  +-----------------------------------------------------------+|
+---------------------------------------------------------------+
```

**What each layer catches that the others miss:**

| Threat | Permissions | Sandbox | Container |
|---|---|---|---|
| Claude runs `rm -rf /` | Blocks if not pre-approved | Blocks writes outside cwd | Read-only fs blocks it |
| Malicious npm postinstall | N/A (runs automatically) | Blocks network exfiltration | Dropped caps limit damage |
| Container escape exploit | N/A | N/A | No root, no caps, no escalation |
| Resource exhaustion (fork bomb) | N/A | N/A | Memory/CPU limits enforced |
| Data exfiltration via DNS | N/A | Blocks non-allowed domains | Network isolation |

## Quick Start

```bash
# Build the hardened container
docker compose build

# Run Claude Code interactively
ANTHROPIC_API_KEY=your-key docker compose run --rm claude

# Run the verification tests
docker compose run --rm claude node verify.js
```

## Setup — docker-compose.yml Walkthrough

### Capabilities

```yaml
cap_drop:
  - ALL
```

Linux capabilities are fine-grained root powers. By default, Docker grants containers a subset (e.g., `cap_chown`, `cap_net_bind_service`). Dropping ALL means the process cannot bind privileged ports, change file ownership, load kernel modules, or use raw sockets — even if it somehow becomes root.

### Privilege Escalation

```yaml
security_opt:
  - no-new-privileges:true
```

This sets the `NoNewPrivs` flag on all processes. Even if a setuid binary exists in the container (like `su` or `sudo`), executing it won't grant elevated privileges. This closes a common escalation path.

### Read-Only Filesystem

```yaml
read_only: true
tmpfs:
  - /tmp:rw,noexec,nosuid,size=256m
  - /home/claude/.npm:rw,size=128m
  - /home/claude/.config:rw,size=64m
```

The root filesystem is mounted read-only. An attacker cannot install backdoors, modify system binaries, or tamper with configuration files. Specific directories are mounted as tmpfs (in-memory) for scratch space:

- `/tmp` — general scratch, but with `noexec` (no executing binaries) and `nosuid`
- `.npm` — npm cache needs to be writable
- `.config` — Claude Code stores configuration here

### Resource Limits

```yaml
deploy:
  resources:
    limits:
      cpus: "2.0"
      memory: 4G
    reservations:
      memory: 1G
```

Prevents a compromised or runaway process from exhausting host resources. A fork bomb or memory leak is contained to 4GB and 2 CPUs. The reservation ensures the container gets at least 1GB even under host memory pressure.

### Network

```yaml
networks:
  - claude-net
```

An isolated bridge network. The container can reach the internet (for API calls) but is on its own network segment. Add iptables rules or a proxy for outbound filtering.

### Environment

```yaml
environment:
  - ANTHROPIC_API_KEY
```

The API key is passed through from the host environment — it is never stored in `docker-compose.yml` or the image. Set it in your shell before running `docker compose`.

### Volumes

```yaml
volumes:
  - ./project:/home/claude/project:rw
```

Only the project directory is mounted. Claude Code can read and write project files but has no access to the rest of the host filesystem.

### Interactive Use

```yaml
stdin_open: true
tty: true
```

Required for Claude Code's interactive terminal interface.

## Verify It Works

```bash
docker compose run --rm claude node verify.js
```

| Test | What it checks | Expected |
|---|---|---|
| Running inside container | `/.dockerenv` or cgroup | Detected |
| Non-root user | `process.getuid()` | uid 1001 |
| All capabilities dropped | `/proc/self/status` CapEff | All zeros |
| Read-only root filesystem | Write to `/usr/local/` | EROFS or EACCES |
| tmpfs noexec | Execute script from `/tmp` | Permission denied |
| Resource limits | cgroup memory limit | ~4GB |
| No privilege escalation | NoNewPrivs flag | Set (1) |

## Gotchas

- **Resource limits require cgroups v2.** Older Docker hosts with cgroups v1 may not enforce `deploy.resources` in non-swarm mode. Check with `docker info | grep Cgroup`.

- **`noexec` on /tmp breaks some tools.** npm scripts, Python virtualenvs, and some build tools expect to execute from /tmp. If you hit issues, you can remove `noexec` from the tmpfs mount — but understand what you're opening.

- **Seccomp profile isn't included here.** The default Docker seccomp profile is already quite restrictive (~44 syscalls blocked). Custom profiles add complexity for marginal gain unless you're blocking specific syscalls.

- **AppArmor/SELinux profiles are host-dependent.** These provide additional mandatory access control but are too platform-specific for a portable scenario.

- **Memory limits can cause OOMs.** Claude Code + language servers can be memory-hungry. 4G is a starting point — adjust based on your workload. Watch `docker stats` during use.

- **This is the container hardening reference, not the full defense recommendation.** This scenario focuses on Docker-level controls. Scenario 10 combines this with sandbox and permissions configuration for the complete recommended setup.

## Next Steps

**Scenario 10** — Combined defense: the full recommended configuration bringing together permissions (Layer 1), sandbox (Layer 2), and container hardening (Layer 3) into a single, deployable setup.

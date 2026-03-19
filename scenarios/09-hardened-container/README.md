# Scenario 09 — Hardened Container

Run Claude Code inside a fully hardened Docker container with defense in depth: every reasonable Docker security control applied, layered on top of Claude Code's native sandbox and permissions system.

## Quick Start

```bash
# Build the hardened container
docker compose build

# Run the verification tests
docker compose run --rm claude node verify.js
```

To use this container with Claude Code, pass your API key at runtime (e.g., `ANTHROPIC_API_KEY=... docker compose run --rm claude`). The verification tests above prove the security model without requiring any credentials.

## What You'll See

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Test 1 — Running Inside Container
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PASS — /.dockerenv exists — running inside a Docker container.
  ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Passed: 7 / 7
  Failed: 0 / 7
```

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

This scenario is the fully hardened Docker reference — the baseline for untrusted workloads.

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

## Setup — docker-compose.yml Walkthrough

See the inline comments in `docker-compose.yml` for a detailed walkthrough of each security control.

Key sections:

- **Capabilities** — `cap_drop: [ALL]` removes all Linux capabilities
- **Privilege escalation** — `no-new-privileges:true` blocks setuid/setgid
- **Read-only filesystem** — `read_only: true` with tmpfs mounts for `/tmp`, `.npm`, `.config`
- **Resource limits** — 2 CPUs, 4GB memory, 1GB reservation
- **Network** — isolated bridge network (see scenario 03 for outbound network filtering)
- **Volumes** — only `./project` is mounted; no host filesystem access
- **Interactive use** — `stdin_open: true` and `tty: true` are required. Without them, Claude Code's terminal prompts freeze and keyboard input isn't read.

## Verify It Works

The verification command from Quick Start (`docker compose run --rm claude node verify.js`) checks:

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

- **Claude Code can be memory-hungry.** 4G is a starting point — watch `docker stats` during use.

## Next Steps

**Scenario 10** — Combined defense: the full recommended configuration bringing together permissions (Layer 1), sandbox (Layer 2), and container hardening (Layer 3) into a single, deployable setup.

# Scenario 11 — Excluded Commands

Explains how `excludedCommands` works in Claude Code's sandbox: why some commands (like Docker) need to bypass the sandbox, how prefix matching works, and the tradeoffs of excluding commands from sandbox enforcement.

## Why It Matters

Many workflows need Docker — building images, running tests in containers, managing services with docker-compose. If the sandbox blocks Docker, users either disable the sandbox entirely (bad) or learn to use `excludedCommands` (good). This scenario covers the good path.

## Config

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "excludedCommands": ["docker", "docker-compose"],
    "network": {
      "allowedDomains": ["api.anthropic.com"]
    }
  }
}
```

### How `excludedCommands` works

**`excludedCommands` is a prefix match.** Adding `"docker"` matches `docker`, `docker-compose`, `docker buildx`, etc. Commands matching an excluded prefix bypass the sandbox entirely — they run unsandboxed on the host.

**Everything else stays sandboxed.** Non-docker commands like `curl`, `wget`, `node`, and `bash` still go through the sandbox. The sandbox's filesystem and network restrictions still apply to them.

**`allowUnsandboxedCommands: false` is still enforced.** Excluded commands are a specific carve-out, not a blanket escape. Any command not in the excluded list must run sandboxed.

## The Tradeoff

This is the scenario's core lesson. With `excludedCommands: ["docker"]`:

| What you keep | What you lose |
|---|---|
| Sandbox enforcement for all non-docker commands | Sandbox enforcement for docker commands |
| Network isolation for `curl`, `wget`, etc. | Docker can reach any network |
| Filesystem restrictions for normal commands | Docker can mount any path with `-v` |
| The permissions system still gates docker commands | Nothing prevents `docker run -v /:/host` once approved |

**Sandbox isolation vs. Docker isolation:**

| | Sandbox (srt/Seatbelt/bubblewrap) | Docker |
|---|---|---|
| Scope | Per-command | Per-container |
| Level | OS-level syscall filtering | Namespace + cgroup isolation |
| Filesystem | Granular read/write rules | Mount-based (explicit `-v` binds) |
| Network | Domain-level allowlist | Container network (bridge/host/none) |
| Risk | Low — fine-grained | `docker run -v /:/host` = full host access |

**The nuclear option:** `docker run -v /:/host` mounts your entire filesystem into a container. If Claude runs this (and you approve it), it has full filesystem access regardless of any sandbox config. The permissions system is your defense here — deny `Bash(docker run -v /*)` patterns if you're concerned.

### `docker exec` Is Different

Commands run via `docker exec` inherit the container's isolation, not the host sandbox. The container's filesystem and network restrictions apply — the sandbox has no say.

## Setup

Add `"docker"` and `"docker-compose"` to `excludedCommands` in your `.claude/settings.json`. This lets Docker commands bypass the sandbox while keeping sandbox active for everything else.

## Run It

```bash
npm install && npm test
```

## What the Tests Check

| Test | What | Expected | Why |
|---|---|---|---|
| Sandbox enabled | Parse settings.json | `enabled: true` | Sandbox must be on for exclusions to matter |
| excludedCommands | Parse settings.json | Contains `"docker"` | Docker commands bypass the sandbox |
| allowUnsandboxedCommands | Parse settings.json | `false` | Non-excluded commands must stay sandboxed |
| Non-docker sandboxed | `srt "curl example.com"` | Blocked | Proves sandbox enforcement for non-excluded commands |
| Docker available | `docker --version` | Informational | Confirms Docker is installed (not a pass/fail) |

Note: We cannot test that Docker commands actually bypass the sandbox from within `srt`. The verify script focuses on config correctness and confirms sandbox enforcement still works for non-excluded commands.

## Break It on Purpose

Each experiment is a single edit to `.claude/settings.json`. Make the change, run `npm test`, observe which test flips, then **undo the edit** before moving on.

### Experiment A — Remove docker from excluded commands

```diff
- "excludedCommands": ["docker", "docker-compose"],
+ "excludedCommands": [],
```

Run `npm test`. **Test 2 flips to FAIL** — the config check catches the missing `docker` entry. Test 4 (curl blocked) still passes because removing exclusions makes the sandbox *more* restrictive, not less.

**Takeaway:** Without the exclusion, Docker commands would be sandboxed — and likely fail because Docker needs direct host access to the Docker socket.

### Experiment B — Open the escape hatch

```diff
- "allowUnsandboxedCommands": false,
+ "allowUnsandboxedCommands": true,
```

Run `npm test`. **Test 3 flips to FAIL** — the escape hatch is open. In a live session, this means *any* command can run unsandboxed, making `excludedCommands` pointless.

**Takeaway:** `excludedCommands` is a scalpel. `allowUnsandboxedCommands: true` is a sledgehammer. The whole point of this scenario is to use the scalpel.

### Experiment C — Exclude curl from the sandbox

```diff
- "excludedCommands": ["docker", "docker-compose"],
+ "excludedCommands": ["docker", "docker-compose", "curl"],
```

Run `npm test`. **Test 4 flips to FAIL** — `curl example.com` now succeeds because curl bypasses the sandbox entirely. Tests 1–3 still pass.

**Takeaway:** Every entry in `excludedCommands` is a hole in the sandbox. Excluding `curl` defeats network isolation. Be surgical — only exclude what truly needs host access.

## Gotchas

- **`excludedCommands` is a prefix match.** `"docker"` matches `docker`, `docker-compose`, `docker buildx`, etc. Be aware of what you're excluding.
- **Excluded commands still go through permissions.** They're not sandboxed, but Claude still needs permission approval (unless auto-allowed via `allowedTools`).
- **`docker run -v /:/host` is the nuclear option.** If Claude runs this, it has full filesystem access regardless of any sandbox config. The permissions system is your defense — deny `Bash(docker run -v /*)` if you're worried.
- **`docker exec` inherits the container's isolation, not the host sandbox.** Commands run inside a container are isolated by Docker, not by Claude's sandbox.
- **watchman (jest) has the same problem.** `excludedCommands: ["watchman"]` is a common companion. Or use `jest --no-watchman`.
- **Don't exclude too much.** Every excluded command is a hole in the sandbox. Be surgical.

## Next Steps

- **[Scenario 09 — Hardened Container](../09-hardened-container/):** Docker security best practices for the containers themselves.
- **[Scenario 10 — Combined Defense](../10-combined-defense/):** Layering sandbox + Docker + permissions for defense in depth.

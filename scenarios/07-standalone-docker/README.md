# Scenario 07 — Standalone Docker

Run Claude Code inside a plain Docker container with security defaults. No devcontainer, no IDE integration, no VS Code required. Just Docker.

## Quick Start

```bash
# Build the image
docker build -t claude-sandbox .
```

## Run Claude Code

```bash
docker run -it --rm \
  --cap-drop=ALL \                          # drop all Linux capabilities
  --security-opt=no-new-privileges \        # block setuid escalation
  --read-only \                             # root fs is immutable
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \ # writable scratch, no exec
  --tmpfs /home/claude/.npm:rw,size=128m \  # npm cache on read-only fs
  -e ANTHROPIC_API_KEY \                    # pass key from host env — never bake into image
  -v "$(pwd):/home/claude/project:rw" \     # mount project directory
  claude-sandbox
```

## Verify

```bash
docker run --rm \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --tmpfs /home/claude/.npm:rw,size=128m \
  -v "$(pwd):/home/claude/project:rw" \
  --entrypoint node \
  -w /home/claude/project \
  claude-sandbox verify.js
```

### Sample output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Test 1 — Running Inside a Container
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PASS — /.dockerenv exists — running inside a Docker container.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Passed: 7 / 7
  All checks passed. Container security controls are active.
```

The verify script checks six things:
1. Running inside a Docker container (/.dockerenv exists)
2. Non-root user (whoami returns `claude`)
3. All Linux capabilities dropped (CapEff is zero)
4. Root filesystem is read-only (write to /usr/local fails)
5. tmpfs is writable but noexec (write to /tmp works, execute from /tmp fails)
6. Project volume is mounted (project files are accessible)

## What You'll See

### Security Flags Explained

| Flag | What it does |
|---|---|
| `--cap-drop=ALL` | Drops all Linux capabilities. No mount, no chown, no raw sockets. |
| `--security-opt=no-new-privileges` | Blocks privilege escalation via setuid/setgid binaries. |
| `--read-only` | Mounts the root filesystem as read-only. System files cannot be modified. |
| `--tmpfs /tmp:rw,noexec,nosuid,size=256m` | Writable scratch space, but scripts cannot be executed from it. |
| `--tmpfs /home/claude/.npm:rw,size=128m` | Writable npm cache so npm operations work on a read-only filesystem. |
| `-v "$(pwd):/home/claude/project:rw"` | Mounts the host project directory. Bidirectional — Claude can read and write. |
| `-e ANTHROPIC_API_KEY` | Passes the API key from the host environment. Never bake keys into the image. |

### Dockerfile

The image is intentionally minimal:
- **Base:** `node:20-slim` — small footprint, includes Node.js for Claude Code.
- **System deps:** `curl` and `git` — the minimum Claude Code needs.
- **Claude Code:** Installed globally via npm.
- **User:** A dedicated `claude` user. The `USER` directive means all subsequent commands (and the entrypoint) run as this user, not root.

---

## Deep Dive

### Why It Matters

Devcontainers require VS Code or compatible tooling. That's fine for local development, but it doesn't help when you need Claude Code in a CI pipeline, on a remote server, or in automation. Standalone Docker works anywhere Docker runs.

The security flags are not just best practices — they are concrete defenses:
- **Dropped capabilities** prevent the container from performing privileged operations like mounting filesystems or using raw sockets.
- **Read-only root filesystem** prevents modification of system binaries, blocking backdoor installation.
- **noexec on tmpfs** blocks the classic "download and execute in /tmp" attack pattern.
- **Non-root user** limits blast radius if an attacker escapes the container.

## Break It on Purpose

Each experiment modifies the `docker run` flags. Make the change, run the verify command, observe which test flips, then **undo the edit** before moving on.

### Experiment A — Remove capability restrictions

```diff
  docker run --rm \
-   --cap-drop=ALL \
    --security-opt=no-new-privileges \
```

Run the verify command. **Test 3 flips to FAIL** — `CapEff` is no longer all zeros. The container now has default capabilities.

**Takeaway:** Docker grants ~14 capabilities by default. `--cap-drop=ALL` removes them all. Without it, processes can bind raw sockets, change ownership, and override DAC permissions.

### Experiment B — Remove read-only root filesystem

```diff
  docker run --rm \
    --cap-drop=ALL \
    --security-opt=no-new-privileges \
-   --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=256m \
```

Run the verify command. **Test 4 flips to FAIL** — writes to `/usr/local/` succeed. System binaries are now modifiable.

**Takeaway:** Without `--read-only`, an attacker can replace `node`, `git`, or any system binary with a trojaned version that persists for the container's lifetime.

### Experiment C — Run as root

Edit the Dockerfile:

```diff
- USER claude
+ # USER claude
```

Rebuild (`docker build -t claude-sandbox .`) and run the verify command. **Test 2 flips to FAIL** — `whoami` returns `root` instead of `claude`.

**Takeaway:** Root inside a container is less dangerous than root on the host, but it still enables capability use, file ownership changes, and some container escape techniques. Always run as a non-root user.

### Experiment D — Add the privileged flag

```diff
  docker run --rm \
-   --cap-drop=ALL \
-   --security-opt=no-new-privileges \
+   --privileged \
```

Run the verify command. **Tests 2, 3, 5, and 7 flip to FAIL** — the container has all capabilities, can escalate privileges, and effectively has host-level access.

**Takeaway:** `--privileged` is the nuclear option. It disables almost all container isolation. Never use it for untrusted workloads.

## Gotchas

- **Volume mount is bidirectional.** Claude can modify your project files. That's the point — it needs to write code. But be aware this is not a one-way mirror.
- **`--read-only` breaks npm install.** The `--tmpfs` for npm cache handles this in most cases. If you need to install additional packages, do it in the Dockerfile build stage.
- **No network isolation by default.** This scenario focuses on filesystem and process isolation. For network filtering, combine with scenario 03's sandbox network rules or add `--network=none` (but then Claude Code cannot reach the Anthropic API).
- **Git operations need `.gitconfig`.** If Claude needs to commit, mount your `.gitconfig` or set git config inside the container.
- **`--rm` means state is lost.** The container is ephemeral by design. Anything not on a volume mount disappears when the container exits. Persist what matters via volume mounts.
- **Extending this setup.** This scenario does not include network isolation or Docker Compose. For network filtering, combine with scenario 03. For multi-container setups, see scenario 09.

## Next Steps

- **[Scenario 08 — Docker AI Sandboxes](../08-docker-sandboxes/):** Run Claude Code inside a Docker AI Sandbox — a microVM managed by Docker Desktop that provides full environment isolation.
- **[Scenario 09 — Hardened Container](../09-hardened-container/):** Docker Compose with network policies, seccomp profiles, and AppArmor.

# Scenario 07 — Standalone Docker

Run Claude Code inside a plain Docker container with security defaults. No devcontainer, no IDE integration, no VS Code required. Just Docker.

## What This Does

A Dockerfile and run script that start Claude Code in an isolated container. The container runs as a non-root user with all Linux capabilities dropped, a read-only root filesystem, and restricted tmpfs. This is the same security posture you'd want in a CI pipeline, a remote server, or any headless environment.

## Why It Matters

Devcontainers require VS Code or compatible tooling. That's fine for local development, but it doesn't help when you need Claude Code in a CI pipeline, on a remote server, or in automation. Standalone Docker works anywhere Docker runs.

The security flags in `run.sh` are not just best practices — they are concrete defenses:
- **Dropped capabilities** prevent the container from performing privileged operations like mounting filesystems or using raw sockets.
- **Read-only root filesystem** prevents modification of system binaries, blocking backdoor installation.
- **noexec on tmpfs** blocks the classic "download and execute in /tmp" attack pattern.
- **Non-root user** limits blast radius if an attacker escapes the container.

## Quick Start

```bash
# Build the image
docker build -t claude-sandbox .

# Set your API key
export ANTHROPIC_API_KEY="your-key-here"

# Run Claude Code
./run.sh
```

## Setup

### Dockerfile

The image is intentionally minimal:
- **Base:** `node:20-slim` — small footprint, includes Node.js for Claude Code.
- **System deps:** `curl` and `git` — the minimum Claude Code needs.
- **Claude Code:** Installed globally via npm.
- **User:** A dedicated `claude` user. The `USER` directive means all subsequent commands (and the entrypoint) run as this user, not root.

### run.sh — Security Flags Explained

The run script is the documentation. Each flag has a purpose:

| Flag | What it does |
|---|---|
| `--cap-drop=ALL` | Drops all Linux capabilities. No mount, no chown, no raw sockets. |
| `--security-opt=no-new-privileges` | Blocks privilege escalation via setuid/setgid binaries. |
| `--read-only` | Mounts the root filesystem as read-only. System files cannot be modified. |
| `--tmpfs /tmp:rw,noexec,nosuid,size=256m` | Writable scratch space, but scripts cannot be executed from it. |
| `--tmpfs /home/claude/.npm:rw,size=128m` | Writable npm cache so npm operations work on a read-only filesystem. |
| `-v "$(pwd):/home/claude/project:rw"` | Mounts the host project directory. Bidirectional — Claude can read and write. |
| `-e ANTHROPIC_API_KEY` | Passes the API key from the host environment. Never bake keys into the image. |

### What's NOT in this scenario

- **No network isolation.** The container has full network access. For network filtering, combine with scenario 03's sandbox network rules or use `--network=none` (but Claude Code needs API access).
- **No Docker Compose.** This is a single container. Multi-container setups are a different scenario.
- **No devcontainer.json.** That's scenario 06. This is for users who want plain Docker.

## Verify It Works

Run the verification script inside the container:

```bash
docker run --rm \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --tmpfs /home/claude/.npm:rw,size=128m \
  -v "$(pwd):/home/claude/project:rw" \
  --entrypoint node \
  claude-sandbox verify.js
```

Or if you are already inside the container:

```bash
npm test
```

The script checks six things:
1. Running inside a Docker container (/.dockerenv exists)
2. Non-root user (whoami returns `claude`)
3. All Linux capabilities dropped (CapEff is zero)
4. Root filesystem is read-only (write to /usr/local fails)
5. tmpfs is writable but noexec (write to /tmp works, execute from /tmp fails)
6. Project volume is mounted (project files are accessible)

## Gotchas

- **API key handling.** `-e ANTHROPIC_API_KEY` passes from the host environment. Never bake keys into the image. Never use `--env-file` with a `.env` that gets committed.
- **Volume mount is bidirectional.** Claude can modify your project files. That's the point — it needs to write code. But be aware this is not a one-way mirror.
- **`--read-only` breaks npm install.** The `--tmpfs` for npm cache handles this in most cases. If you need to install additional packages, do it in the Dockerfile build stage.
- **No network isolation by default.** This scenario focuses on filesystem and process isolation. For network filtering, combine with scenario 03's sandbox network rules or add `--network=none` (but then Claude Code cannot reach the Anthropic API).
- **Git operations need `.gitconfig`.** If Claude needs to commit, mount your `.gitconfig` or set git config inside the container.
- **`--rm` means state is lost.** The container is ephemeral by design. Anything not on a volume mount disappears when the container exits. Persist what matters via volume mounts.

## Next Steps

- **[Scenario 08 — Docker Sandboxes](../08-docker-sandboxes/):** Use Docker as the sandbox runtime for Claude Code.
- **[Scenario 09 — Hardened Container](../09-hardened-container/):** Docker Compose with network policies, seccomp profiles, and AppArmor.

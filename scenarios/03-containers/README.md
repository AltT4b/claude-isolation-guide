# Scenario 03 — Containers

> A hardened Docker container replaces bubblewrap as the OS-level enforcement mechanism. It catches anything that escapes permissions and sandbox rules — even if Claude's app logic is entirely bypassed.

## What You'll Learn

- Why containers are an alternative to bwrap, not an addition
- The five Docker security controls that matter
- How to verify each control is active
- Devcontainer equivalent for VS Code / Codespaces

## Why Containers?

On the host, bubblewrap (bwrap) enforces sandbox restrictions at the OS level. Inside a hardened container, bwrap can't run — `--cap-drop=ALL` and `--security-opt=no-new-privileges` block the unprivileged namespace creation it needs. That's fine: the container itself provides the same enforcement boundary.

The key insight: bwrap and containers are **alternative mechanisms for the same layer** — execution isolation. You don't need both. Inside a container, the container *is* the enforcement.

## The Five Controls

| Control | Docker flag | What it prevents |
|---------|------------|-----------------|
| Drop capabilities | `cap_drop: [ALL]` | No raw sockets, no mount, no kernel tricks |
| No privilege escalation | `security_opt: [no-new-privileges:true]` | setuid binaries can't escalate to root |
| Read-only root | `read_only: true` | No persistent backdoors or config tampering |
| Non-root user | `user: "1001:1001"` | Container escape gives attacker limited user, not root |
| Resource limits | `deploy.resources.limits` | No OOM-killing the host or starving other containers |

## Configuration

### docker-compose.yml

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

    # Prevent resource exhaustion on the host
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 4G
        reservations:
          memory: 1G

    networks:
      - isolated

    working_dir: /home/claude/project

networks:
  isolated:
    driver: bridge
```

### Dockerfile

```dockerfile
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 claude && \
    useradd --uid 1001 --gid claude --shell /bin/bash --create-home claude

WORKDIR /home/claude/project

COPY package.json ./
RUN npm install --ignore-scripts

COPY verify.js ./

RUN chown -R claude:claude /home/claude/project

USER claude

CMD ["npm", "test"]
```

## Run It

```bash
docker compose build
docker compose run --rm sandbox
```

## What You'll See

5 tests, each proving one security control.

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
    "--tmpfs=/tmp:rw,noexec,nosuid"
  ]
}
```

Same security controls, different format. The devcontainer spec doesn't support `deploy.resources` directly — use `--memory=4g` and `--cpus=2` in runArgs instead.

## Break It on Purpose

A. Remove `cap_drop: [ALL]` → Test 3 fails (capabilities present)
B. Remove `read_only: true` → Test 4 fails (write succeeds)
C. Remove `deploy.resources` → Test 5 fails (no memory limit)
D. Remove `user: "1001:1001"` → Test 2 fails (running as root)

## Key Takeaway

A hardened container provides mandatory enforcement — it works even if every voluntary control (permissions, sandbox rules) is bypassed. Five controls, five tests, one enforcement boundary.

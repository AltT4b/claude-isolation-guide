# Claude Code Isolation Guide

Hands-on guide to Claude Code's isolation layers — permissions, sandboxing, and containers. Every concept is backed by a runnable scenario you can try, break, and restore yourself.

**Pick your starting point:**

- **New to isolation?** Start with [Scenario 01](scenarios/01-permissions/) — deny rules are the simplest control and the foundation for everything else.
- **Already using permissions?** Jump to [Scenario 02](scenarios/02-sandbox/) for OS-level filesystem and network controls.
- **Running in Docker?** [Scenario 03](scenarios/03-containers/) hardens the container. [Scenario 04](scenarios/04-container-with-sandbox/) combines all three layers.

## Reference Docs

- **[Permissions Guide](docs/permissions-guide.md)** — All `permissions.*` properties: allow/deny rules, tool targeting, settings file precedence.
- **[Sandbox Guide](docs/sandbox-guide.md)** — All `sandbox.*` properties: OS-level filesystem and network isolation for Bash commands.

## Dependencies

| Dependency | Required for | macOS | Linux/WSL2 |
|-----------|-------------|-------|------------|
| [Node.js](https://nodejs.org/) | All scenarios | `brew install node` | [nodesource setup](https://deb.nodesource.com/setup_lts.x) |
| [Docker](https://docs.docker.com/get-docker/) | Scenarios 03, 04 | `brew install --cask docker` | `sudo apt-get install -y docker.io` |
| [bubblewrap](https://github.com/containers/bubblewrap) | Scenario 02 | Not needed (Seatbelt built-in) | `sudo apt-get install -y bubblewrap` |

## Scenarios

Each scenario is a self-contained experiment under [scenarios/](scenarios/). Every test follows the same rhythm: **try it** → **break it** → **restore it**.

| # | Scenario | Isolation layer |
|---|----------|-----------------|
| 01 | [Permissions](scenarios/01-permissions/) | Tool-level deny/allow rules — controls what Claude's built-in tools (Read, Edit, WebFetch, etc.) can access |
| 02 | [Sandbox](scenarios/02-sandbox/) | OS-level filesystem and network restrictions on Bash commands |
| 03 | [Containers](scenarios/03-containers/) | Docker hardening — isolation at the container boundary |
| 04 | [Container with Sandbox](scenarios/04-container-with-sandbox/) | Multiple layers combined — defense-in-depth |

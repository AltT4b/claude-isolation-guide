# Claude Code Isolation Guide

A living handbook for understanding and applying a few Claude Code isolation mechanisms — permissions, sandboxing, and containers. 

Every concept is backed by a runnable scenario you can verify yourself.

## What This Is

Hands-on experience with how Claude Code's isolation controls work. 

The goal: 
 - provide a reference guide along with some proof the concepts work
 - runs real examples, the tests aren't just vaporware
 - provide an understandable lever to break each test case reliably

## Documentation

The [docs/](docs/) directory contains the reference material:

- **[docs/permissions-guide.md](docs/permissions-guide.md)** — Deep dive into `permissions.*` properties: allow/deny rules, tool targeting, settings file precedence.
- **[docs/sandbox-guide.md](docs/sandbox-guide.md)** — Deep dive into `sandbox.*` properties: OS-level filesystem and network isolation for bash commands.

## Dependencies

### [Node.js](https://nodejs.org/)

```bash
# macOS
brew install node

# Linux/WSL2
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### [Docker](https://docs.docker.com/get-docker/)

Required for scenarios 03 and 04.

```bash
# macOS
brew install --cask docker

# Linux/WSL2
sudo apt-get install -y docker.io
```

### [bubblewrap](https://github.com/containers/bubblewrap)

Linux/WSL2 only, for scenario 02. macOS uses Seatbelt (built-in).

```bash
sudo apt-get install -y bubblewrap
```

## Scenarios

Each scenario lives in its own directory under [scenarios/](scenarios/). Each one is a self-contained experiment that demonstrates a Claude Code isolation technique.

| # | Scenario | Isolation layer |
|---|----------|-----------------|
| 01 | [Permissions](scenarios/01-permissions/) | Tool-level deny/allow rules — controls what Claude's built-in tools (Read, Edit, WebFetch, etc.) can access |
| 02 | [Sandbox](scenarios/02-sandbox/) | OS-level filesystem and network restrictions on Bash commands |
| 03 | [Containers](scenarios/03-containers/) | Docker hardening — isolation at the container boundary |
| 04 | [Container with Sandbox](scenarios/04-container-with-sandbox/) | Multiple layers combined — defense-in-depth |

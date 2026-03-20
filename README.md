# Claude Code Isolation Guide

Testable scenarios for the controls that keep [Claude Code](https://docs.anthropic.com/en/docs/claude-code) isolated. Each scenario has a `verify.js` you can run to prove the controls are working — and break on purpose to prove they're not passing trivially.

## Scenarios

| Scenario | What it tests | Run with |
|----------|--------------|----------|
| **[01 — Permissions](scenarios/01-permissions/)** | `permissions.deny` rules that block Claude's built-in tools (Read, Edit, WebFetch, etc.) | `npm test` |
| **[02 — Sandbox](scenarios/02-sandbox/)** | `sandbox.*` settings that control what Bash can touch on disk and reach on the network | `npm test` |
| **[03 — Containers](scenarios/03-containers/)** | Docker hardening flags that enforce isolation at the container level | `docker compose run --rm sandbox` |
| **[04 — All Layers](scenarios/04-all-layers/)** | All 3 layers (permissions + sandbox + container) working together — defense-in-depth | `docker compose run --rm sandbox` |

**Start here:** If you're locking down a project, start with [01 — Permissions](scenarios/01-permissions/) (tool-level controls) and [02 — Sandbox](scenarios/02-sandbox/) (Bash-level controls). If you're running Claude inside Docker, go straight to [03 — Containers](scenarios/03-containers/). To see all layers working together, try [04 — All Layers](scenarios/04-all-layers/).

## Requirements

- **Node.js >= 18** — all scenarios
- **Docker** — scenarios 03 and 04
- **bubblewrap** — Linux/WSL2 only, for scenario 02 (`sudo apt-get install bubblewrap`). macOS uses Seatbelt (built-in).

See each scenario's README for specific prerequisites.

# Claude Code Isolation Guide

A hands-on guide to the controls and enforcement mechanisms that keep [Claude Code](https://docs.anthropic.com/en/docs/claude-code) isolated. Each scenario is self-contained. No API key required.

## How Isolation Works

Claude Code isolates itself using `settings.json` controls and an execution environment. Which enforcement mechanism is active depends on where Claude is running.

**`settings.json` controls** — always active, everywhere:

| Control | What it restricts | How |
|---------|------------------|-----|
| **Permissions** | Claude's built-in tools (Read, Edit, Write, WebFetch) | `permissions.deny` blocks tool invocations; `permissions.allow` pre-approves them |
| **Sandbox rules** | Bash commands — filesystem and network access | `sandbox.*` configures what files Bash can touch and what domains it can reach |

**Execution environment** — one or the other, not both:

| Environment | What it enforces | How |
|-------------|-----------------|-----|
| **Host** | Sandbox rules via OS-level wrapping | [srt](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) wraps every Bash command in [bubblewrap](https://github.com/containers/bubblewrap) (Linux) or [Seatbelt](https://reverse.put.as/wp-content/uploads/2011/09/Apple-Sandbox-Guide-v1.0.pdf) (macOS) |
| **Container** | Environment-level isolation | Docker security flags: non-root user, dropped capabilities, read-only filesystem, resource limits |

Inside a hardened container, bubblewrap can't run (`--cap-drop=ALL` blocks namespace creation). The container itself provides the enforcement boundary instead.

For full sandbox documentation, see [Claude Code: Sandbox mode](https://docs.anthropic.com/en/docs/claude-code/security#sandbox-mode). See [`settings.json` Reference](docs/settings-reference.md) for full property docs.

## Requirements

| Dependency | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org/) | >= 18 | Runtime |
| [npm](https://www.npmjs.com/) | Included with Node.js | Package manager |
| [bubblewrap](https://github.com/containers/bubblewrap) | Latest (Linux/WSL2 only) | Linux sandbox backend |
| [@anthropic-ai/sandbox-runtime](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) | Installed per-scenario via `npm install` | OS-level sandbox runtime |
| [Docker](https://docs.docker.com/get-docker/) | Latest | Container scenario (03) |

macOS needs nothing beyond Node.js — Seatbelt is built in. WSL1 and native Windows are not supported.

## Scenarios

**[01 — Permissions](scenarios/01-permissions/)** — The sandbox only covers Bash. Claude's built-in tools (Read, Edit, WebFetch) bypass it entirely. `permissions.deny` closes that gap.

**[02 — Sandbox](scenarios/02-sandbox/)** — Every sandbox setting end-to-end: filesystem controls, network allowlists, escape hatches. Deny always beats allow.

**[03 — Containers](scenarios/03-containers/)** — Docker hardening as the execution environment. Five controls, five tests. Includes devcontainer equivalent.

## Quick-start `settings.json`

A minimal recommended starting point. See the [full `settings.json` reference](docs/settings-reference.md) for every property.

```jsonc
// .claude/settings.json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "filesystem": {
      "allowWrite": ["."],
      "denyRead": [".env*"]
    },
    "network": {
      "allowedDomains": ["api.anthropic.com"]
    }
  },
  "permissions": {
    "deny": [
      "Read(.env*)",
      "Edit(.claude/settings*)",
      "Write(.claude/settings*)",
      "WebFetch(*)"
    ]
  }
}
```

> **Tip:** `permissions.allow` and `permissions.deny` can also be placed in `.claude/settings.local.json` (gitignored) for user-specific overrides. See [Scenario 01](scenarios/01-permissions/) for this pattern.

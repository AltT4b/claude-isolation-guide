# Claude Code Sandbox Testing

Docs say the sandbox works. These scenarios let you *see* it.

A hands-on guide to [Claude Code's](https://docs.anthropic.com/en/docs/claude-code) sandbox — the OS-level isolation layer that restricts what Bash commands can touch. Each scenario is self-contained. No API key required.

## Why this exists

The sandbox enforces restrictions at the kernel level — [Seatbelt](https://reverse.put.as/wp-content/uploads/2011/09/Apple-Sandbox-Guide-v1.0.pdf) on macOS, [bubblewrap](https://github.com/containers/bubblewrap) on Linux — so even a command you accidentally approve can't read your SSH keys or phone home.

For full sandbox documentation, see [Claude Code: Sandbox mode](https://docs.anthropic.com/en/docs/claude-code/security#sandbox-mode). See [`settings.json` Reference](docs/settings-reference.md) for full property docs.

## Requirements

Each scenario runs commands through [`srt`](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) (sandbox runtime) — the same runtime Claude Code uses internally. You need:

| Dependency | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org/) | >= 18 | Runtime |
| [npm](https://www.npmjs.com/) | Included with Node.js | Package manager |
| [bubblewrap](https://github.com/containers/bubblewrap) | Latest (Linux/WSL2 only) | Linux sandbox backend |
| [@anthropic-ai/sandbox-runtime](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) | Installed per-scenario via `npm install` | OS-level sandbox runtime |

macOS needs nothing beyond Node.js — Seatbelt is built in. WSL1 and native Windows are not supported.

## Scenarios

### Start here

These three scenarios cover the sandbox fundamentals: what gets blocked, what's allowed, and how the rules compose.

**[01 — Native Sandbox Basics](scenarios/01-native-sandbox-basics/)** — The simplest proof: watch the sandbox block writes and network while leaving normal ops untouched.

**[02 — Filesystem Controls](scenarios/02-filesystem-controls/)** — Fine-grained read/write control, including why deny beats allow when both match.

**[03 — Network Isolation](scenarios/03-network-isolation/)** — Domain allowlists for Bash, plus why DNS resolution and HTTP access are different things.

### Harden your setup

Layer permissions and environment config on top of the sandbox.

**[04 — Permissions Hardening](scenarios/04-permissions-hardening/)** — The sandbox only covers Bash. Read, Edit, and WebFetch operate outside it — `permissions.deny` closes those gaps.

**[05 — Environment Persistence](scenarios/05-env-persistence/)** — `CLAUDE_ENV_FILE` lets env vars survive across Bash invocations — but source a completion script in it and every command silently dies.

### Container isolation

When you need more than process-level sandboxing: filesystem, network namespace, and process tree boundaries.

**[06 — Devcontainer Reference](scenarios/06-devcontainer-reference/)** — Container-level isolation with its own filesystem, network namespace, and process tree.

**[07 — Standalone Docker](scenarios/07-standalone-docker/)** — Claude Code in a plain Docker container with `--cap-drop=ALL`, `--read-only`, `--security-opt=no-new-privileges`, and `noexec` tmpfs.

**[08 — Docker AI Sandboxes](scenarios/08-docker-sandboxes/)** — Zero-config isolation via Docker Desktop's AI Sandbox — a microVM with full environment separation.

**[09 — Hardened Container](scenarios/09-hardened-container/)** — Every reasonable Docker security control in one reference: dropped capabilities, no-new-privileges, read-only root, noexec tmpfs, resource limits, non-root user, isolated bridge network.

### Putting it together

**[10 — Combined Defense](scenarios/10-combined-defense/)** — A recommended default config layering permissions + sandbox + container for defense in depth. Documented knobs to loosen.

**[11 — Excluded Commands](scenarios/11-excluded-commands/)** — Prefix-match carve-outs that let specific commands bypass the sandbox while everything else stays locked.

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
  }
}
```

> **Note:** `permissions.allow` and `permissions.deny` can also be placed in `.claude/settings.local.json` (gitignored) for user-specific overrides. See [Scenario 04](scenarios/04-permissions-hardening/) for this pattern.

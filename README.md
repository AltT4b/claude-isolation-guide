# Claude Code Sandbox Testing

A practical guide to building confidence in [Claude Code's](https://docs.anthropic.com/en/docs/claude-code) sandbox — the OS-level isolation layer that restricts what Bash commands can do with your filesystem and network. Each scenario is a self-contained test you can run to verify sandbox behavior yourself, no API key required.

## Why this exists

Claude Code's sandbox is the last line of defense between an approved Bash command and your system. It enforces restrictions at the kernel level — [Seatbelt](https://reverse.put.as/wp-content/uploads/2011/09/Apple-Sandbox-Guide-v1.0.pdf) on macOS, [bubblewrap](https://github.com/containers/bubblewrap) on Linux — so even a command you accidentally approve can't read your SSH keys or phone home to an attacker's server.

Reading docs tells you it works. Running these scenarios lets you *see* it work.

For full sandbox documentation, see [Claude Code: Sandbox mode](https://docs.anthropic.com/en/docs/claude-code/security#sandbox-mode).

## Requirements

Each scenario runs commands through [`srt`](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) (sandbox runtime) — the same runtime Claude Code uses internally. You need:

| Dependency | Version | Docs |
|---|---|---|
| [Node.js](https://nodejs.org/) | >= 18 | [Download](https://nodejs.org/en/download) |
| [npm](https://www.npmjs.com/) | Included with Node.js | [Docs](https://docs.npmjs.com/) |
| [bubblewrap](https://github.com/containers/bubblewrap) | Latest (Linux/WSL2 only) | `sudo apt-get install bubblewrap` |

macOS needs nothing beyond Node.js — Seatbelt is built in. WSL1 and native Windows are not supported.

The key dependency installed per-scenario via `npm install`:

| Package | Purpose | Docs |
|---|---|---|
| [@anthropic-ai/sandbox-runtime](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) | Runs commands under the same OS-level sandbox as Claude Code | [npm](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) |

## Running a scenario

```bash
cd scenarios/<scenario-dir>
npm install
npm test
```

Each scenario reads its sandbox config from `.claude/settings.json`, transforms it for `srt`, and runs a series of commands that should either succeed or be blocked. Output is color-coded pass/fail.

## Scenarios

### 01 — [Native Sandbox Basics](scenarios/01-native-sandbox-basics/)

Proves the sandbox is active with the simplest possible config. Three tests:

- **Write outside cwd** — `touch /tmp/...` is denied. The sandbox restricts filesystem writes to the project directory.
- **Outbound network** — `curl https://example.com` is denied. Only explicitly allowed domains can be reached.
- **Normal operations** — write/read/delete within cwd succeeds. The sandbox isn't breaking legitimate work.

### 02 — [Filesystem Controls](scenarios/02-filesystem-controls/)

Demonstrates fine-grained filesystem rules and how they interact. Six tests:

- **`denyRead`** — `cat .env.example` is denied. Sensitive file patterns can be blocked from Bash reads.
- **`allowWrite`** — `touch test-file` in cwd succeeds. Writes are scoped to explicitly allowed paths.
- **`denyWrite` overrides `allowWrite`** — `touch secrets/test` is denied even though cwd is writable. Deny rules win.
- **Write outside cwd** — `touch /tmp/test` is denied. Paths not in `allowWrite` are blocked.
- **Normal reads** — `cat README.md` succeeds. Only patterns in `denyRead` are restricted.
- **SSH key protection** — `cat ~/.ssh/id_rsa` is denied. The sandbox blocks sensitive system paths by default.

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
- **SSH key protection** — `cat ~/.ssh/id_rsa` is denied. The `denyRead` config blocks access to `~/.ssh`.

### 03 — [Network Isolation](scenarios/03-network-isolation/)

Controls outbound network access from Bash commands using domain allowlists. Covers the two enforcement layers (sandbox for Bash vs. Claude's built-in tools like WebFetch/WebSearch) and why they are independent. Five tests:

- **Allowed domain** — `curl httpbin.org/get` succeeds. The domain is in `allowedDomains`.
- **Blocked domain** — `curl example.com` is denied. Not in the allowlist.
- **Another blocked domain** — `curl icanhazip.com` is denied. Confirms the allowlist is not a denylist.
- **Localhost access** — `curl localhost:9999` is denied. Localhost is not special — it needs to be allowlisted.
- **DNS resolution** — `nslookup example.com` may resolve even when HTTP is blocked. DNS happens outside the sandbox proxy.

### 04 — [Permissions Hardening](scenarios/04-permissions-hardening/)

Closes the gaps between sandbox and Claude's built-in tools. The sandbox only covers Bash — the Read tool, Edit tool, and WebFetch operate outside it. This scenario adds `permissions.deny` rules to block those tools from accessing secrets, settings, and arbitrary URLs. Tests validate:

- **Sandbox blocks `cat .env.example`** — Bash-level `denyRead` enforcement.
- **Sandbox blocks outbound network** — Bash-level network filter.
- **Normal file operations succeed** — writes within cwd still work.
- **`permissions.deny` rules present** — settings.json contains Read, Edit, Write, and WebFetch deny rules.
- **`permissions.allow` rules present** — settings.local.json pre-approves npm, node, and git commands.

### 05 — [Environment Persistence](scenarios/05-env-persistence/)

Demonstrates `CLAUDE_ENV_FILE` — a shell script sourced before every Bash tool invocation so environment variables (PATH, NVM_DIR, etc.) persist across commands. Covers the critical "completion script trap" where sourcing bash completions in the env file causes silent failure on all commands. Tests validate:

- **Good env file sources without errors** — the correct env file is valid shell.
- **Env file sets variables** — `PROJECT_ENV` is available after sourcing.
- **Bad env file detected** — the bad example containing completion scripts is flagged.
- **Login shell picks up env** — `bash -l -c` sources the env file correctly.
- **Env file structure** — the file exists with expected content.

### 06 — [Devcontainer Reference](scenarios/06-devcontainer-reference/)

A `.devcontainer/devcontainer.json` + Dockerfile defining an isolated development environment. The container provides its own filesystem, network namespace, and process tree — isolation beyond the native sandbox. Tests validate:

- **Container detection** — `/.dockerenv` or cgroup indicators confirm container environment.
- **Non-root user** — `whoami` returns a non-root user.
- **Dropped capabilities** — `CapEff` in `/proc/1/status` is minimal.
- **Read-only filesystem** — writes to `/opt` fail.
- **Network restrictions** — `curl https://example.com` fails (when firewall is active).

### 07 — [Standalone Docker](scenarios/07-standalone-docker/)

Run Claude Code inside a plain Docker container with security defaults — no devcontainer, no IDE integration. A Dockerfile and run script that apply `--cap-drop=ALL`, `--read-only`, `--security-opt=no-new-privileges`, and `noexec` tmpfs. Six checks:

- **Running inside Docker** — `/.dockerenv` exists.
- **Non-root user** — `whoami` returns `claude`.
- **All capabilities dropped** — `CapEff` is zero.
- **Read-only root filesystem** — writes to `/usr/local` fail.
- **tmpfs is writable but noexec** — write to `/tmp` works, execute from `/tmp` fails.
- **Project volume mounted** — project files are accessible.

### 08 — [Docker Sandboxes](scenarios/08-docker-sandboxes/)

Explains the interaction between Claude Code's native sandbox and Docker: why Docker commands fail in the sandbox, how `excludedCommands` works as a prefix-match carve-out, and the tradeoffs of running both together. Tests validate:

- **Sandbox enabled** — `enabled: true` in settings.json.
- **`excludedCommands` configured** — `docker` is in the exclusion list.
- **`allowUnsandboxedCommands` is false** — non-excluded commands stay sandboxed.
- **Non-docker commands sandboxed** — `curl example.com` is still blocked by the sandbox.
- **Docker available** — `docker --version` confirms Docker is installed.

### 09 — [Hardened Container](scenarios/09-hardened-container/)

The fully hardened Docker reference: `Dockerfile` + `docker-compose.yml` with every reasonable Docker security control applied — dropped capabilities, no-new-privileges, read-only root filesystem, noexec tmpfs, resource limits (CPU/memory), non-root user, and isolated bridge network. Seven checks:

- **Running inside container** — container environment detected.
- **Non-root user** — uid 1001.
- **All capabilities dropped** — `CapEff` is all zeros.
- **Read-only root filesystem** — writes to `/usr/local/` return EROFS or EACCES.
- **tmpfs noexec** — executing scripts from `/tmp` is denied.
- **Resource limits** — cgroup memory limit is approximately 4GB.
- **No privilege escalation** — `NoNewPrivs` flag is set.

### 10 — [Combined Defense](scenarios/10-combined-defense/)

The capstone: one recommended configuration layering permissions + sandbox + container for defense in depth. Not a buffet — a sane default with documented knobs to loosen. Tests run in two phases:

- **Config validation (tests 1-4)** — parses settings.json and confirms all expected rules are present across permissions, sandbox filesystem, sandbox network, and excluded commands.
- **Sandbox enforcement (tests 5-8)** — runs commands through srt and confirms they are blocked or allowed as expected.

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

## `settings.json` Reference

Each scenario includes a `.claude/settings.json` that configures Claude Code's sandbox and permissions. Here's what every property does:

### `sandbox`

#### `enabled` — `boolean` (default: `true`)

Activates OS-level sandboxing (Seatbelt on macOS, bubblewrap on Linux) for all Bash commands. When `false`, commands run unrestricted.

```jsonc
"enabled": true
```

See it in action: [Scenario 01 — Native Sandbox Basics](scenarios/01-native-sandbox-basics/) proves the sandbox is active by showing writes outside cwd and outbound network are denied.

#### `allowUnsandboxedCommands` — `boolean` (default: `false`)

When `true`, commands not matched by `excludedCommands` can still run outside the sandbox. When `false` (recommended), only excluded commands bypass the sandbox — everything else is sandboxed.

```jsonc
"allowUnsandboxedCommands": false
```

See it in action: [Scenario 08 — Docker Sandboxes](scenarios/08-docker-sandboxes/) tests that this is `false` so non-docker commands like `curl` stay sandboxed even though `docker` is excluded.

#### `excludedCommands` — `string[]` (default: `[]`)

Command prefixes that bypass the sandbox entirely. Uses prefix matching — `"docker"` matches `docker build`, `docker run`, etc. Use sparingly: excluded commands have full system access.

```jsonc
"excludedCommands": ["docker", "docker-compose"]
```

See it in action: [Scenario 08 — Docker Sandboxes](scenarios/08-docker-sandboxes/) carves out Docker commands so they can access the Docker daemon, which requires host-level networking the sandbox would block.

### `sandbox.filesystem`

Controls what the sandboxed Bash process can read and write. Deny rules always override allow rules.

#### `allowRead` — `string[]` (default: `[]`)

Additional paths/globs the sandbox can read beyond the project directory. The project directory is readable by default.

```jsonc
"allowRead": ["/usr/share/dict"]
```

See it in action: [Scenario 01 — Native Sandbox Basics](scenarios/01-native-sandbox-basics/) leaves this empty — the default project-directory read access is sufficient for most workflows.

#### `denyRead` — `string[]` (default: `[]`)

Paths/globs the sandbox is blocked from reading, even within the project directory. Supports globs (`.env*`) and home-relative paths (`~/.ssh`).

```jsonc
"denyRead": [".env*", "~/.ssh"]
```

See it in action: [Scenario 02 — Filesystem Controls](scenarios/02-filesystem-controls/) blocks `cat .env.example` and `cat ~/.ssh/id_rsa` using these patterns.

#### `allowWrite` — `string[]` (default: `["."]`)

Paths/globs the sandbox can write to. `"."` means the project directory. Paths outside this list are blocked.

```jsonc
"allowWrite": ["."]
```

See it in action: [Scenario 01 — Native Sandbox Basics](scenarios/01-native-sandbox-basics/) allows writes within cwd while [Scenario 02](scenarios/02-filesystem-controls/) demonstrates that `touch /tmp/test` fails because `/tmp` is not in the list.

#### `denyWrite` — `string[]` (default: `[]`)

Paths/globs the sandbox is blocked from writing, even if they fall inside an `allowWrite` path. Deny wins over allow.

```jsonc
"denyWrite": ["secrets/", ".claude/", ".git/hooks/"]
```

See it in action: [Scenario 02 — Filesystem Controls](scenarios/02-filesystem-controls/) denies writes to `secrets/` even though cwd is writable. [Scenario 10 — Combined Defense](scenarios/10-combined-defense/) extends this to protect `.claude/` and `.git/hooks/`.

### `sandbox.network`

Controls outbound network access from Bash commands. This only affects commands run through the sandbox — Claude's built-in tools (WebFetch, WebSearch) are controlled separately via `permissions`.

#### `allowedDomains` — `string[]` (default: `[]`)

Domains Bash commands can reach. If empty, all outbound network is blocked. `api.anthropic.com` is typically included for Claude to function.

```jsonc
"allowedDomains": ["api.anthropic.com", "registry.npmjs.org"]
```

See it in action: [Scenario 03 — Network Isolation](scenarios/03-network-isolation/) allows `httpbin.org` and proves `curl example.com` is denied because it's not in the list.

#### `deniedDomains` — `string[]` (default: `[]`)

Domains explicitly blocked even if they would otherwise be allowed. Takes precedence over `allowedDomains`.

```jsonc
"deniedDomains": ["evil.com"]
```

No scenario currently uses `deniedDomains` — the allowlist-only approach in [Scenario 03](scenarios/03-network-isolation/) is the recommended pattern. This property exists for cases where you need a broad allowlist with specific exceptions.

### `permissions`

Controls Claude's built-in tools (Read, Edit, Write, WebFetch, etc.) — the layer *above* the sandbox. The sandbox only governs Bash; permissions govern everything else.

#### `allow` — `string[]` (default: `[]`)

Tool invocations that are pre-approved without prompting. Format: `Tool(pattern)` — e.g., `Bash(npm *)` auto-approves any npm command. Patterns use glob matching.

```jsonc
"allow": ["Bash(npm *)", "Bash(node *)", "Bash(git *)"]
```

See it in action: [Scenario 04 — Permissions Hardening](scenarios/04-permissions-hardening/) uses `settings.local.json` to pre-approve common dev commands. [Scenario 10 — Combined Defense](scenarios/10-combined-defense/) bakes these into the shared config.

#### `deny` — `string[]` (default: `[]`)

Tool invocations that are always blocked. Format: `Tool(pattern)` — e.g., `Read(.env*)` prevents Claude from reading any `.env` file. Deny rules cannot be overridden by allow rules.

```jsonc
"deny": ["Read(.env*)", "Read(*.pem)", "Edit(.claude/settings*)", "WebFetch(*)"]
```

See it in action: [Scenario 04 — Permissions Hardening](scenarios/04-permissions-hardening/) closes the gap between sandbox and Claude's built-in tools — without these rules, the Read tool could bypass `denyRead`. [Scenario 10](scenarios/10-combined-defense/) adds `*.pem` and `*.key` patterns.

> **Note:** `permissions.allow` and `permissions.deny` can also be placed in `.claude/settings.local.json` (gitignored) for user-specific overrides. See [Scenario 04](scenarios/04-permissions-hardening/) for this pattern.

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

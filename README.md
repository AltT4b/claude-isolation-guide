# Claude Code Sandbox Testing

Reading docs tells you it works. Running these scenarios lets you *see* it work.

A practical guide to building confidence in [Claude Code's](https://docs.anthropic.com/en/docs/claude-code) sandbox — the OS-level isolation layer that restricts what Bash commands can do with your filesystem and network. Each scenario is a self-contained test you can run to verify sandbox behavior yourself, no API key required.

## Why this exists

Claude Code's sandbox is the last line of defense between an approved Bash command and your system. It enforces restrictions at the kernel level — [Seatbelt](https://reverse.put.as/wp-content/uploads/2011/09/Apple-Sandbox-Guide-v1.0.pdf) on macOS, [bubblewrap](https://github.com/containers/bubblewrap) on Linux — so even a command you accidentally approve can't read your SSH keys or phone home to an attacker's server.

For full sandbox documentation, see [Claude Code: Sandbox mode](https://docs.anthropic.com/en/docs/claude-code/security#sandbox-mode). See [settings.json Reference](#settingsjson-reference) for full property docs.

## Requirements

Each scenario runs commands through [`srt`](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) (sandbox runtime) — the same runtime Claude Code uses internally. You need:

| Dependency | Version | Purpose | Docs |
|---|---|---|---|
| [Node.js](https://nodejs.org/) | >= 18 | Runtime | [Download](https://nodejs.org/en/download) |
| [npm](https://www.npmjs.com/) | Included with Node.js | Package manager | [Docs](https://docs.npmjs.com/) |
| [bubblewrap](https://github.com/containers/bubblewrap) | Latest (Linux/WSL2 only) | Linux sandbox backend | `sudo apt-get install bubblewrap` |
| [@anthropic-ai/sandbox-runtime](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) | Installed per-scenario via `npm install` | Runs commands under the same OS-level sandbox as Claude Code | [npm](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) |

macOS needs nothing beyond Node.js — Seatbelt is built in. WSL1 and native Windows are not supported.

## Scenarios

### 01 — [Native Sandbox Basics](scenarios/01-native-sandbox-basics/)

The simplest proof: watch the sandbox block writes and network while leaving normal ops untouched. Three tests:

- **Write outside cwd** — `touch /tmp/...` is denied. The sandbox restricts filesystem writes to the project directory.
- **Outbound network** — `curl https://example.com` is denied. Only explicitly allowed domains can be reached.
- **Normal operations** — write/read/delete within cwd succeeds. The sandbox isn't breaking legitimate work.

### 02 — [Filesystem Controls](scenarios/02-filesystem-controls/)

Fine-grained read/write control — including why deny beats allow when both match. Six tests:

- **`denyRead`** — `cat .env.example` is denied. Sensitive file patterns can be blocked from Bash reads.
- **`allowWrite`** — `touch test-file` in cwd succeeds. Writes are scoped to explicitly allowed paths.
- **`denyWrite` overrides `allowWrite`** — `touch secrets/test` is denied even though cwd is writable. Deny rules win.
- **Write outside cwd** — `touch /tmp/test` is denied. Paths not in `allowWrite` are blocked.
- **Normal reads** — `cat README.md` succeeds. Only patterns in `denyRead` are restricted.
- **SSH key protection** — `cat ~/.ssh/id_rsa` is denied. The `denyRead` config blocks access to `~/.ssh`.

### 03 — [Network Isolation](scenarios/03-network-isolation/)

Domain allowlists for Bash, but Claude's own tools play by different rules. Five tests show the gap:

- **Allowed domain** — `curl httpbin.org/get` succeeds. The domain is in `allowedDomains`.
- **Blocked domain** — `curl example.com` is denied. Not in the allowlist.
- **Another blocked domain** — `curl icanhazip.com` is denied. Confirms the allowlist is not a denylist.
- **Localhost access** — `curl localhost:9999` is denied. Localhost is not special — it needs to be allowlisted.
- **DNS resolution** — `nslookup example.com` may resolve even when HTTP is blocked. DNS happens outside the sandbox proxy.

### 04 — [Permissions Hardening](scenarios/04-permissions-hardening/)

The sandbox only covers Bash. Read, Edit, and WebFetch operate outside it — so you need a second layer. This scenario adds `permissions.deny` rules to close those gaps. Tests validate:

- **Sandbox blocks `cat .env.example`** — Bash-level `denyRead` enforcement.
- **Sandbox blocks outbound network** — Bash-level network filter.
- **Normal file operations succeed** — writes within cwd still work.
- **`permissions.deny` rules present** — settings.json contains Read, Edit, Write, and WebFetch deny rules.
- **`permissions.allow` rules present** — settings.local.json pre-approves npm, node, and git commands.

### 05 — [Environment Persistence](scenarios/05-env-persistence/)

`CLAUDE_ENV_FILE` lets environment variables survive across Bash invocations — but source a completion script in it and every command silently dies. Tests validate:

- **Good env file sources without errors** — the correct env file is valid shell.
- **Env file sets variables** — `PROJECT_ENV` is available after sourcing.
- **Bad env file detected** — the bad example containing completion scripts is flagged.
- **Login shell picks up env** — `bash -l -c` sources the env file correctly.
- **Env file structure** — the file exists with expected content.

### 06 — [Devcontainer Reference](scenarios/06-devcontainer-reference/)

Container-level isolation: its own filesystem, network namespace, and process tree — boundaries the native sandbox can't provide. Tests validate:

- **Container detection** — `/.dockerenv` or cgroup indicators confirm container environment.
- **Non-root user** — `whoami` returns a non-root user.
- **Dropped capabilities** — `CapEff` in `/proc/1/status` is minimal.
- **Read-only filesystem** — writes to `/opt` fail.
- **Network restrictions** — `curl https://example.com` fails (when firewall is active).

### 07 — [Standalone Docker](scenarios/07-standalone-docker/)

Claude Code in a plain Docker container with security defaults — no devcontainer, no IDE integration. A Dockerfile and run script that apply `--cap-drop=ALL`, `--read-only`, `--security-opt=no-new-privileges`, and `noexec` tmpfs. Six checks:

- **Running inside Docker** — `/.dockerenv` exists.
- **Non-root user** — `whoami` returns `claude`.
- **All capabilities dropped** — `CapEff` is zero.
- **Read-only root filesystem** — writes to `/usr/local` fail.
- **tmpfs is writable but noexec** — write to `/tmp` works, execute from `/tmp` fails.
- **Project volume mounted** — project files are accessible.

### 08 — [Docker AI Sandboxes](scenarios/08-docker-sandboxes/)

Zero-config isolation via Docker Desktop's AI Sandbox — a microVM with full environment separation. Tests check prerequisites:

- **Docker available** — `docker --version` confirms Docker is installed.
- **Docker sandbox CLI** — `docker sandbox --help` confirms Docker Desktop supports AI Sandboxes.

### 09 — [Hardened Container](scenarios/09-hardened-container/)

Every reasonable Docker security control in one reference: dropped capabilities, no-new-privileges, read-only root, noexec tmpfs, resource limits, non-root user, isolated bridge network. Seven checks:

- **Running inside container** — container environment detected.
- **Non-root user** — uid 1001.
- **All capabilities dropped** — `CapEff` is all zeros.
- **Read-only root filesystem** — writes to `/usr/local/` return EROFS or EACCES.
- **tmpfs noexec** — executing scripts from `/tmp` is denied.
- **Resource limits** — cgroup memory limit is approximately 4GB.
- **No privilege escalation** — `NoNewPrivs` flag is set.

### 10 — [Combined Defense](scenarios/10-combined-defense/)

The capstone: one recommended config layering permissions + sandbox + container for defense in depth. Not a buffet — a sane default with documented knobs to loosen. Tests run in two phases:

- **Config validation (tests 1-4)** — parses settings.json and confirms all expected rules are present across permissions, sandbox filesystem, sandbox network, and excluded commands.
- **Sandbox enforcement (tests 5-8)** — runs commands through srt and confirms they are blocked or allowed as expected.

### 11 — [Excluded Commands](scenarios/11-excluded-commands/)

Prefix-match carve-outs that let specific commands bypass the sandbox while everything else stays locked. Covers the tradeoffs of running sandbox + Docker together. Tests validate:

- **Sandbox enabled** — `enabled: true` in settings.json.
- **`excludedCommands` configured** — `docker` is in the exclusion list.
- **`allowUnsandboxedCommands` is false** — non-excluded commands stay sandboxed.
- **Non-docker commands sandboxed** — `curl example.com` is still blocked by the sandbox.
- **Docker available** — `docker --version` confirms Docker is installed.

## `settings.json` Reference

Each scenario includes a `.claude/settings.json` that configures Claude Code's sandbox and permissions. Below is a minimal recommended starting point, followed by full property docs.

```jsonc
// .claude/settings.json — minimal recommended starting point
{
  "sandbox": {
    "enabled": true,                          // activate OS-level sandbox
    "allowUnsandboxedCommands": false,        // no command runs unsandboxed unless excluded
    "filesystem": {
      "allowWrite": ["."],                    // writes scoped to project directory
      "denyRead": [".env*"]                   // block secrets from Bash reads
    },
    "network": {
      "allowedDomains": ["api.anthropic.com"] // required for Anthropic API access from sandboxed Bash
    }
  }
}
```

### `sandbox`

#### `enabled` — `boolean` (default: `true`)

Activates OS-level sandboxing (Seatbelt on macOS, bubblewrap on Linux) for all Bash commands. When `false`, commands run unrestricted.

```jsonc
// turn on kernel-level isolation for every Bash invocation
"enabled": true
```

See it in action: [Scenario 01 — Native Sandbox Basics](scenarios/01-native-sandbox-basics/) proves the sandbox is active by showing writes outside cwd and outbound network are denied.

#### `allowUnsandboxedCommands` — `boolean` (default: `false`)

When `true`, commands not matched by `excludedCommands` can still run outside the sandbox. When `false` (recommended), the sandbox applies to every command except those in `excludedCommands`.

```jsonc
// keep everything sandboxed unless explicitly excluded
"allowUnsandboxedCommands": false
```

See it in action: [Scenario 08 — Docker Sandboxes](scenarios/08-docker-sandboxes/) tests that this is `false` so non-docker commands like `curl` stay sandboxed even though `docker` is excluded.

#### `excludedCommands` — `string[]` (default: `[]`)

Command prefixes that bypass the sandbox entirely. Uses prefix matching — `"docker"` matches `docker build`, `docker run`, etc. Use sparingly: excluded commands have full system access.

```jsonc
// docker needs host-level network access the sandbox blocks
"excludedCommands": ["docker", "docker-compose"]
```

See it in action: [Scenario 08 — Docker Sandboxes](scenarios/08-docker-sandboxes/) carves out Docker commands so they can access the Docker daemon, which requires host-level networking the sandbox would block.

### `sandbox.filesystem`

Controls what the sandboxed Bash process can read and write. Deny rules always override allow rules.

#### `allowRead` — `string[]` (default: `[]`)

Additional paths/globs the sandbox can read beyond the project directory. The project directory is readable by default.

```jsonc
// grant read access to system dictionary for spell-checking
"allowRead": ["/usr/share/dict"]
```

See it in action: [Scenario 01 — Native Sandbox Basics](scenarios/01-native-sandbox-basics/) leaves this empty — the default project-directory read access is sufficient for most workflows.

#### `denyRead` — `string[]` (default: `[]`)

Paths/globs the sandbox is blocked from reading, even within the project directory. Supports globs (`.env*`) and home-relative paths (`~/.ssh`).

```jsonc
// prevent Bash from reading secrets, even inside the project
"denyRead": [".env*", "~/.ssh"]
```

See it in action: [Scenario 02 — Filesystem Controls](scenarios/02-filesystem-controls/) blocks `cat .env.example` and `cat ~/.ssh/id_rsa` using these patterns.

#### `allowWrite` — `string[]` (default: `["."]`)

Paths/globs the sandbox can write to. `"."` means the project directory. Paths outside this list are blocked.

```jsonc
// restrict writes to the project directory only
"allowWrite": ["."]
```

See it in action: [Scenario 01 — Native Sandbox Basics](scenarios/01-native-sandbox-basics/) allows writes within cwd while [Scenario 02](scenarios/02-filesystem-controls/) demonstrates that `touch /tmp/test` fails because `/tmp` is not in the list.

#### `denyWrite` — `string[]` (default: `[]`)

Paths/globs the sandbox is blocked from writing, even if they fall inside an `allowWrite` path. Deny wins over allow.

```jsonc
// protect config and hooks from modification, even inside cwd
"denyWrite": ["secrets/", ".claude/", ".git/hooks/"]
```

See it in action: [Scenario 02 — Filesystem Controls](scenarios/02-filesystem-controls/) denies writes to `secrets/` even though cwd is writable. [Scenario 10 — Combined Defense](scenarios/10-combined-defense/) extends this to protect `.claude/` and `.git/hooks/`.

### `sandbox.network`

Controls outbound network access from Bash commands. This only affects commands run through the sandbox — Claude's built-in tools (WebFetch, WebSearch) are controlled separately via `permissions`.

#### `allowedDomains` — `string[]` (default: `[]`)

Domains Bash commands can reach. If empty, all outbound network is blocked. Required if Claude Code needs to reach the Anthropic API from sandboxed Bash commands.

```jsonc
// allowlist: only these domains are reachable from Bash
"allowedDomains": ["api.anthropic.com", "registry.npmjs.org"]
```

See it in action: [Scenario 03 — Network Isolation](scenarios/03-network-isolation/) allows `httpbin.org` and proves `curl example.com` is denied because it's not in the list.

#### `deniedDomains` — `string[]` (default: `[]`)

Domains explicitly blocked even if they would otherwise be allowed. Takes precedence over `allowedDomains`.

```jsonc
// block a specific domain even if a broad allowlist would permit it
"deniedDomains": ["evil.com"]
```

### `permissions`

Controls Claude's built-in tools (Read, Edit, Write, WebFetch, etc.) — the layer *above* the sandbox. The sandbox only governs Bash; permissions govern everything else.

#### `allow` — `string[]` (default: `[]`)

Tool invocations that are pre-approved without prompting. Format: `Tool(pattern)` — e.g., `Bash(npm *)` auto-approves any npm command. Patterns use glob matching.

```jsonc
// auto-approve common dev commands so Claude doesn't prompt each time
"allow": ["Bash(npm *)", "Bash(node *)", "Bash(git *)"]
```

See it in action: [Scenario 04 — Permissions Hardening](scenarios/04-permissions-hardening/) uses `settings.local.json` to pre-approve common dev commands. [Scenario 10 — Combined Defense](scenarios/10-combined-defense/) bakes these into the shared config.

#### `deny` — `string[]` (default: `[]`)

Tool invocations that are always blocked. Format: `Tool(pattern)` — e.g., `Read(.env*)` prevents Claude from reading any `.env` file. Deny rules cannot be overridden by allow rules.

```jsonc
// close the gaps the sandbox can't cover: Claude's own tools
"deny": ["Read(.env*)", "Read(*.pem)", "Edit(.claude/settings*)", "WebFetch(*)"]
```

See it in action: [Scenario 04 — Permissions Hardening](scenarios/04-permissions-hardening/) closes the gap between sandbox and Claude's built-in tools — without these rules, the Read tool could bypass `denyRead`. [Scenario 10](scenarios/10-combined-defense/) adds `*.pem` and `*.key` patterns.

> **Note:** `permissions.allow` and `permissions.deny` can also be placed in `.claude/settings.local.json` (gitignored) for user-specific overrides. See [Scenario 04](scenarios/04-permissions-hardening/) for this pattern.

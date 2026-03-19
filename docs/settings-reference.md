# `settings.json` Reference

Each scenario includes a `.claude/settings.json` that configures Claude Code's sandbox and permissions. This reference covers every property.

## Full example

```jsonc
// .claude/settings.json — from Scenario 10
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "excludedCommands": ["docker", "docker-compose"],
    "filesystem": {
      "allowRead": [],
      "allowWrite": ["."],
      "denyRead": [".env*", "*.pem", "*.key"],
      "denyWrite": [".claude/", "secrets/", ".git/hooks/"]
    },
    "network": {
      "allowedDomains": ["api.anthropic.com", "registry.npmjs.org", "pypi.org"],
      "deniedDomains": []
    }
  },
  "permissions": {
    "allow": [
      "Bash(npm *)",
      "Bash(node *)",
      "Bash(git *)",
      "Bash(npx *)"
    ],
    "deny": [
      "Read(.env*)",
      "Read(*.pem)",
      "Read(*.key)",
      "Edit(.claude/settings*)",
      "Write(.claude/settings*)",
      "WebFetch(*)"
    ]
  }
}
```

---

## `sandbox`

### `enabled` — `boolean` (default: `true`)

Activates OS-level sandboxing (Seatbelt on macOS, bubblewrap on Linux) for all Bash commands. When `false`, commands run unrestricted.

```jsonc
"enabled": true
```

See it in action: [Scenario 01 — Native Sandbox Basics](../scenarios/01-native-sandbox-basics/) proves the sandbox is active by showing writes outside cwd and outbound network are denied.

### `allowUnsandboxedCommands` — `boolean` (default: `false`)

When `true`, commands not matched by `excludedCommands` can still run outside the sandbox. When `false` (recommended), the sandbox applies to every command except those in `excludedCommands`.

```jsonc
"allowUnsandboxedCommands": false
```

### `excludedCommands` — `string[]` (default: `[]`)

Command prefixes that bypass the sandbox entirely. Uses prefix matching — `"docker"` matches `docker build`, `docker run`, etc. Use sparingly: excluded commands have full system access.

```jsonc
"excludedCommands": ["docker", "docker-compose"]
```

See it in action: [Scenario 11 — Excluded Commands](../scenarios/11-excluded-commands/) carves out Docker commands so they can access the Docker daemon, which requires host-level networking the sandbox would block.

---

## `sandbox.filesystem`

Controls what the sandboxed Bash process can read and write. **Deny rules always override allow rules.**

### `allowRead` — `string[]` (default: `[]`)

Additional paths/globs the sandbox can read beyond the project directory. The project directory is readable by default.

```jsonc
"allowRead": ["/usr/share/dict"]
```

### `denyRead` — `string[]` (default: `[]`)

Paths/globs the sandbox is blocked from reading, even within the project directory. Supports globs (`.env*`) and home-relative paths (`~/.ssh`).

```jsonc
"denyRead": [".env*", "~/.ssh"]
```

See it in action: [Scenario 02 — Filesystem Controls](../scenarios/02-filesystem-controls/) blocks `cat .env.example` and `cat ~/.ssh/id_rsa` using these patterns.

### `allowWrite` — `string[]` (default: `["."]`)

Paths/globs the sandbox can write to. `"."` means the project directory. Paths outside this list are blocked.

```jsonc
"allowWrite": ["."]
```

### `denyWrite` — `string[]` (default: `[]`)

Paths/globs the sandbox is blocked from writing, even if they fall inside an `allowWrite` path. Deny wins over allow.

```jsonc
"denyWrite": ["secrets/", ".claude/", ".git/hooks/"]
```

See it in action: [Scenario 02 — Filesystem Controls](../scenarios/02-filesystem-controls/) denies writes to `secrets/` even though cwd is writable.

---

## `sandbox.network`

Controls outbound network access from Bash commands. This only affects commands run through the sandbox — Claude's built-in tools (WebFetch, WebSearch) are controlled separately via `permissions`.

### `allowedDomains` — `string[]` (default: `[]`)

Domains Bash commands can reach. If empty, all outbound network is blocked.

```jsonc
"allowedDomains": ["api.anthropic.com", "registry.npmjs.org"]
```

See it in action: [Scenario 03 — Network Isolation](../scenarios/03-network-isolation/) allows `httpbin.org` and proves `curl example.com` is denied because it's not in the list.

### `deniedDomains` — `string[]` (default: `[]`)

Domains explicitly blocked even if they would otherwise be allowed. Takes precedence over `allowedDomains`.

```jsonc
"deniedDomains": ["evil.com"]
```

---

## `permissions`

Controls Claude's built-in tools (Read, Edit, Write, WebFetch, etc.) — the layer *above* the sandbox. The sandbox only governs Bash; permissions govern everything else.

### `allow` — `string[]` (default: `[]`)

Tool invocations that are pre-approved without prompting. Format: `Tool(pattern)` — e.g., `Bash(npm *)` auto-approves any npm command. Patterns use glob matching.

```jsonc
"allow": ["Bash(npm *)", "Bash(node *)", "Bash(git *)"]
```

See it in action: [Scenario 04 — Permissions Hardening](../scenarios/04-permissions-hardening/) uses `settings.local.json` to pre-approve common dev commands.

### `deny` — `string[]` (default: `[]`)

Tool invocations that are always blocked. Format: `Tool(pattern)` — e.g., `Read(.env*)` prevents Claude from reading any `.env` file. Deny rules cannot be overridden by allow rules.

```jsonc
"deny": ["Read(.env*)", "Read(*.pem)", "Edit(.claude/settings*)", "WebFetch(*)"]
```

See it in action: [Scenario 04 — Permissions Hardening](../scenarios/04-permissions-hardening/) closes the gap between sandbox and Claude's built-in tools — without these rules, the Read tool could bypass `denyRead`.

---

> **Note:** `permissions.allow` and `permissions.deny` can also be placed in `.claude/settings.local.json` (gitignored) for user-specific overrides. See [Scenario 04](../scenarios/04-permissions-hardening/) for this pattern.

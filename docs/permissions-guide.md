# Claude Code Permissions Guide

Complete reference for all `permissions.*` properties in Claude Code settings.

## Settings Files

| Scope | Path | Priority |
|-------|------|----------|
| Managed | `/Library/Application Support/ClaudeCode/managed-settings.json` (macOS) | 1 — Highest |
| User | `~/.claude/settings.json` | 2 |
| Project (shared) | `.claude/settings.json` | 3 |
| Project (local) | `.claude/settings.local.json` (gitignored) | 4 — Lowest |

**Rule evaluation:** deny → ask → allow. A deny at any level cannot be overridden by a lower-priority level.

---

## Properties

### `permissions.allow`

Array of permission rules that Claude can use **without prompting**.

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run build)",
      "Bash(npm run test *)",
      "Read",
      "Edit(/src/**/*.ts)",
      "WebFetch(domain:github.com)"
    ]
  }
}
```

### `permissions.ask`

Array of permission rules that **always prompt** the user for confirmation.

```json
{
  "permissions": {
    "ask": [
      "Bash(git push *)",
      "Bash(rm -rf *)",
      "Edit(./.env)"
    ]
  }
}
```

### `permissions.deny`

Array of permission rules that Claude is **blocked from using**. Highest priority — no other scope can override a deny.

```json
{
  "permissions": {
    "deny": [
      "WebFetch",
      "Bash(curl *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)"
    ]
  }
}
```

> **Note:** `Read(...)` deny patterns also merge into `sandbox.filesystem.denyRead`; `Edit(...)` patterns merge into `sandbox.filesystem.denyWrite`. A single rule like `Read(.env*)` blocks both the Read tool and Bash commands like `cat .env`. See the [Sandbox Guide](sandbox-guide.md#how-sandbox-and-permissions-interact) for details.

### `permissions.additionalDirectories`

Array of directory paths Claude can access beyond the launch directory. Files in these directories follow the same permission rules as the working directory.

**Path formats:**
- `./path` or `path` — relative to project root (project settings) or `~/.claude` (user settings)
- `~/path` — relative to home directory
- `//path` — absolute path from filesystem root

**Can also be set via:**
- CLI: `--add-dir <path>`
- Session: `/add-dir` command

```json
{
  "permissions": {
    "additionalDirectories": [
      "../docs/",
      "~/shared-projects/common",
      "//tmp/build-output"
    ]
  }
}
```

### `permissions.defaultMode`

Sets the default permission mode when Claude Code starts.

| Value | Description |
|-------|-------------|
| `"default"` | Prompts for permission on first use of each tool |
| `"acceptEdits"` | Automatically accepts file edit permissions |
| `"plan"` | Plan Mode — Claude can analyze but not modify files or run commands |
| `"dontAsk"` | Auto-denies tools unless pre-approved via `permissions.allow` |
| `"bypassPermissions"` | Skips prompts except for writes to `.git`, `.claude`, `.vscode`, `.idea` |

```json
{
  "permissions": {
    "defaultMode": "acceptEdits"
  }
}
```

> **Note:** `bypassPermissions` still prompts for writes to `.git`, `.claude`, `.vscode`, `.idea`. Writes to `.claude/commands`, `.claude/agents`, `.claude/skills` are exempt.

> **Important:** `permissions.deny` rules are enforced regardless of `defaultMode`, including under `bypassPermissions`. Bypass skips prompts, not deny rules. This makes `bypassPermissions` + targeted deny rules a practical production configuration.

### `permissions.disableBypassPermissionsMode`

**(Managed settings only)** Prevents use of `bypassPermissions` mode and the `--dangerously-skip-permissions` CLI flag.

```json
{
  "permissions": {
    "disableBypassPermissionsMode": "disable"
  }
}
```

### `allowManagedPermissionRulesOnly`

**(Managed settings only, top-level property)** Prevents user and project settings from defining `allow`, `ask`, or `deny` rules. Only managed settings rules apply.

```json
{
  "allowManagedPermissionRulesOnly": true
}
```

---

## Permission Rule Syntax

### Tool Names

| Tool Name | What It Covers |
|-----------|---------------|
| `Bash` | Shell command execution |
| `Read` | File reading (Read, Glob, Grep tools) |
| `Edit` | File modification (Edit tool) |
| `Write` | File creation (Write tool) |
| `WebFetch` | Web requests |
| `WebSearch` | Web search queries |
| `Agent` | Subagents / custom agents |
| `mcp__*` | MCP server tools |

### Bare Tool (No Specifier)

Matches **all** uses of that tool:

```json
"allow": ["Read", "Edit", "WebFetch"]
```

### Bash Rules — Wildcard Patterns

```
Bash(exact-command)       → matches only that exact command
Bash(prefix *)            → wildcard at end (space = word boundary)
Bash(prefix*)             → wildcard at end (no boundary — "ls*" matches "lsof")
Bash(* suffix)            → wildcard at start
Bash(mid * end)           → wildcard in middle
```

**Important behaviors:**
- `Bash(ls *)` matches `ls -la` but **not** `lsof` (space before `*` enforces word boundary)
- `Bash(ls*)` matches both `ls -la` **and** `lsof`
- Shell operators (`&&`, `||`, `|`) are recognized — `Bash(safe-cmd *)` won't match `safe-cmd && evil-cmd`
- Compound commands are split — each subcommand is evaluated against rules separately (up to 5)

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run build)",
      "Bash(npm run *)",
      "Bash(git commit *)",
      "Bash(* --version)",
      "Bash(* --help *)"
    ],
    "deny": [
      "Bash(curl *)",
      "Bash(rm -rf *)"
    ]
  }
}
```

### Read / Edit / Write Rules — Gitignore-Style Patterns

```
//path          → absolute path from filesystem root
~/path          → relative to home directory
/path           → relative to project root
./path or path  → relative to current directory
```

Wildcards: `*` matches within a directory, `**` matches recursively.

```json
{
  "permissions": {
    "allow": [
      "Edit(/src/**/*.ts)",
      "Edit(/docs/**)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Read(//Users/alice/private/)"
    ]
  }
}
```

**Windows note:** Paths are normalized (`C:\Users\alice` → `/c/Users/alice`). Use `//c/**/.env` for drive-scoped patterns.

### WebFetch Rules

```json
{
  "permissions": {
    "allow": [
      "WebFetch(domain:github.com)",
      "WebFetch(domain:npm.registry.com)"
    ]
  }
}
```

### MCP Tool Rules

```
mcp__servername             → any tool from that server
mcp__servername__*          → wildcard (same effect)
mcp__servername__toolname   → specific tool
```

```json
{
  "permissions": {
    "allow": ["mcp__github__*"],
    "deny": ["mcp__filesystem"]
  }
}
```

### Agent Rules

```json
{
  "permissions": {
    "allow": [
      "Agent(Explore)",
      "Agent(Plan)",
      "Agent(my-custom-agent)"
    ]
  }
}
```

---

## Complete Example

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run build)",
      "Bash(npm run test *)",
      "Bash(npm run lint)",
      "Bash(git commit *)",
      "Read",
      "Edit(/src/**/*.ts)",
      "Write(/dist/**)",
      "Agent(Explore)"
    ],
    "ask": [
      "Bash(git push *)",
      "Edit(./.env)"
    ],
    "deny": [
      "Bash(curl *)",
      "Bash(rm -rf *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "WebFetch(domain:internal-api.company.com)"
    ],
    "additionalDirectories": [
      "../docs/",
      "~/shared-projects/common"
    ],
    "defaultMode": "acceptEdits"
  }
}
```

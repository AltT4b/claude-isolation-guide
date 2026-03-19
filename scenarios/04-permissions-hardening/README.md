# Scenario 04 — Permissions Hardening

The permissions system (`permissions.allow`, `permissions.deny`) controls what Claude's built-in tools can do — Read, Edit, Write, WebFetch, WebSearch, Bash, and MCP calls. It is the application-layer complement to the OS-level sandbox.

## Why It Matters

The sandbox only covers Bash. Without permissions rules:

| Action | Sandbox blocks it? | Permissions block it? |
|---|---|---|
| `cat .env` (Bash) | Yes (`denyRead`) | N/A — Bash is sandbox-controlled |
| Read tool on `.env` | **No** | Yes (`permissions.deny`) |
| `curl attacker.com` (Bash) | Yes (`allowedDomains`) | N/A |
| WebFetch to `attacker.com` | **No** | Yes (`permissions.deny`) |
| Edit `.claude/settings.json` | **No** | Yes (`permissions.deny`) |

You need **both layers** for full coverage.

## Quick Start

```bash
cd scenarios/04-permissions-hardening
npm install
npm test
```

## Setup

### 1. Project-level settings (committed to git)

`.claude/settings.json` — shared with the team:

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "filesystem": {
      "allowRead": [],
      "denyRead": [".env*"],
      "allowWrite": ["."],
      "denyWrite": [".claude/"]
    },
    "network": {
      "allowedDomains": ["api.anthropic.com"],
      "deniedDomains": []
    }
  },
  "permissions": {
    "deny": [
      "Read(.env*)",
      "Read(.claude/settings*)",
      "Edit(.claude/settings*)",
      "Write(.claude/settings*)",
      "WebFetch(*)"
    ]
  }
}
```

### 2. User-level overrides (normally gitignored)

`.claude/settings.local.json` — personal preferences that override project settings. In a real project this file would be gitignored; we commit it here so the tests work on clone:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm *)",
      "Bash(node *)",
      "Bash(git *)"
    ]
  }
}
```

### 3. Merge order

Settings merge in this order (later wins):

1. **Default** — Claude's built-in defaults
2. **Project** — `.claude/settings.json` (committed)
3. **User** — `.claude/settings.local.json` (gitignored)

A user can `allow` something the project `deny`s. For team-wide enforcement that users cannot override, use managed settings (out of scope here).

## Closing the Gaps

### Gap 1: Read tool bypasses `denyRead`

Scenario 02 showed that `sandbox.filesystem.denyRead: [".env*"]` blocks `cat .env`. But the Read tool is not a Bash command — it operates outside the sandbox.

**The gap:**
```
Bash:  cat .env.example   → blocked by sandbox (denyRead)
Read:  Read(.env.example)  → NOT blocked (sandbox doesn't cover Read tool)
```

**The fix:**
```json
"permissions": {
  "deny": ["Read(.env*)"]
}
```

Now both layers block `.env` access.

### Gap 2: WebFetch bypasses `allowedDomains`

The sandbox network filter blocks `curl attacker.com` but WebFetch is a built-in tool, not a Bash command.

**The gap:**
```
Bash:      curl attacker.com  → blocked by sandbox (allowedDomains)
WebFetch:  WebFetch(*)        → NOT blocked (sandbox doesn't cover WebFetch)
```

**The fix:**
```json
"permissions": {
  "deny": ["WebFetch(*)"]
}
```

Or selectively allow specific domains and deny everything else.

### Gap 3: Settings tampering

Without protection, Claude could Edit `.claude/settings.json` to weaken its own restrictions.

**The fix:**
```json
"permissions": {
  "deny": [
    "Read(.claude/settings*)",
    "Edit(.claude/settings*)",
    "Write(.claude/settings*)"
  ]
}
```

## Verify It Works

```bash
npm test
```

The test suite validates:
- Sandbox blocks `cat .env.example` (Bash-level denyRead)
- Sandbox blocks outbound network (Bash-level network filter)
- Normal file operations within cwd succeed
- `settings.json` contains the expected `permissions.deny` rules
- `settings.local.json` contains the expected `permissions.allow` rules

**Manual testing (requires a live Claude session):**

To verify that permissions rules actually block Claude's tools, open a Claude Code session in this directory and try:

1. Ask Claude to read `.env.example` — should be denied by `Read(.env*)` rule
2. Ask Claude to edit `.claude/settings.json` — should be denied by `Edit(.claude/settings*)` rule
3. Ask Claude to fetch an arbitrary URL — should be denied by `WebFetch(*)`

These tool-level rules can only be enforced inside a live Claude session, not via `srt`.

## Gotchas

- **Permissions are not sandbox.** Permissions control Claude's tools; sandbox controls Bash. You need both for full coverage.
- **Merge order matters.** `settings.local.json` overrides `settings.json`. A user can `allow` something the project `deny`s. For team enforcement, use managed settings (out of scope here).
- **Glob patterns vary.** `Read(.env*)` uses tool-call matching, not filesystem globs. Test your patterns.
- **`autoAllowBashIfSandboxed`** — when sandbox is on, Bash commands auto-approve. Permissions `deny` rules for Bash still apply (they are checked before auto-allow).
- **MCP server permissions** — MCP tools show up as `mcp__servername__toolname()`. You can deny specific MCP tools the same way.
- **Mandatory deny paths** — some paths are always denied regardless of config (`.bashrc`, `.git/hooks/`, `.claude/agents/`, etc.). Do not fight them.

## Next Steps

- **[Scenario 05 — Environment Persistence](../05-env-persistence/)** — `CLAUDE_ENV_FILE` and persistent environment setup
- **[Scenario 10 — Combined Defense](../10-combined-defense/)** — Putting it all together

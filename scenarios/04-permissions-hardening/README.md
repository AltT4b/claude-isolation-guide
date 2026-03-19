# Scenario 04 — Permissions Hardening

Sandbox covers Bash. Permissions cover Claude's built-in tools (Read, Edit, WebFetch). You need both — this scenario closes the gaps between them.

## Config

**`.claude/settings.json`** (project-level):
```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "filesystem": {
      "denyRead": [".env*"],
      "allowWrite": ["."],
      "denyWrite": [".claude/"]
    },
    "network": { "allowedDomains": ["api.anthropic.com"] }
  },
  "permissions": {
    "deny": [
      "Read(.env*)", "Read(.claude/settings*)",
      "Edit(.claude/settings*)", "Write(.claude/settings*)",
      "WebFetch(*)"
    ]
  }
}
```

**`.claude/settings.local.json`** (user-level, normally gitignored):
```json
{
  "permissions": {
    "allow": ["Bash(npm *)", "Bash(node *)", "Bash(git *)"]
  }
}
```

## Verify

```bash
npm install
npm test
```

## What It Proves

| Gap | Without permissions | With permissions |
|---|---|---|
| `Read .env` (Read tool) | **Open** — sandbox only blocks Bash | Blocked by `Read(.env*)` |
| `WebFetch attacker.com` | **Open** — sandbox only blocks curl | Blocked by `WebFetch(*)` |
| `Edit .claude/settings.json` | **Open** — Claude can weaken itself | Blocked by `Edit(.claude/settings*)` |

---

## Deep Dive

### Why both layers

| Action | Sandbox blocks it? | Permissions block it? |
|---|---|---|
| `cat .env` (Bash) | Yes (`denyRead`) | N/A — Bash is sandbox-controlled |
| Read tool on `.env` | **No** | Yes (`permissions.deny`) |
| `curl attacker.com` (Bash) | Yes (`allowedDomains`) | N/A |
| WebFetch to `attacker.com` | **No** | Yes (`permissions.deny`) |
| Edit `.claude/settings.json` | **No** | Yes (`permissions.deny`) |

### Settings merge order

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

### Manual testing (requires a live Claude session)

Tool-level permissions can only be enforced inside a live Claude session, not via `srt`. Open Claude Code in this directory and try:

1. Ask Claude to read `.env.example` — should be denied by `Read(.env*)` rule
2. Ask Claude to edit `.claude/settings.json` — should be denied by `Edit(.claude/settings*)` rule
3. Ask Claude to fetch an arbitrary URL — should be denied by `WebFetch(*)`

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

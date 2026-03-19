# Scenario 04 — Permissions Hardening

Sandbox covers Bash. Permissions cover Claude's built-in tools (Read, Edit, WebFetch). You need both — this scenario closes the gaps between them.

## Config

**`.claude/settings.json`** (project-level):
```jsonc
{
  "sandbox": {
    "enabled": true,                           // activate OS-level sandboxing
    "allowUnsandboxedCommands": false,         // no fallback — only excludedCommands bypass
    "filesystem": {
      "denyRead": [".env*"],                   // block Bash reads of secrets
      "allowWrite": ["."],                     // writes allowed anywhere in project dir
      "denyWrite": [".claude/"]                // protect settings from Bash modification
    },
    "network": { "allowedDomains": ["api.anthropic.com"] }  // only Anthropic API allowed
  },
  "permissions": {
    "deny": [
      "Read(.env*)", "Read(.claude/settings*)",       // close the Read-tool gap
      "Edit(.claude/settings*)", "Write(.claude/settings*)",  // prevent settings tampering
      "WebFetch(*)"                                    // close the WebFetch gap
    ]
  }
}
```

**`.claude/settings.local.json`** (user-level, normally gitignored):
```jsonc
{
  "permissions": {
    "allow": ["Bash(npm *)", "Bash(node *)", "Bash(git *)"]  // auto-approve common commands
  }
}
```

## Verify

```bash
npm install
npm test
```

## What You'll See

| Action | Sandbox blocks it? | Permissions block it? |
|---|---|---|
| `cat .env` (Bash) | Yes (`denyRead`) | N/A — Bash is sandbox-controlled |
| Read tool on `.env` | **No** | Yes (`permissions.deny`) |
| `curl attacker.com` (Bash) | Yes (`allowedDomains`) | N/A |
| WebFetch to `attacker.com` | **No** | Yes (`permissions.deny`) |
| Edit `.claude/settings.json` | **No** | Yes (`permissions.deny`) |

```
PASS — Read of .env.example was denied by the sandbox.
PASS — Outbound request to example.com was blocked.
PASS — Write/read/delete within cwd succeeded.
PASS — permissions.deny includes "Read(.env*)".
PASS — permissions.deny includes "WebFetch(*)".
PASS — permissions.allow includes "Bash(npm *)".

Passed: 12 / 12
```

---

## Deep Dive

### Settings merge order

1. **Default** — Claude's built-in defaults
2. **Project** — `.claude/settings.json` (committed)
3. **User** — `.claude/settings.local.json` (gitignored)

A user can `allow` something the project `deny`s. For team-wide enforcement that users cannot override, use managed settings (out of scope here).

## Closing the Gaps

### Gap 1: Read tool bypasses `denyRead`

Scenario 02 showed that `denyRead` blocks `cat .env`. But the Read tool is not a Bash command — it operates outside the sandbox.

**The gap:**
```
Bash:  cat .env.example   → blocked by sandbox (denyRead)
Read:  Read(.env.example)  → NOT blocked (sandbox doesn't cover Read tool)
```

**The fix:**
```jsonc
"permissions": {
  "deny": ["Read(.env*)"]  // now both layers block .env access
}
```

### Gap 2: WebFetch bypasses `allowedDomains`

The sandbox blocks `curl attacker.com` but WebFetch is a built-in tool, not a Bash command.

**The gap:**
```
Bash:      curl attacker.com  → blocked by sandbox (allowedDomains)
WebFetch:  WebFetch(*)        → NOT blocked (sandbox doesn't cover WebFetch)
```

**The fix:**
```jsonc
"permissions": {
  "deny": ["WebFetch(*)"]  // or selectively allow specific domains
}
```

### Gap 3: Settings tampering

Without protection, Claude could Edit `.claude/settings.json` to weaken its own restrictions.

**The gap:**
```
Edit:   Edit(.claude/settings.json)  → NOT blocked (no default protection)
Write:  Write(.claude/settings.json) → NOT blocked
```

**The fix:**
```jsonc
"permissions": {
  "deny": [
    "Read(.claude/settings*)",   // prevent reading config
    "Edit(.claude/settings*)",   // prevent editing config
    "Write(.claude/settings*)"   // prevent overwriting config
  ]
}
```

### Manual testing (requires a live Claude session)

Tool-level permissions can only be enforced inside a live Claude session, not via srt (sandbox runtime — the CLI that enforces sandbox rules outside a live Claude session). Open Claude Code in this directory and try:

1. Ask Claude to read `.env.example` — should be denied by `Read(.env*)` rule
2. Ask Claude to edit `.claude/settings.json` — should be denied by `Edit(.claude/settings*)` rule
3. Ask Claude to fetch an arbitrary URL — should be denied by `WebFetch(*)`

## Gotchas

- **Glob patterns vary.** `Read(.env*)` uses tool-call matching, not filesystem globs. Test your patterns.
- **`autoAllowBashIfSandboxed`** — when sandbox is on, Bash commands auto-approve. Permissions `deny` rules for Bash still apply (they are checked before auto-allow).
- **MCP server permissions** — MCP tools show up as `mcp__servername__toolname()`. You can deny specific MCP tools the same way.
- **Mandatory deny paths** — some paths are always denied regardless of config (`.bashrc`, `.git/hooks/`, `.claude/agents/`, etc.). Do not fight them.

## Next Steps

- **[Scenario 05 — Environment Persistence](../05-env-persistence/)** — `CLAUDE_ENV_FILE` and persistent environment setup
- **[Scenario 10 — Combined Defense](../10-combined-defense/)** — Putting it all together

# Scenario 04 — Permissions Hardening

Sandbox covers Bash. Permissions cover Claude's built-in tools (Read, Edit, WebFetch). You need both — this scenario closes the gaps between them.

## The Two Layers

| Action | Sandbox blocks it? | Permissions block it? |
|---|---|---|
| `cat .env` (Bash) | Yes (`denyRead`) | N/A — Bash is sandbox-controlled |
| Read tool on `.env` | **No** | Yes (`permissions.deny`) |
| `curl attacker.com` (Bash) | Yes (`allowedDomains`) | N/A |
| WebFetch to `attacker.com` | **No** | Yes (`permissions.deny`) |
| Edit `.claude/settings.json` | **No** | Yes (`permissions.deny`) |

The sandbox is an OS-level jail for Bash commands. Claude's built-in tools (Read, Edit, Write, WebFetch) don't go through Bash — they bypass the sandbox entirely. `permissions.deny` is the only way to restrict them.

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

### Settings merge order

1. **Default** — Claude's built-in defaults
2. **Project** — `.claude/settings.json` (committed)
3. **User** — `.claude/settings.local.json` (gitignored)

A user can `allow` something the project `deny`s. For team-wide enforcement that users cannot override, use managed settings (out of scope here).

## Step 1: Demonstrate the Gaps (`npm test`)

The verify script uses `srt` (the sandbox runtime) to prove the gaps exist — it shows what the sandbox blocks and what it *doesn't*.

```bash
npm install
npm test
```

**What you'll see:**

```
Test 1a — Bash reads .env.example (sandbox layer)
  PASS — Sandbox blocked: cat .env.example (Bash read denied).

Test 1b — Node reads .env.example (sandbox gap)
  GAP:   This is exactly what Claude's Read tool does — it bypasses the sandbox.
  PASS — Sandbox did NOT block: Node fs.readFileSync read .env.example successfully.

Test 2a — Bash network request (sandbox layer)
  PASS — Sandbox blocked: curl to example.com (network denied).

Test 2b — Node network request (sandbox gap)
  GAP:   Claude's WebFetch tool makes HTTP requests outside the sandbox entirely.

Test 3 — Node writes to .claude/ (sandbox gap)
  PASS — Sandbox did NOT block: Node wrote a file inside .claude/ directory.
  GAP:   Without permissions.deny, Claude could weaken its own config.

Test 4 — Permissions Deny Rules (settings.json)
  PASS — "Read(.env*)" — Gap 1 — blocks Read tool from accessing secrets.
  PASS — "WebFetch(*)" — Gap 2 — blocks WebFetch from bypassing network rules.
  ...

Test 5 — Permissions Allow Rules (settings.local.json)
  PASS — permissions.allow includes "Bash(npm *)".
  ...
```

The srt tests prove the sandbox has holes. The config checks prove permissions.deny is wired up to close them.

## Step 2: Break It on Purpose

Each experiment below is a single edit to `.claude/settings.json`. Make the change, run `npm test`, observe which test flips, then **undo the edit** before moving on.

### Experiment A — Remove a sandbox read rule

Open `.claude/settings.json` and delete `".env*"` from `denyRead`:

```diff
- "denyRead": [".env*"],
+ "denyRead": [],
```

Run `npm test`. **Test 1a flips to FAIL** — the sandbox no longer blocks `cat .env.example`. Test 1b (the gap test) is unchanged because it was already bypassing the sandbox.

**Takeaway:** `denyRead` is the sandbox's only defense for file reads. Without it, even Bash can read secrets.

Undo the edit before continuing.

### Experiment B — Remove a permissions deny rule

Delete `"Read(.env*)"` from `permissions.deny`:

```diff
  "deny": [
-   "Read(.env*)",
    "Read(.claude/settings*)",
```

Run `npm test`. **Test 4 fails for `Read(.env*)`** — the config check catches the missing rule. Tests 1a and 1b are unchanged (they test the sandbox, not permissions).

**Takeaway:** The verify script can't enforce permissions (only Claude Code does that), but it can verify the rules are in place. To see the actual enforcement, continue to Step 3.

Undo the edit before continuing.

### Experiment C — Open the network

Change `allowedDomains` to allow everything:

```diff
- "allowedDomains": ["api.anthropic.com"],
+ "allowedDomains": ["api.anthropic.com", "example.com"],
```

Run `npm test`. **Test 2a flips to FAIL** — `curl example.com` now succeeds inside the sandbox. Test 2b may also change depending on your sandbox implementation.

**Takeaway:** `allowedDomains` is a whitelist. Adding a single domain opens a hole in the sandbox layer. The `WebFetch(*)` deny rule in permissions is unaffected — it still blocks Claude's WebFetch tool independently.

Undo the edit before continuing.

### Experiment D — Remove settings tamper protection

Delete the `.claude/settings*` deny rules:

```diff
  "deny": [
    "Read(.env*)",
-   "Read(.claude/settings*)",
-   "Edit(.claude/settings*)",
-   "Write(.claude/settings*)",
    "WebFetch(*)"
  ]
```

Run `npm test`. **Test 4 fails for all three settings rules.** Without these, Claude could read its own config, find the deny list, and edit it away — removing every restriction in a single tool call.

Undo the edit before continuing.

## Step 3: Prove the Fixes (`claude -p`)

The permissions layer is enforced by Claude Code, not by the sandbox. The only way to verify it is to run `claude` and watch it get blocked.

> **Cost note:** Each `claude -p` call below makes an API request. Expect a few cents per test.

### Gap 1: Read tool on secrets

The sandbox blocks `cat .env.example`, but does `permissions.deny` block the Read tool?

```bash
claude -p "Use the Read tool to read .env.example and show me its full contents." \
  --output-format json \
  --permission-mode default
```

**Expected:** Claude reports that reading `.env.example` was denied. Check the JSON output for `permission_denials` containing `Read(.env*)`, or look for a denial message in `result`.

**Without the fix:** Remove `"Read(.env*)"` from permissions.deny, run again — Claude reads the file and shows you the fake API key. The sandbox didn't stop it.

### Gap 2: WebFetch bypasses network rules

The sandbox blocks `curl`, but does `permissions.deny` block WebFetch?

```bash
claude -p "Use the WebFetch tool to fetch https://example.com and show me the response." \
  --output-format json \
  --permission-mode default
```

**Expected:** Claude reports that WebFetch was denied. The `permission_denials` array should contain `WebFetch(*)`.

**Without the fix:** Remove `"WebFetch(*)"` from permissions.deny — Claude fetches the page successfully, completely bypassing the sandbox's `allowedDomains`.

### Gap 3: Settings tampering

Can Claude edit its own restrictions?

```bash
claude -p "Use the Edit tool to add 'WebFetch(*)' to the permissions.allow array in .claude/settings.json." \
  --output-format json \
  --permission-mode default
```

**Expected:** Claude reports that editing `.claude/settings.json` was denied.

**Without the fix:** Remove the `Edit(.claude/settings*)` and `Write(.claude/settings*)` deny rules — Claude can modify its own settings file, potentially removing every restriction you've configured.

### Reading the JSON output

The `--output-format json` response includes:

```jsonc
{
  "result": "...",           // Claude's text response (will mention the denial)
  "permission_denials": [],  // array of denied tool calls — look for your rules here
  "total_cost_usd": 0.03,   // cost of this API call
  "is_error": false
}
```

If `permission_denials` is empty and `result` contains the file contents / page body / a success message, the deny rule isn't working.

## Deep Dive

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

## Gotchas

- **Glob patterns vary.** `Read(.env*)` uses tool-call matching, not filesystem globs. Test your patterns.
- **`autoAllowBashIfSandboxed`** — when sandbox is on, Bash commands auto-approve. Permissions `deny` rules for Bash still apply (they are checked before auto-allow).
- **MCP server permissions** — MCP tools show up as `mcp__servername__toolname()`. You can deny specific MCP tools the same way.
- **Mandatory deny paths** — some paths are always denied regardless of config (`.bashrc`, `.git/hooks/`, `.claude/agents/`, etc.). Do not fight them.

## Next Steps

- **[Scenario 05 — Environment Persistence](../05-env-persistence/)** — `CLAUDE_ENV_FILE` and persistent environment setup
- **[Scenario 10 — Combined Defense](../10-combined-defense/)** — Putting it all together

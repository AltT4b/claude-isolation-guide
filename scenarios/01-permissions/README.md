# Scenario 01 — Permissions

> The sandbox only governs Bash. Claude's built-in tools — Read, Edit, Write, WebFetch — bypass it entirely. Permissions close that gap.

## What You'll Learn

- `permissions.deny` blocks specific tool invocations unconditionally
- `permissions.allow` pre-approves safe commands to reduce prompt friction
- Why both sandbox rules *and* permissions are needed for defense in depth
- `settings.local.json` separates user preferences from project policy

## The Gap

The sandbox intercepts Bash commands. If you set `denyRead: [".env*"]`, then `cat .env` is blocked. But Claude's **Read tool** doesn't go through Bash — it reads files directly. The sandbox never sees it.

The same gap exists in three places:

| Sandbox rule | What it blocks | What it misses |
|---|---|---|
| `denyRead: [".env*"]` | `cat .env`, `grep .env` | Claude's **Read** tool |
| `allowedDomains: [...]` | `curl`, `wget` | Claude's **WebFetch** tool |
| `allowWrite: ["."]` | `echo > .claude/settings.json` | Claude's **Edit** / **Write** tools |

One solution closes all three: **`permissions.deny`**.

## Configuration

### `.claude/settings.json` (project-level, committed)

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "filesystem": {
      "allowWrite": ["."],
      "denyRead": [".env*"]
    },
    "network": {
      "allowedDomains": ["api.anthropic.com"]
    }
  },
  "permissions": {
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

Each deny rule maps to a gap:

- **`Read(.env*)`** — Closes the file-read gap. The sandbox blocks `cat .env` but not the Read tool.
- **`Read(*.pem)`, `Read(*.key)`** — Extends secret protection to certificate and key files.
- **`Edit(.claude/settings*)`** — Prevents Claude from weakening its own restrictions via the Edit tool.
- **`Write(.claude/settings*)`** — Prevents Claude from overwriting settings entirely via the Write tool.
- **`WebFetch(*)`** — Closes the network gap. The sandbox blocks `curl` but not WebFetch.

### `.claude/settings.local.json` (user-level, gitignored)

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

Allow rules pre-approve commands you trust so Claude doesn't prompt for confirmation every time. These belong in `settings.local.json` because they reflect personal workflow preferences, not project security policy.

## Run It

```bash
npm install
npm test
```

## What You'll See

The verify script runs 7 tests in two groups:

**Config validation (tests 1-3):**
- Checks that all 6 deny rules are present in `settings.json`
- Verifies no pattern appears in both allow and deny
- Confirms `settings.local.json` has the convenience allow rules

**Gap demonstrations (tests 4-7):**
- Shows the sandbox blocking `cat .env.example` (Bash baseline)
- Shows Node's `fs.readFileSync` bypassing the sandbox (or notes the gap if blocked)
- Shows the sandbox blocking `curl example.com` (network baseline)
- Shows Node's `http.get` bypassing the sandbox (or notes the gap if blocked)

Expected output: **7 passed, 0 failed**.

## Break It on Purpose

Try these experiments to see what happens when the config is incomplete:

**A. Remove `Read(.env*)` from deny:**
Edit `.claude/settings.json` and delete the `"Read(.env*)"` line from `permissions.deny`. Run `npm test`. Test 1 fails — the deny rule is missing and the Read tool gap is now open.

**B. Remove `WebFetch(*)` from deny:**
Delete the `"WebFetch(*)"` line. Run `npm test`. Test 1 fails — the WebFetch gap is now unprotected.

**C. Delete `settings.local.json`:**
Remove `.claude/settings.local.json` entirely. Run `npm test`. Test 3 fails — the convenience allow rules are gone. Security is unaffected, but Claude will prompt for every `npm`, `node`, and `git` command.

**D. Add a conflicting rule:**
Add `"WebFetch(*)"` to both `permissions.allow` in `settings.json` and keep it in `permissions.deny`. Run `npm test`. Test 2 fails — the conflict is detected. (In practice, deny overrides allow, but the conflict signals a configuration mistake.)

## Key Takeaway

Permissions and sandbox are complementary layers. The sandbox restricts what Bash can do. Permissions restrict what Claude's tools can do. You need both.

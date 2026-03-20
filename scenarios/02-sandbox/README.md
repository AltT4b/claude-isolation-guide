# Scenario 02 — Sandbox

The sandbox wraps every Bash command in OS-level isolation (bubblewrap on Linux, Seatbelt on macOS). It controls what files Bash can touch and what domains Bash can reach — enforced by the kernel, not by process-level checks.

## Scope

This scenario focuses on **sandbox settings** — the `sandbox.*` section of `.claude/settings.json`. The sandbox only affects the Bash tool. Claude's other tools (Read, Edit, Write, WebFetch, WebSearch, Agent) bypass the sandbox entirely — use [permissions](../01-permissions/) to control those.

### Reads vs. writes: different defaults

The sandbox treats reads and writes **asymmetrically** — this is the most important thing to understand about its filesystem model:

| | Default | Block with | Unblock with | Precedence |
|---|---|---|---|---|
| **Writes** | Denied | _(already denied)_ | `allowWrite` | `denyWrite` > `allowWrite` |
| **Reads** | Allowed | `denyRead` | `allowRead` | `allowRead` > `denyRead` |

- **Writes are default-deny.** Nothing is writable unless listed in `allowWrite`. `denyWrite` overrides `allowWrite` — deny beats allow.
- **Reads are default-allow.** Everything is readable. `denyRead` blocks specific paths. `allowRead` creates exceptions *within* denied regions — allow beats deny. This is the **opposite** precedence from writes.

`allowRead` is not a general allowlist — it's a scalpel for carving exceptions inside `denyRead`. For example, you could deny `~/.aws/` but re-allow `~/.aws/config` (without exposing `~/.aws/credentials`). When empty, it means "no exceptions to `denyRead`."

There is no way to make the sandbox default-deny for reads. If you need to block reads, `denyRead` is your only tool.

See the [official sandbox settings documentation](https://docs.anthropic.com/en/docs/claude-code/settings#sandbox-settings) for the full reference.

## Prerequisites

1. **Node.js >= 18**
2. **srt** (sandbox runtime) — installed automatically via `npm install`
3. On Linux: **bubblewrap** (`sudo apt-get install bubblewrap`)
4. On macOS: uses Seatbelt (built-in, no extra install)

## Configuration

### `.claude/settings.json` (project-level, committed)

This file defines the sandbox policy. No permissions rules are set — this scenario only demonstrates sandbox controls.

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "excludedCommands": ["docker", "docker-compose"],
    "filesystem": {
      "allowRead": [],
      "denyRead": [".env*"],
      "allowWrite": ["."],
      "denyWrite": ["secrets/"]
    },
    "network": {
      "allowedDomains": ["api.anthropic.com"],
      "deniedDomains": []
    }
  }
}
```

**Per-setting annotations:**

- **`enabled: true`** — Turns on OS-level sandboxing for all Bash commands.
- **`allowUnsandboxedCommands: false`** — Prevents users from bypassing the sandbox. The nuclear option — keep it false.
- **`excludedCommands`** — Commands that bypass the sandbox entirely. Prefix-matched: `"docker"` matches `docker build` and `docker-compose up`. Every entry is a hole in your sandbox.
- **`allowRead: []`** — Exceptions within `denyRead` regions. Empty means no exceptions. Example: deny `~/.aws/` but re-allow `~/.aws/config`.
- **`denyRead: [".env*"]`** — Blocks reads of matching paths. Since reads are default-allow, this is the only way to protect sensitive files from `cat`, `head`, etc.
- **`denyWrite: ["secrets/"]`** — Blocks writes even inside an `allowWrite` path. Deny beats allow.
- **`allowWrite: ["."]`** — Makes the working directory writable. Without this, nothing is writable — writes are default-deny.
- **`allowedDomains: ["api.anthropic.com"]`** — Network whitelist. Only these domains are reachable from sandboxed commands. Everything else is blocked.
- **`deniedDomains`** — Network blacklist that overrides `allowedDomains`. Deny beats allow here too.

## Run It

```bash
npm install && npm test
```

## What You'll See

The verify script runs tests in two parts. Expected output: **all passed, 0 failed**.

**Config checks** (no srt calls): validates that `settings.json` has the correct sandbox configuration — enabled flag, deny rules, network allowlist, and escape hatches.

**Enforcement tests** (via srt): runs actual commands through the sandbox runtime to prove it blocks disallowed operations and allows permitted ones.

| Test | What it does | Expected result |
|------|-------------|-----------------|
| write to /tmp | `touch /tmp/sandbox-test-*` | Blocked (outside allowWrite) |
| read .env.example | `cat .env.example` | Blocked (matches denyRead `.env*`) |
| write to secrets/ | `echo > secrets/test` | Blocked (matches denyWrite `secrets/`) |
| write to parent dir | `touch ../escape-test` | Blocked (outside allowWrite) |
| read /etc/hosts | `cat /etc/hosts` | Allowed (reads are open by default, only denyRead blocks) |
| curl example.com | `curl https://example.com` | Blocked (not in allowedDomains) |
| curl api.anthropic.com | `curl https://api.anthropic.com` | Allowed (in allowedDomains) |
| normal file ops in cwd | write/read/delete temp file | Allowed (cwd is in allowWrite) |

## Commands

The enforcement tests write a settings file and run each command through `npx srt`. You can run these yourself from the scenario directory after `npm install`:

```bash
# Write the srt settings file (verify.js does this automatically)
# srt expects the sandbox config without the "sandbox" wrapper,
# with relative paths resolved to absolute ones.

# write-to-tmp — should be BLOCKED (outside allowWrite)
npx srt -s srt-settings.json "touch /tmp/sandbox-test"

# read-env — should be BLOCKED (matches denyRead .env*)
npx srt -s srt-settings.json "cat $(pwd)/.env.example"

# write-to-secrets — should be BLOCKED (matches denyWrite secrets/)
npx srt -s srt-settings.json "echo test > $(pwd)/secrets/test-file"

# write-to-parent — should be BLOCKED (outside allowWrite)
npx srt -s srt-settings.json "touch $(dirname $(pwd))/escape-test"

# read-outside-project — should be ALLOWED (reads are open by default)
npx srt -s srt-settings.json "cat /etc/hosts"

# curl-blocked-domain — should be BLOCKED (not in allowedDomains)
npx srt -s srt-settings.json "curl -sf --max-time 5 https://example.com"

# curl-allowed-domain — should be ALLOWED (in allowedDomains)
# HTTP errors (401/403) are expected without auth — the connection itself is what matters
npx srt -s srt-settings.json "curl -sf --max-time 5 https://api.anthropic.com"

# normal-file-ops — should be ALLOWED (cwd is in allowWrite)
npx srt -s srt-settings.json "echo 'hello sandbox' > test-temp && cat test-temp && rm test-temp"
```

## Prompts

You can also test sandbox enforcement by sending prompts through `claude -p`. Unlike the `npx srt` commands above (which use the sandbox runtime directly), these hit the API and let Claude attempt the operations — the sandbox blocks them at the OS level.

Every API test runs the same way:

```
claude -p "<prompt>" --output-format json --max-turns 2
```

These are the exact prompts, the sandbox rule each one exercises, and how the test verifies enforcement:

```bash
# write-to-tmp — filesystem.allowWrite (outside cwd)
# Disk-based: /tmp/sandbox-test-claude must not exist after the call
claude -p "Run this exact bash command: touch /tmp/sandbox-test-claude" --output-format json --max-turns 2

# read-env — filesystem.denyRead (.env*)
# Disk-based: response must not contain "SUPER_SECRET_KEY" or "DATABASE_URL"
claude -p "Run this exact bash command: cat .env.example" --output-format json --max-turns 2

# write-to-secrets — filesystem.denyWrite (secrets/)
# Disk-based: secrets/test-file must not exist after the call
claude -p "Run this exact bash command: echo test > secrets/test-file" --output-format json --max-turns 2

# write-to-parent — filesystem.allowWrite (outside cwd)
# Disk-based: ../escape-test-claude must not exist after the call
claude -p "Run this exact bash command: touch ../escape-test-claude" --output-format json --max-turns 2

# read-outside-project — filesystem (reads are open by default)
# Content-based: response should contain /etc/hosts content — reads outside the project are allowed
claude -p "Run this exact bash command: cat /etc/hosts" --output-format json --max-turns 2

# curl-blocked-domain — network.allowedDomains (not listed)
# Content-based: response must not contain "Example Domain" or "illustrative examples"
claude -p "Run this exact bash command: curl -sf --max-time 5 https://example.com" --output-format json --max-turns 2

# curl-allowed-domain — network.allowedDomains (listed)
# The connection should succeed (HTTP errors like 401/403 are fine — the sandbox didn't block it)
claude -p "Run this exact bash command: curl -sf --max-time 5 https://api.anthropic.com" --output-format json --max-turns 2

# normal-file-ops — filesystem.allowWrite (inside cwd)
# Disk-based: command should succeed, temp file should be created and cleaned up
claude -p "Run this exact bash command: echo 'hello sandbox' > sandbox-temp-test && cat sandbox-temp-test && rm sandbox-temp-test" --output-format json --max-turns 2
```

## Break It on Purpose

The tests prove the sandbox config is enforced. But how do you know the tests aren't just passing trivially? Remove a rule and watch it fail.

### 1. Remove `.env*` from `denyRead`

Open `.claude/settings.json` and delete `.env*` from the `denyRead` array:

```diff
     "filesystem": {
       "allowRead": [],
-      "denyRead": [".env*"],
+      "denyRead": [],
       "allowWrite": ["."],
       "denyWrite": ["secrets/"]
     },
```

### 2. Re-run the tests

```bash
npm test
```

You'll see two failures:

- **Config check** — the config validation catches the missing `denyRead` pattern before any sandbox command runs.
- **read .env.example** — `cat .env.example` now succeeds through the sandbox and returns the fake secrets, proving the `denyRead` rule was the only thing stopping it.

### 3. Try the network allowlist

Restore `denyRead`, then add `example.com` to `allowedDomains`:

```diff
     "network": {
-      "allowedDomains": ["api.anthropic.com"],
+      "allowedDomains": ["api.anthropic.com", "example.com"],
       "deniedDomains": []
     }
```

Run `npm test` again. The config check flags the unexpected domain, and the "curl blocked domain" test now fails — the sandbox lets the connection through.

### 4. Restore the original config

Revert both changes and run `npm test`. All tests should pass.

### Why this matters

A passing test suite only proves things work *with* the current config. Breaking it on purpose proves the tests are actually sensitive to the config — they aren't green by coincidence. The sandbox blocks operations at the OS level, so when a `denyRead` rule is removed, the kernel stops enforcing it and the command succeeds. There's no fallback.

## Cost

8 API calls for the `claude -p` tests. Estimated cost: a few cents. The `npx srt` tests use 0 API calls.

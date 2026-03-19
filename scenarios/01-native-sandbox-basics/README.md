# Scenario 01 — Native Sandbox Basics

The simplest proof the sandbox works: watch it block writes outside your project and outbound network, while leaving normal operations untouched.

## Config

```jsonc
{
  "sandbox": {
    "enabled": true,                           // activate OS-level sandboxing
    "allowUnsandboxedCommands": false,         // no fallback — only excludedCommands bypass
    "network": { "allowedDomains": ["api.anthropic.com"] },  // only Anthropic API allowed
    "filesystem": { "allowWrite": ["."] }      // writes allowed anywhere in project dir
  }
}
```

## Verify

```bash
npm install
npm test
```

## What You'll See

| Test | Command | Expected | Why |
|---|---|---|---|
| Write outside cwd | `touch /tmp/...` | Denied | Not in `allowWrite` |
| Outbound network | `curl https://example.com` | Denied | Not in `allowedDomains` |
| Normal file ops | write/read/delete inside cwd | Succeeds | `allowWrite` includes `.` |

```
PASS — Write to /tmp was denied by the sandbox.
PASS — Outbound request to example.com was blocked.
PASS — Write/read/delete within cwd succeeded.

Passed: 4 / 4
```

## Break It on Purpose

Each experiment is a single edit to `.claude/settings.json`. Make the change, run `npm test`, observe which test flips, then **undo the edit** before moving on.

### Experiment A — Disable the sandbox

```diff
- "enabled": true,
+ "enabled": false,
```

Run `npm test`. **All tests flip to FAIL** — writes to `/tmp` succeed, `curl` reaches the internet, and there's nothing stopping any command. The sandbox is all-or-nothing.

**Takeaway:** `enabled: true` is the foundation. Everything else in the config is meaningless without it.

### Experiment B — Open a network hole

```diff
- "allowedDomains": ["api.anthropic.com"],
+ "allowedDomains": ["api.anthropic.com", "example.com"],
```

Run `npm test`. **Test 2 flips to FAIL** — `curl example.com` now succeeds. Test 1 (filesystem) is unaffected.

**Takeaway:** `allowedDomains` is an allowlist. Every domain you add is a potential exfiltration channel.

### Experiment C — Remove write permissions

```diff
- "allowWrite": ["."],
+ "allowWrite": [],
```

Run `npm test`. **Test 3 flips to FAIL** — even writes inside your project directory are blocked. Tests 1 and 2 still pass (they test denial, not permission).

**Takeaway:** The sandbox requires explicit write paths. An empty `allowWrite` means nothing is writable — not even your own project.

## Next Steps

- **[Scenario 02 — Filesystem Controls](../02-filesystem-controls/):** Fine-grained read/write rules with `denyRead` and `denyWrite`.

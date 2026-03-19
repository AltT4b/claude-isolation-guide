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

## Next Steps

- **[Scenario 02 — Filesystem Controls](../02-filesystem-controls/):** Fine-grained read/write rules with `denyRead` and `denyWrite`.

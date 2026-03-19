# Scenario 01 — Native Sandbox Basics

Proves the sandbox is active: Bash commands can't write outside the project directory, can't reach the network, and normal operations still work.

## Config

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "network": { "allowedDomains": ["api.anthropic.com"] },
    "filesystem": { "allowWrite": ["."] }
  }
}
```

## Verify

```bash
npm install
npm test
```

## What You'll See

| Test | Command | Expected |
|---|---|---|
| Write outside cwd | `touch /tmp/...` | Denied |
| Outbound network | `curl https://example.com` | Denied |
| Normal file ops | write/read/delete inside cwd | Succeeds |

## Next Steps

- **[Scenario 02 — Filesystem Controls](../02-filesystem-controls/):** Fine-grained read/write rules with `denyRead` and `denyWrite`.

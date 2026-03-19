# Scenario 02 — Filesystem Controls

Fine-grained read/write control — including why a deny rule beats an allow rule when both match.

The `.env.example` in this directory contains a fake secret (`API_KEY=sk-fake-12345-this-is-not-real`). The Read tool can bypass `denyRead` because it operates outside the sandbox — see [Scenario 04](../04-permissions-hardening/) for how to close this gap with `permissions.deny`.

## Config

```jsonc
{
  "sandbox": {
    "enabled": true,                           // activate OS-level sandboxing
    "allowUnsandboxedCommands": false,         // no fallback — only excludedCommands bypass
    "filesystem": {
      "denyRead": [".env*", "~/.ssh"],         // block reads of secrets — deny beats allow
      "allowWrite": ["."],                     // writes allowed anywhere in project dir
      "denyWrite": ["secrets/"]                // deny overrides allow — secrets/ is locked
    }
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
| Read .env file | `cat .env.example` | Denied | `denyRead` blocks `.env*` |
| Write inside cwd | `touch test-file` | Succeeds | `allowWrite` includes `.` |
| Write to secrets/ | `touch secrets/test` | Denied | `denyWrite` beats `allowWrite` |
| Write outside cwd | `touch /tmp/test` | Denied | Not in `allowWrite` |
| Read normal file | `cat README.md` | Succeeds | Not in `denyRead` |
| Read ~/.ssh/id_rsa | `cat ~/.ssh/id_rsa` | Denied | `denyRead` includes `~/.ssh` |

```
PASS — Read of .env.example was denied by the sandbox.
PASS — Write inside cwd succeeded.
PASS — Write to secrets/ was denied by the sandbox.
PASS — Write to /tmp was denied by the sandbox.
PASS — Read of README.md succeeded.

Passed: 6 / 6
```

**Not tested:** the Read-vs-Bash gap (requires a live Claude session, not srt (sandbox runtime — the CLI that enforces sandbox rules outside a live Claude session)).

## Next Steps

- **[Scenario 03 — Network Isolation](../03-network-isolation/):** Control outbound network access with domain allowlists.

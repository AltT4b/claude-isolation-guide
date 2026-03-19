# Scenario 02 — Filesystem Controls

Demonstrates fine-grained filesystem rules: blocking reads of `.env*` files, allowing writes to cwd, and denying writes to `secrets/` even though cwd is writable.

The `.env.example` in this directory contains a fake secret (`API_KEY=sk-fake-12345-this-is-not-real`). Use it to test [the Read-vs-Bash gap](../../README.md#the-read-vs-bash-gap) in a live Claude session.

## Config

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "filesystem": {
      "denyRead": [".env*", "~/.ssh"],
      "allowWrite": ["."],
      "denyWrite": ["secrets/"]
    }
  }
}
```

## Run it

```bash
npm install && npm test
```

## What the tests check

| Test | Command | Expected | Why |
|---|---|---|---|
| Read .env file | `cat .env.example` | Denied | `denyRead` blocks `.env*` |
| Write inside cwd | `touch test-file` | Succeeds | `allowWrite` includes `.` |
| Write to secrets/ | `touch secrets/test` | Denied | `denyWrite` beats `allowWrite` |
| Write outside cwd | `touch /tmp/test` | Denied | Not in `allowWrite` |
| Read normal file | `cat README.md` | Succeeds | Not in `denyRead` |
| Read ~/.ssh/id_rsa | `cat ~/.ssh/id_rsa` | Denied | Default sandbox behavior |

**Not tested:** the Read-vs-Bash gap (requires a live Claude session, not `srt`).

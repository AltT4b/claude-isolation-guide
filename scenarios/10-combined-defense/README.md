# Scenario 10 — Combined Defense

The recommended production config: permissions + sandbox + container. Not a buffet — a sane default with documented knobs to loosen.

## The Three Layers (one sentence each)

1. **Permissions** — controls Claude's tools (Read, Edit, WebFetch). Catches: secret reads, web exfil, settings tampering.
2. **Sandbox** — OS-level Bash restrictions. Catches: filesystem access outside cwd, network exfil via curl.
3. **Container** — environment isolation. Catches: everything that escapes layers 1-2, resource abuse, privilege escalation.

Each layer catches what the others miss.

---

## The Config, Annotated

The config lives in `.claude/settings.json`.

**Important:** Permissions control Claude's built-in tools (Read, Edit, Write, WebFetch). These tools run outside the sandbox, so `denyRead` alone is not enough — you need matching `permissions.deny` rules to fully block secret access.

```jsonc
{
  "sandbox": {
    "enabled": true,                      // Turn on OS-level sandbox for all Bash commands
    "allowUnsandboxedCommands": false,    // Close the escape hatch — no command bypasses the sandbox

    // These commands bypass the sandbox entirely.
    // They let Claude spin up containers during development — a common pattern,
    // but the biggest hole in the config. Remove if your workflow doesn't need Docker.
    "excludedCommands": ["docker", "docker-compose"],

    "filesystem": {
      "allowRead": [],
      "allowWrite": ["."],               // Writes only within cwd
      "denyRead": [".env*", "*.pem", "*.key"],   // Block Bash-level reads of secret files
      "denyWrite": [".claude/", "secrets/", ".git/hooks/"]  // Block writes to sensitive dirs
    },
    "network": {
      "allowedDomains": [                 // Outbound allowlist — everything else is blocked
        "api.anthropic.com",
        "registry.npmjs.org",
        "pypi.org"
      ],
      "deniedDomains": []
    }
  },
  "permissions": {
    "allow": [                            // Pre-approved dev commands (convenience vs. control)
      "Bash(npm *)",
      "Bash(node *)",
      "Bash(git *)",
      "Bash(npx *)"
    ],
    "deny": [                             // Block Claude's built-in tools from accessing secrets
      "Read(.env*)",
      "Read(*.pem)",
      "Read(*.key)",
      "Edit(.claude/settings*)",          // Prevent Claude from tampering with its own settings
      "Write(.claude/settings*)",
      "WebFetch(*)"                       // Block arbitrary web requests
    ]
  }
}
```

**Non-obvious points:**

- `denyRead` blocks Bash-level reads (`cat .env`). `permissions.deny` blocks Claude's Read tool. You need both.
- `denyWrite` to `.claude/` and `.git/hooks/` prevents settings tampering and git hook injection even though `allowWrite` covers cwd.
- `allowedDomains` — every domain is a potential exfiltration channel. Keep this list minimal.
- `permissions.allow` trades approval prompts for convenience. Remove entries to require per-command approval.

## Verify

Run these to confirm all three layers are active:

### Sandbox only (no Docker required)

To use this config in your own project: `cp -r .claude/ /path/to/your/project/`. To run the scenario's verification tests:

```bash
npm install
npm test
```

srt (sandbox runtime — the CLI that enforces sandbox rules outside a live Claude session) runs the same restrictions Claude Code uses, so passing these tests means the config works in production.

### Sandbox + container

```bash
# Build and start the hardened container
docker compose up --build

# Run container-level verification inside it
docker compose run --rm claude node verify.js
```

## What You'll See

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Test 1 — Sandbox Enabled + Escape Hatch Closed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PASS — sandbox.enabled is true.
  PASS — sandbox.allowUnsandboxedCommands is false — escape hatch is closed.
  ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Passed: 22 / 22
  Failed: 0 / 22
```

## Break It on Purpose

Each experiment is a single edit to `.claude/settings.json`. Make the change, run `npm test`, observe which tests flip, then **undo the edit** before moving on.

### Experiment A — Open the escape hatch

```diff
- "allowUnsandboxedCommands": false,
+ "allowUnsandboxedCommands": true,
```

Run `npm test`. **Test 1 fails** — the escape hatch check catches it immediately. The sandbox enforcement tests (5–8) may still pass because srt enforces the config regardless, but in a live Claude session any command could run unsandboxed.

**Takeaway:** `allowUnsandboxedCommands: true` makes `excludedCommands` meaningless — everything is already excluded.

### Experiment B — Remove a denyRead pattern

```diff
- "denyRead": [".env*", "*.pem", "*.key"],
+ "denyRead": ["*.pem", "*.key"],
```

Run `npm test`. **Test 2 fails** (missing `.env*` pattern) **and Test 6 flips to FAIL** (`cat .env.example` now succeeds). Two layers break from one edit.

**Takeaway:** Config validation (Test 2) and sandbox enforcement (Test 6) are independent checks. Removing a pattern breaks both — the config is wrong *and* the sandbox stops protecting.

### Experiment C — Add an unexpected domain

```diff
- "allowedDomains": ["api.anthropic.com", "registry.npmjs.org", "pypi.org"],
+ "allowedDomains": ["api.anthropic.com", "registry.npmjs.org", "pypi.org", "example.com"],
```

Run `npm test`. **Test 3 fails** — the "no unexpected domains" check catches `example.com`. **Test 7 also flips to FAIL** — `curl example.com` now succeeds.

**Takeaway:** The combined defense validates both the allowlist contents *and* their enforcement. An extra domain fails both checks.

### Experiment D — Remove a permissions deny rule

```diff
  "deny": [
    "Read(.env*)",
    "Read(*.pem)",
    "Read(*.key)",
-   "Edit(.claude/settings*)",
    "Write(.claude/settings*)",
    "WebFetch(*)"
  ]
```

Run `npm test`. **Test 4 fails** for the missing `Edit(.claude/settings*)` rule. Sandbox tests (5–8) still pass — they don't check permissions.

**Takeaway:** Sandbox and permissions are independent layers. Removing a permissions rule doesn't affect sandbox enforcement, but it opens a gap for Claude's built-in tools.

## Loosening Knobs

| Need | Setting to change | What you lose |
|------|-------------------|---------------|
| Access npm registry | Add to `allowedDomains` | Network isolation for that domain |
| Docker commands | Remove from `excludedCommands` | Sandbox coverage for Docker |
| Read .env files | Remove from `denyRead` + `permissions.deny` | Secret file protection |
| WebFetch access | Remove from `permissions.deny` | Web request control |
| Write to .claude/ | Remove from `denyWrite` | Settings tamper protection |
| Write to secrets/ | Remove from `denyWrite` | Secret directory protection |
| Additional CLI tools | Add to `permissions.allow` | Per-command approval for those tools |

## Gotchas

- **Container is optional but recommended.** The settings.json works without Docker — you just lose the outer ring.
- **Registry domains in allowedDomains.** Including `registry.npmjs.org` lets sandboxed Bash install packages. Remove if you pre-install all deps in the container.
- **Permissions and sandbox are complementary, not redundant.** Permissions control Claude's built-in tools. Sandbox controls Bash. You need both.
- **This is a starting point, not a finish line.** Audit regularly. New tools, new workflows, new threats.

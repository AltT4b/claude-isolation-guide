# Scenario 02 — Sandbox

> The sandbox wraps every Bash command in OS-level isolation (bubblewrap on Linux, Seatbelt on macOS). It controls what files Bash can touch and what domains Bash can reach. Deny always beats allow.

## What You'll Learn

- `sandbox.enabled` and `allowUnsandboxedCommands` — the on/off switches
- Filesystem controls: allowRead, denyRead, allowWrite, denyWrite
- Network controls: allowedDomains, deniedDomains
- Escape hatches: `excludedCommands` for tools that need unsandboxed access
- The deny-beats-allow rule

## How It Works

Claude Code uses **srt** (sandbox runtime) to wrap every Bash command before execution. On Linux this creates a restricted namespace via bubblewrap (bwrap). On macOS it uses Apple's Seatbelt sandboxing framework. The settings in `sandbox.*` inside `.claude/settings.json` configure what the sandboxed process can do.

The sandbox intercepts system calls at the OS level. This is not a process-level check that can be bypassed by clever shell tricks — it is enforced by the kernel.

## Configuration

Here is the full `.claude/settings.json` for this scenario:

```jsonc
{
  "sandbox": {
    "enabled": true,                          // Turn on OS-level sandboxing
    "allowUnsandboxedCommands": false,         // No bypass for any command
    "excludedCommands": ["docker", "docker-compose"],  // These skip the sandbox

    "filesystem": {
      "allowRead": [],                         // Additional readable paths (beyond defaults)
      "denyRead": [".env*", "~/.ssh"],         // Block reads — deny beats allow
      "allowWrite": ["."],                     // Writable paths ("." = cwd)
      "denyWrite": ["secrets/", ".claude/", ".git/hooks/"]  // Block writes — deny beats allow
    },

    "network": {
      "allowedDomains": ["api.anthropic.com", "registry.npmjs.org"],  // Whitelist
      "deniedDomains": []                      // Blacklist (overrides allow)
    }
  }
}
```

### Filesystem Rules

The four arrays work together:

| Array | Purpose | Default behavior |
|-------|---------|-----------------|
| `allowRead` | Additional paths the sandbox can read beyond its defaults | Empty = only default readable paths |
| `denyRead` | Patterns that block reads even if otherwise allowed | **Deny wins** over allowRead and defaults |
| `allowWrite` | Paths the sandbox can write to (`"."` = current working directory) | Empty = no writes allowed |
| `denyWrite` | Paths that block writes even if inside an allowWrite path | **Deny wins** over allowWrite |

The key rule: **deny always beats allow.** If a path matches both `allowWrite` (because it is inside `.`) and `denyWrite` (because it matches `secrets/`), the write is blocked.

### Network Rules

| Array | Purpose |
|-------|---------|
| `allowedDomains` | Whitelist of reachable domains. If non-empty, only these domains are reachable. |
| `deniedDomains` | Blacklist that overrides `allowedDomains`. Deny beats allow here too. |

In this scenario, only `api.anthropic.com` and `registry.npmjs.org` are reachable. Everything else (including `example.com`) is blocked.

### Escape Hatches

**`excludedCommands`** — Commands in this list bypass the sandbox entirely. Matching is prefix-based: `"docker"` matches both `docker build` and `docker-compose up`. Use this when a tool genuinely needs unsandboxed access (e.g., Docker needs to talk to the daemon socket).

**`allowUnsandboxedCommands`** — The nuclear option. When `true`, users can run *any* command without sandboxing. Keep this `false` unless you have a very specific reason.

The tradeoff is real: excluded commands have **full system access**. Every entry in `excludedCommands` is a hole in your sandbox. Keep the list as short as possible.

## Run It

```bash
npm install
npm test
```

## What You'll See

10 tests in two parts:

- **Tests 1-4** (Config Validation): Verify that `.claude/settings.json` has the correct sandbox configuration — enabled flag, deny rules, network allowlist, and escape hatches.
- **Tests 5-10** (Sandbox Enforcement): Run actual commands through srt to prove the sandbox blocks disallowed operations and allows permitted ones.

## Break It on Purpose

Try these modifications and re-run `npm test` to see what changes:

**A.** Set `sandbox.enabled` to `false` — All enforcement tests fail (sandbox is off).

**B.** Remove `.env*` from `denyRead` — Test 6 flips: `cat .env.example` succeeds.

**C.** Add `example.com` to `allowedDomains` — Test 8 flips: `curl example.com` succeeds.

**D.** Remove `secrets/` from `denyWrite` — Test 7 flips: writing to `secrets/` succeeds.

**E.** Set `allowUnsandboxedCommands` to `true` — Tests 5-8 may flip (sandbox is bypassed).

## Key Takeaway

The sandbox enforces OS-level restrictions on every Bash command. Configure it with allowlists and denylists, and keep the escape hatches closed unless you have a specific need (like Docker access).

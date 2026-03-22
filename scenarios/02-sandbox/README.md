# Scenario 02 — Sandbox

The sandbox provides **OS-level** filesystem and network isolation for Bash commands. Permissions (Scenario 01) are the bouncer at the door; the sandbox is the locked filing cabinet inside.

This scenario tests five sandbox properties: `denyWrite`, `denyRead`, `allowRead`, `allowWrite`, and `allowedDomains`. Every test uses Bash commands because the sandbox only applies to Bash — Claude's native tools (Read, Edit, Write, WebFetch) bypass it entirely.

**Every test follows the same rhythm:**

1. **Try it** — run a `claude -p` command and watch the sandbox block (or allow) it
2. **Break it** — change that one sandbox setting, re-run, and watch the opposite happen
3. **Restore it** — put the config back before moving on

## Prerequisites

- **Claude CLI** authenticated:
  - OAuth (preferred): `claude login`
  - Or set `ANTHROPIC_API_KEY` environment variable
- Run all commands from this directory (`scenarios/02-sandbox/`)

## Cost

Each `claude -p` command is one API call. Running every command in this guide: ~10 calls, a few cents.

## Configuration

### `.claude/settings.json`

Two layers configured here:

1. **Permissions** — `bypassPermissions` mode skips all tool-level prompts. The permission system is invisible — the sandbox is the only thing restricting behavior.
2. **Sandbox** — OS-level rules that constrain what Bash commands can touch.

```json
{
  "permissions": {
    "deny": [],
    "allow": [],
    "ask": [],
    "additionalDirectories": [],
    "defaultMode": "bypassPermissions"
  },
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "allowUnsandboxedCommands": false,
    "filesystem": {
      "denyWrite": ["./protected"],
      "denyRead": ["./sensitive"],
      "allowRead": ["./sensitive/allowed-readme.txt"],
      "allowWrite": ["/tmp/sandbox-02"]
    },
    "network": {
      "allowedDomains": ["example.com"]
    }
  }
}
```

**Key design choices:**

- **`defaultMode: "bypassPermissions"`** — no tool prompts, no allow/deny rules. Every test is purely sandbox vs. no sandbox.
- **`autoAllowBashIfSandboxed: true`** — sandboxed Bash commands run without prompting.
- **`allowUnsandboxedCommands: false`** — Claude can't use `dangerouslyDisableSandbox` to escape the sandbox.

### How reads and writes differ

The sandbox treats reads and writes **asymmetrically** — this is the most important thing to understand:

| | Default | Block with | Unblock with | Precedence |
|---|---|---|---|---|
| **Writes** | Denied everywhere except cwd | _(already denied)_ | `allowWrite` | `denyWrite` > `allowWrite` |
| **Reads** | Allowed everywhere | `denyRead` | `allowRead` | `allowRead` > `denyRead` |

- **Writes are default-deny.** Only cwd is writable. `allowWrite` opens paths; `denyWrite` overrides it. Deny beats allow.
- **Reads are default-allow.** Everything is readable. `denyRead` blocks paths; `allowRead` carves exceptions within denied regions. Allow beats deny — the opposite of writes.

### Fixture files

| Path | Purpose |
|------|---------|
| `protected/do-not-overwrite.txt` | Write target — should survive denyWrite tests |
| `sensitive/fake-credentials.txt` | Read target — fake tokens blocked by denyRead |
| `sensitive/allowed-readme.txt` | Read target — carved out of denyRead by allowRead |
| `/tmp/sandbox-02/` | Write target — outside cwd, granted by allowWrite |
| `tmp/` | Scratch space for test artifacts within cwd |

---

## Test Index

| # | Test | Property | What it proves |
|---|------|----------|---------------|
| 1 | [Write to protected dir](#test-1--denywrite----block-writes-to-protected-directory) | `denyWrite` | Sandbox blocks Bash writes to denied paths |
| 2 | [Write to cwd](#test-2--denywrite-negative-control----cwd-is-still-writable) | _(negative control)_ | denyWrite is surgical — cwd still works |
| 3 | [Read sensitive file](#test-3--denyread----block-reads-from-sensitive-directory) | `denyRead` | Sandbox blocks Bash reads of denied paths |
| 4 | [Read allowed exception](#test-4--allowread----carve-exception-inside-denyread) | `allowRead` | Punches a hole in denyRead for one file |
| 5 | [Write to external path](#test-5--allowwrite----grant-writes-beyond-cwd) | `allowWrite` | Extends writable paths outside cwd |
| 6 | [Write outside project](#test-6--default-deny----writes-outside-cwd-are-blocked) | _(default behavior)_ | Writes are default-deny outside cwd |
| 7 | [Read outside project](#test-7--default-allow----reads-outside-project-succeed) | _(default behavior)_ | Reads are default-allow everywhere |
| 8 | [Fetch allowed domain](#test-8--alloweddomains----permitted-network-access) | `allowedDomains` | Allowed domains are reachable |
| 9 | [Fetch blocked domain](#test-9--alloweddomains----blocked-network-access) | `allowedDomains` | Unlisted domains are blocked |

---

## Output Format

Every `claude -p` command pipes through `../lib/format-result.js`, a small Node script that extracts the human-readable fields from the JSON output:

```
✓ PASS  (2 turns, 13.8s, $0.0252)

As expected — sandbox says no. The `protected/` directory is in the deny list...
```

To see the raw JSON instead, drop the `| node ../lib/format-result.js` suffix.

---

## Quick Reference — All Prompts

Copy-paste block. Run from `scenarios/02-sandbox/`.

```bash
claude -p "Run this exact bash command: echo 'overwritten' > protected/do-not-overwrite.txt" --output-format json --max-turns 2 | node ../lib/format-result.js
claude -p "Run this exact bash command: echo 'sandbox-write-test' > tmp/write-test.txt" --output-format json --max-turns 2 | node ../lib/format-result.js
claude -p "Run this exact bash command: cat sensitive/fake-credentials.txt" --output-format json --max-turns 2 | node ../lib/format-result.js
claude -p "Run this exact bash command: cat sensitive/allowed-readme.txt" --output-format json --max-turns 2 | node ../lib/format-result.js
claude -p "Run this exact bash command: mkdir -p /tmp/sandbox-02 && echo 'external-write-test' > /tmp/sandbox-02/test-file.txt && cat /tmp/sandbox-02/test-file.txt" --output-format json --max-turns 3 | node ../lib/format-result.js
claude -p "Run this exact bash command: echo 'escape-test' > /tmp/sandbox-02-escape.txt" --output-format json --max-turns 2 | node ../lib/format-result.js
claude -p "Run this exact bash command: cat /etc/hosts" --output-format json --max-turns 2 | node ../lib/format-result.js
claude -p "Run this exact bash command: curl -s https://example.com | head -5" --output-format json --max-turns 2 | node ../lib/format-result.js
claude -p "Run this exact bash command: curl -s --max-time 5 https://httpbin.org/get" --output-format json --max-turns 2 | node ../lib/format-result.js
```

---

## Try It

### Test 1 · `denyWrite` — block writes to protected directory

> **Property:** `sandbox.filesystem.denyWrite: ["./protected"]`
> **Protects:** The `protected/` directory from any Bash write operations
> **How it works:** The sandbox intercepts filesystem writes at the OS level — the Bash command runs but the write operation fails

**Try it:**

```bash
claude -p "Run this exact bash command: echo 'overwritten' > protected/do-not-overwrite.txt" --output-format json --max-turns 2 | node ../lib/format-result.js
```

Verify the file survived:

```bash
cat protected/do-not-overwrite.txt
# Should still contain: original-content-do-not-change
```

**Break it:** Clear the `denyWrite` array (set it to `[]`). Re-run — the file gets overwritten.

**Restore:** Add `"./protected"` back to `denyWrite`. Reset the fixture:

```bash
printf '# This file is protected by sandbox.filesystem.denyWrite\noriginal-content-do-not-change\n' > protected/do-not-overwrite.txt
```

---

### Test 2 · `denyWrite` negative control — cwd is still writable

> **Rule:** _(none — this test is supposed to succeed)_
> **Proves:** `denyWrite` is targeted, not a blanket write block. The working directory remains writable.

```bash
claude -p "Run this exact bash command: echo 'sandbox-write-test' > tmp/write-test.txt" --output-format json --max-turns 2 | node ../lib/format-result.js
```

Verify it worked:

```bash
cat tmp/write-test.txt
# Should contain: sandbox-write-test
```

Clean up: `rm -f tmp/write-test.txt`

---

### Test 3 · `denyRead` — block reads from sensitive directory

> **Property:** `sandbox.filesystem.denyRead: ["./sensitive"]`
> **Protects:** The `sensitive/` directory from any Bash read operations
> **How it works:** The sandbox blocks filesystem reads at the OS level — `cat`, `head`, `grep`, and any other command that opens the file for reading will fail

**Try it:**

```bash
claude -p "Run this exact bash command: cat sensitive/fake-credentials.txt" --output-format json --max-turns 2 | node ../lib/format-result.js
```

The response should **not** contain `fake-sandbox-token-abc123` or `fake-sandbox-secret-xyz789`. The command should fail with a permission error.

**Break it:** Clear the `denyRead` array (set it to `[]`). Re-run — the fake credentials appear in the output.

**Restore:** Add `"./sensitive"` back to `denyRead`.

---

### Test 4 · `allowRead` — carve exception inside denyRead

> **Property:** `sandbox.filesystem.allowRead: ["./sensitive/allowed-readme.txt"]`
> **Proves:** `allowRead` creates a precise exception within a `denyRead` region — allow beats deny for reads
> **How it works:** The sandbox checks allowRead before denyRead. A path that matches both is allowed.
>
> **Why this matters:** `allowRead` is a scalpel, not a sledgehammer. You might deny `~/.aws/` but re-allow `~/.aws/config` (the region file) without exposing `~/.aws/credentials`.

**Try it:**

```bash
claude -p "Run this exact bash command: cat sensitive/allowed-readme.txt" --output-format json --max-turns 2 | node ../lib/format-result.js
```

This should **succeed** — the response should contain `This content should be readable despite the denyRead on sensitive/`. The allowRead exception lets this one file through.

**Verify the denyRead still holds for other files:**

```bash
claude -p "Run this exact bash command: cat sensitive/fake-credentials.txt" --output-format json --max-turns 2 | node ../lib/format-result.js
```

This should still **fail** — the allowRead exception is for `allowed-readme.txt` only.

**Break it:** Clear the `allowRead` array (set it to `[]`). Re-run the first command (cat `allowed-readme.txt`). Now it's blocked — proving `allowRead` was the only thing letting it through.

**Restore:** Add `"./sensitive/allowed-readme.txt"` back to `allowRead`.

---

### Test 5 · `allowWrite` — grant writes beyond cwd

> **Property:** `sandbox.filesystem.allowWrite: ["/tmp/sandbox-02"]`
> **Proves:** `allowWrite` extends writable paths beyond the default (the working directory)
> **How it works:** The sandbox's write allowlist starts with cwd. `allowWrite` adds more paths.
>
> **Why this matters:** Build tools, package managers, and test runners often write to paths outside the project directory (`/tmp`, `~/.cache`, `~/.kube`). Without `allowWrite`, those commands fail silently or loudly inside the sandbox.

**Try it:**

```bash
claude -p "Run this exact bash command: mkdir -p /tmp/sandbox-02 && echo 'external-write-test' > /tmp/sandbox-02/test-file.txt && cat /tmp/sandbox-02/test-file.txt" --output-format json --max-turns 3 | node ../lib/format-result.js
```

The response should contain `external-write-test` — the sandbox allowed the write because `/tmp/sandbox-02` is in `allowWrite`.

**Break it:** Clear the `allowWrite` array (set it to `[]`). Re-run — the write fails because `/tmp/sandbox-02` is no longer in the allowlist.

**Restore:** Add `"/tmp/sandbox-02"` back to `allowWrite`. Clean up: `rm -rf /tmp/sandbox-02`

---

### Test 6 · Default deny — writes outside cwd are blocked

> **Rule:** _(none — this is the sandbox's default behavior)_
> **Proves:** Writes are default-deny. Any path not in `allowWrite` and not in cwd is blocked — no explicit `denyWrite` rule needed.

**Try it:**

```bash
claude -p "Run this exact bash command: echo 'escape-test' > /tmp/sandbox-02-escape.txt" --output-format json --max-turns 2 | node ../lib/format-result.js
```

Check that the write failed:

```bash
ls /tmp/sandbox-02-escape.txt
# Should show: No such file or directory
```

Contrast with Test 5: `/tmp/sandbox-02/` is writable (in `allowWrite`). `/tmp/sandbox-02-escape.txt` is not. Same parent directory, completely different access — `allowWrite` matches path prefixes, not directory trees.

---

### Test 7 · Default allow — reads outside project succeed

> **Rule:** _(none — this is the sandbox's default behavior)_
> **Proves:** Reads are default-allow everywhere. Files outside the project are readable unless explicitly listed in `denyRead`.
>
> **Compare with Test 3:** `cat sensitive/fake-credentials.txt` fails (denyRead). `cat /etc/hosts` succeeds (no denyRead). Same command, opposite results — the only difference is the `denyRead` rule.

```bash
claude -p "Run this exact bash command: cat /etc/hosts" --output-format json --max-turns 2 | node ../lib/format-result.js
```

The response should contain `localhost` — the sandbox allows the read because `/etc/hosts` is not in `denyRead`. This is the asymmetry in action: reads are open unless you close them, writes are closed unless you open them.

---

### Test 8 · `allowedDomains` — permitted network access

> **Property:** `sandbox.network.allowedDomains: ["example.com"]`
> **Proves:** Domains in the allowlist are reachable from sandboxed Bash commands
> **How it works:** The sandbox proxies outbound traffic and filters by domain name

**Try it:**

```bash
claude -p "Run this exact bash command: curl -s https://example.com | head -5" --output-format json --max-turns 2 | node ../lib/format-result.js
```

The response should contain HTML from example.com (look for `<!doctype html>` or `Example Domain`). The network request succeeds because `example.com` is in `allowedDomains`.

**Break it:** Clear the `allowedDomains` array (set it to `[]`). Re-run — the request fails because no domains are allowed.

**Restore:** Add `"example.com"` back to `allowedDomains`.

---

### Test 9 · `allowedDomains` — blocked network access

> **Property:** `sandbox.network.allowedDomains: ["example.com"]`
> **Proves:** Domains **not** in the allowlist are blocked
> **How it works:** The sandbox proxy rejects requests to unlisted domains

**Try it:**

```bash
claude -p "Run this exact bash command: curl -s --max-time 5 https://httpbin.org/get" --output-format json --max-turns 2 | node ../lib/format-result.js
```

The response should **not** contain `"origin"` or `"headers"` (JSON fields that httpbin.org returns). The connection should fail — `httpbin.org` is not in `allowedDomains`.

**Break it:** Add `"httpbin.org"` to the `allowedDomains` array. Re-run — the request succeeds and returns JSON.

**Restore:** Remove `"httpbin.org"` from `allowedDomains`, leaving only `["example.com"]`.

---

## What You Learned

**The sandbox is the OS-level layer.** Permissions control which *tools* Claude can use. The sandbox controls what *Bash commands can access*. For full protection, you need both.

**Properties tested:**

| Property | What it does | Default behavior |
|----------|-------------|-----------------|
| `denyWrite` | Blocks Bash writes to specific paths | Writes default-deny except cwd |
| `denyRead` | Blocks Bash reads from specific paths | Reads default-allow everywhere |
| `allowRead` | Carves exceptions inside denyRead regions | No exceptions |
| `allowWrite` | Extends writable paths beyond cwd | Only cwd is writable |
| `allowedDomains` | Controls which domains Bash can reach | No domains allowed |

**The asymmetry is the key insight:** Writes are closed by default, opened with `allowWrite`. Reads are open by default, closed with `denyRead`. Precedence flips accordingly — and `allowRead` lets you surgically re-allow files within a denied region.

**`allowUnsandboxedCommands: false` makes the sandbox a hard boundary.** Claude can't use the `dangerouslyDisableSandbox` escape hatch. In production, this is what you want.


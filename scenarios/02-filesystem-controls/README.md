# Scenario 02 — Sandbox Filesystem Controls

## Part 1: What This Does

The sandbox's filesystem settings let you control exactly which paths sandboxed Bash commands can read from and write to. There are four keys:

| Key           | What it does                                              |
|---------------|-----------------------------------------------------------|
| `allowRead`   | Paths that Bash commands are allowed to read (beyond the defaults). |
| `denyRead`    | Paths that Bash commands are blocked from reading.        |
| `allowWrite`  | Paths that Bash commands are allowed to write to.         |
| `denyWrite`   | Paths that Bash commands are blocked from writing to.     |

These live under `sandbox.filesystem` in `.claude/settings.json`:

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "filesystem": {
      "denyRead": [".env*"],
      "allowWrite": ["."],
      "denyWrite": ["secrets/"]
    }
  }
}
```

### Precedence

The precedence rules are asymmetric — and this catches people off guard:

- **Reads:** `allowRead` beats `denyRead`. If a path matches both, the read is **allowed**.
- **Writes:** `denyWrite` beats `allowWrite`. If a path matches both, the write is **denied**.

This means you cannot use `denyRead` as an absolute block if the same path also appears in `allowRead`. But you *can* use `denyWrite` as an absolute block — it wins even when `allowWrite` covers the same path.

## Part 2: Why It Matters

Default sandbox settings protect system paths (like `~/.ssh`), but your project may contain its own sensitive files: `.env` files with database credentials, `secrets/` directories with API keys, build artifacts you don't want overwritten.

Filesystem controls let you:
- **Block reads** of secret files (`.env`, credential configs) from sandboxed Bash commands
- **Block writes** to directories that should be immutable (checked-in secrets, vendor lockfiles)
- **Allow writes** to specific output directories (build/, dist/) while keeping the rest read-only

## Part 3: Quick Start

```bash
cd scenarios/02-filesystem-controls
npm install           # installs the sandbox runtime
claude                # opens Claude Code — filesystem rules active via .claude/settings.json
npm test              # proves the filesystem controls are working (run in a separate terminal)
```

## Part 4: Setup

### Step 1 — Start with defaults

If you completed Scenario 01, you already have a working sandbox. The default filesystem posture is:
- Reads: allowed within cwd and standard system paths (Node.js, ripgrep, etc.)
- Writes: denied everywhere except cwd (and even cwd requires explicit `allowWrite`)

### Step 2 — Block reads for secrets

Add a `denyRead` rule to prevent sandboxed commands from reading `.env` files:

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "filesystem": {
      "denyRead": [".env*"]
    }
  }
}
```

Now `cat .env`, `grep password .env.local`, and similar commands are blocked at the OS level. The shell cannot access any file matching `.env*`.

### Step 3 — Allow writes to cwd, deny writes to secrets/

Add `allowWrite` for the project directory and `denyWrite` for sensitive subdirectories:

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "filesystem": {
      "denyRead": [".env*"],
      "allowWrite": ["."],
      "denyWrite": ["secrets/"]
    }
  }
}
```

Because `denyWrite` beats `allowWrite`, the `secrets/` directory is protected even though `.` (cwd) is writable. Commands like `touch secrets/test` will be denied.

## Part 5: The Read vs Bash Gap

This is the most important thing to understand about sandbox filesystem controls: **they only apply to Bash commands.** Claude's built-in Read tool is not sandboxed — it is governed by the separate permissions system.

This creates a gap that works in both directions.

### Direction 1: Sandbox blocks Bash, but Read tool bypasses it

With `denyRead: [".env*"]` in your sandbox config:

```
You: cat .env.example
```
The sandboxed Bash command is **denied** — the OS blocks the read.

```
You: Read the file .env.example
```
Claude's Read tool reads it **successfully** — it does not go through the sandbox.

The `.env.example` file in this scenario contains a fake secret (`API_KEY=sk-fake-12345-this-is-not-real`). Try both approaches in a Claude session to see this gap in action.

### Direction 2: Permissions block Read tool, but Bash bypasses it

If you add a permissions deny rule instead of (or without) the sandbox rule:

```json
{
  "permissions": {
    "deny": ["Read(.env*)"]
  }
}
```

Now Claude's Read tool is **blocked** from reading `.env*` files. But:

```
You: cat .env.example
```

If `denyRead` is not also set in the sandbox config, the Bash command reads the file **successfully** — permissions rules do not apply to sandboxed Bash commands.

### The fix: use both layers

For complete protection of sensitive files, you need both:

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "filesystem": {
      "denyRead": [".env*"]
    }
  },
  "permissions": {
    "deny": ["Read(.env*)"]
  }
}
```

The sandbox blocks Bash-level access. The permissions rule blocks Read-tool-level access. Together, they close the gap.

## Part 6: Verify It Works

Run `npm test` from this scenario directory (in a separate terminal, not inside a Claude Code session). Make sure you've run `npm install` first.

### How the test works

The `verify.sh` script uses `srt` — the same sandbox runtime that Claude Code uses — to execute commands under the filesystem rules defined in this scenario. It maps the `.claude/settings.json` config to srt's flat settings format.

### What it checks

1. **Read .env.example via Bash** — `cat .env.example` should be denied (denyRead blocks `.env*`).
2. **Write inside cwd** — `touch test-file` should succeed (allowWrite includes cwd).
3. **Write to secrets/** — `touch secrets/test` should be denied (denyWrite overrides allowWrite).
4. **Write outside cwd** — `touch /tmp/test` should be denied (default: no writes outside cwd).
5. **Read normal project file** — `cat README.md` should succeed (not in denyRead).
6. **Read sensitive path** — `cat ~/.ssh/id_rsa` should be denied (default sandbox behavior).

### What it does NOT test

The Read-vs-Bash gap cannot be tested via `srt` — it is a Claude application-layer behavior, not an OS-level sandbox behavior. To see it in action, open a Claude session in this directory and try both `cat .env.example` (blocked) and "Read .env.example" (not blocked). See Part 5 above.

## Part 7: Gotchas

- **The escape hatch must be closed.** If `allowUnsandboxedCommands` is not `false`, a command blocked by `denyRead` or `denyWrite` can be retried outside the sandbox. See [Scenario 01](../01-native-sandbox-basics/) for details.

- **Mandatory deny paths are always write-protected.** Regardless of your `allowWrite` config, the sandbox always blocks writes to these paths: `.bashrc`, `.bash_profile`, `.zshrc`, `.zprofile`, `.profile`, `.gitconfig`, `.gitmodules`, `.ripgreprc`, `.mcp.json`, `.vscode/`, `.idea/`, `.claude/commands/`, `.claude/agents/`, `.git/hooks/`, `.git/config`. On Linux (bubblewrap), only files that already exist on disk are protected — bubblewrap cannot block creation of a file that does not yet exist. On macOS (Seatbelt), both existing and non-existent files at these paths are blocked.

- **Glob patterns work on macOS only.** On macOS, path values in `denyRead`, `denyWrite`, `allowRead`, and `allowWrite` support git-style glob patterns (e.g., `.env*`, `secrets/**`). On Linux, bubblewrap requires literal paths — globs are not expanded. Use explicit paths on Linux.

- **Read/Edit/Write tools are NOT sandboxed.** Only Bash commands run inside the sandbox. Claude's native file tools bypass it entirely. See Part 5 for the full explanation and the fix.

- **Precedence is asymmetric.** `allowRead` beats `denyRead`, but `denyWrite` beats `allowWrite`. If you put the same path in both allow and deny, reads will be allowed and writes will be denied. This is by design but easy to forget.

## Part 8: Next Steps

- **[Scenario 03 — Network Isolation](../03-network-isolation/):** Domain allowlisting strategies for controlling which hosts sandboxed commands can reach.
- **[Scenario 04 — Permissions Hardening](../04-permissions-hardening/):** Locking down Claude's native tools (Read, Edit, Write, WebFetch) with the permissions system — the other half of the defense model.

# Scenario 01 — Permissions

Claude Code has built-in tools — Read, Edit, Write, Bash, WebFetch, WebSearch, Agent — that operate outside the sandbox. Permissions control which of these tools Claude can use, what arguments they accept, and whether they run automatically or require approval.

## The Six Permissions Fields

| Field | Type | What it does |
|---|---|---|
| `deny` | `string[]` | Hard-blocks matching tool invocations. Claude cannot use them at all. |
| `allow` | `string[]` | Auto-approves matching tool invocations without prompting. |
| `ask` | `string[]` | Forces a confirmation prompt before the tool runs. |
| `additionalDirectories` | `string[]` | Grants Claude read access to directories outside the project root. |
| `defaultMode` | `string` | Sets Claude's operating mode (e.g., `"plan"` for read-only). |
| `disableBypassPermissionsMode` | `string` | Prevents users from overriding permissions with `--dangerously-skip-permissions`. |

## `deny` — Hard Blocks

Deny rules are the strongest control. A denied tool invocation is blocked before it executes. Claude sees a `permission_denials` entry in its response instead of the tool's output.

**Format:** `ToolName(glob pattern)`

The Read deny rule also covers Glob and Grep (they share the Read permission internally). The Edit deny rule covers all file-editing tools. Write is a separate tool from Edit — both need deny rules if you want to block all file modifications.

**Examples from this scenario:**

| Rule | What it blocks |
|---|---|
| `Read(.env*)` | Read tool accessing any `.env` file |
| `Read(*.pem)` | Read tool accessing PEM certificate files |
| `Read(*.key)` | Read tool accessing private key files |
| `Edit(.claude/settings*)` | Edit tool modifying project settings |
| `Write(.claude/settings*)` | Write tool overwriting project settings |
| `Bash(curl *)` | Bash tool running curl commands |
| `WebFetch(*)` | All web fetch operations |
| `WebSearch(*)` | All web search operations |
| `Agent(*)` | All subagent spawning |

## `allow` — Auto-Approve

Allow rules let trusted tool invocations run without a confirmation prompt. They belong in `settings.local.json` because they reflect personal workflow preferences, not project security policy.

**Format:** `ToolName(glob pattern)`

**Examples from this scenario:**

| Rule | What it auto-approves |
|---|---|
| `Bash(echo *)` | Echo commands (used in the allow test) |
| `Bash(npm *)` | npm commands |
| `Bash(node *)` | Node.js commands |
| `Bash(git *)` | Git commands |

## `ask` — Force Prompt

Ask rules force Claude to prompt for confirmation even if the tool would otherwise auto-run. This is primarily useful in interactive mode. In non-interactive mode (`claude -p`), ask-gated tools are skipped since there is no user to approve them.

### Merge and Precedence

Claude merges settings from multiple files with clear precedence: **deny > ask > allow**. A pattern that appears in both `deny` and `allow` is not an error — deny wins deterministically. But an `allow` rule that is shadowed by a `deny` rule is dead code: someone wrote it expecting it to work, and it never will. This is why the config validation test checks for shadowed allows rather than generic "conflicts."

## `additionalDirectories`

By default, Claude can only read files within the project directory (the `-d` flag or cwd). The `additionalDirectories` field grants read access to directories outside the project root.

This is distinct from sandbox filesystem rules. The sandbox controls what Bash can access; `additionalDirectories` controls what Claude's Read tool can access.

## `defaultMode`

Sets Claude's operating mode. Available modes:

| Mode | Behavior |
|---|---|
| `"default"` | Normal operation — Claude can read and write. |
| `"plan"` | Read-only. Claude can analyze but cannot create, edit, or delete files. |
| `"bypassPermissions"` | Skips all permission checks (dangerous). |
| `"buildOnly"` | Only allows build/compile operations. |
| `"codeReview"` | Optimized for code review workflows. |

This scenario tests `"plan"` mode because it has the most demonstrable effect: Claude refuses to create files.

## `disableBypassPermissionsMode`

When set to `"disable"`, prevents users from launching Claude with `--dangerously-skip-permissions`, which would override all deny/ask/allow rules. This is a managed-environment feature — in personal use, you control the CLI flags yourself.

## Prerequisites

1. **Claude CLI** — authenticate before running:
   - **OAuth with Anthropic** (preferred): `claude login`
   - **API key**: set `ANTHROPIC_API_KEY` environment variable
2. **Node.js >= 18**

## Configuration

### `.claude/settings.json` (project-level, committed)

This file defines the project's security policy. Every rule is a deny — this scenario locks down tools that could leak secrets, weaken config, or make unauthorized network requests.

```json
{
  "permissions": {
    "deny": [
      "Read(.env*)",
      "Read(*.pem)",
      "Read(*.key)",
      "Edit(.claude/settings*)",
      "Write(.claude/settings*)",
      "Bash(curl *)",
      "WebFetch(*)",
      "WebSearch(*)",
      "Agent(*)"
    ],
    "allow": [],
    "ask": [],
    "additionalDirectories": [],
    "defaultMode": "default",
    "disableBypassPermissionsMode": "disable"
  }
}
```

**Per-rule annotations:**

- **`Read(.env*)`** — Blocks the Read tool from accessing `.env` files. The sandbox can block `cat .env`, but the Read tool bypasses the sandbox.
- **`Read(*.pem)`, `Read(*.key)`** — Extends secret protection to certificate and key files.
- **`Edit(.claude/settings*)`** — Prevents Claude from editing its own settings to weaken restrictions.
- **`Write(.claude/settings*)`** — Prevents Claude from overwriting settings entirely. Write is a separate tool from Edit.
- **`Bash(curl *)`** — Blocks curl via the Bash tool, even if there is no network sandbox.
- **`WebFetch(*)`** — Blocks all web fetch operations. WebFetch bypasses the sandbox entirely.
- **`WebSearch(*)`** — Blocks all web searches. WebSearch is a separate tool from WebFetch.
- **`Agent(*)`** — Blocks subagent spawning. Subagents inherit permissions but run in separate contexts.

### `.claude/settings.local.json` (user-level, gitignored)

This file defines personal workflow preferences. Allow rules here auto-approve trusted commands so Claude does not prompt for confirmation every time.

```json
{
  "permissions": {
    "allow": [
      "Bash(echo *)",
      "Bash(npm *)",
      "Bash(node *)",
      "Bash(git *)"
    ]
  }
}
```

- **`Bash(echo *)`** — Used by the allow test to verify auto-approval works.
- **`Bash(npm *)`** — Auto-approves npm commands.
- **`Bash(node *)`** — Auto-approves Node.js commands.
- **`Bash(git *)`** — Auto-approves git commands.

## Run It

```bash
npm install && npm test
```

## What You'll See

The verify script runs approximately 11 tests in five groups:

### Preflight probe
Runs a single `claude -p` call to check whether deny rules are enforced. If they are not (a known bug in some versions), deny tests are skipped gracefully with a warning.

### Deny tests (7 tests, gated by preflight)
Each test sends a prompt that triggers a denied tool. Pass condition: the JSON response contains a `permission_denials` entry for the relevant tool.

- **read-deny** — Reuses the preflight result (no extra API call). Checks that `Read(.env*)` blocked reading `.env.example`.
- **edit-deny** — Checks that `Edit(.claude/settings*)` blocked editing `settings.json`.
- **write-deny** — Checks that `Write(.claude/settings*)` blocked overwriting `settings.json`.
- **bash-deny** — Checks that `Bash(curl *)` blocked running curl.
- **webfetch-deny** — Checks that `WebFetch(*)` blocked fetching a URL.
- **websearch-deny** — Checks that `WebSearch(*)` blocked a web search.
- **agent-deny** — Checks that `Agent(*)` blocked subagent spawning.

### Allow test (1 test)
- **bash-allow** — Sends `echo hello-from-permissions` and checks that the result contains the expected output, confirming the `Bash(echo *)` allow rule works.

### additionalDirectories test (1 test)
- **additional-dirs** — Creates a temp settings file with `additionalDirectories` pointing to the repo root (two levels up from this scenario), then asks Claude to read the repo root's `README.md`. Pass: the response contains the file's contents. This works because the repo root is genuinely outside the scenario's project directory.

### defaultMode test (1 test)
- **plan-mode** — Creates a temp settings file with `defaultMode: "plan"`, then asks Claude to create a file. Pass: the file was not created (plan mode is read-only).

### Config validation (1 test, no API call)
- **allows-not-shadowed** — Checks that no allow rule in `settings.local.json` is also in `settings.json`'s deny list. A shadowed allow is dead code.

Expected output: **11 passed, 0 failed** (or 4 passed, 0 failed, 7 skipped if deny enforcement is bugged).

## Break It on Purpose

Each test can be broken intentionally with `--break <name>` to see what happens when a rule is removed. The original `settings.json` is never modified — `--break` creates a temp copy with the rule removed.

### `--break read-deny`

```bash
npm test -- --break read-deny
```

**Before (working):**
```json
"deny": ["Read(.env*)", "Read(*.pem)", "Read(*.key)", ...]
```

**After (broken):**
```json
"deny": ["Read(*.pem)", "Read(*.key)", ...]
```

Without `Read(.env*)`, Claude's Read tool can access `.env` files. The sandbox might block `cat .env`, but the Read tool bypasses the sandbox entirely.

### `--break edit-deny`

```bash
npm test -- --break edit-deny
```

**Before (working):**
```json
"deny": [..., "Edit(.claude/settings*)", "Write(.claude/settings*)", ...]
```

**After (broken):**
```json
"deny": [..., "Write(.claude/settings*)", ...]
```

Without `Edit(.claude/settings*)`, Claude can edit its own settings file to weaken restrictions. The Write deny still blocks overwrites, but targeted edits get through.

### `--break write-deny`

```bash
npm test -- --break write-deny
```

**Before (working):**
```json
"deny": [..., "Edit(.claude/settings*)", "Write(.claude/settings*)", ...]
```

**After (broken):**
```json
"deny": [..., "Edit(.claude/settings*)", ...]
```

Without `Write(.claude/settings*)`, Claude can overwrite the settings file entirely. Edit and Write are separate tools — blocking one does not block the other.

### `--break bash-deny`

```bash
npm test -- --break bash-deny
```

**Before (working):**
```json
"deny": [..., "Bash(curl *)", ...]
```

**After (broken):**
```json
"deny": [...]
```

Without `Bash(curl *)`, Claude can run curl commands through the Bash tool. Even without a network sandbox, this permission rule is the control point.

### `--break webfetch-deny`

```bash
npm test -- --break webfetch-deny
```

**Before (working):**
```json
"deny": [..., "WebFetch(*)", ...]
```

**After (broken):**
```json
"deny": [...]
```

Without `WebFetch(*)`, Claude's WebFetch tool can make HTTP requests to any URL. WebFetch operates outside the sandbox — this deny rule is the only control.

### `--break websearch-deny`

```bash
npm test -- --break websearch-deny
```

**Before (working):**
```json
"deny": [..., "WebSearch(*)", ...]
```

**After (broken):**
```json
"deny": [...]
```

Without `WebSearch(*)`, Claude can search the web. WebSearch is a separate tool from WebFetch — both need deny rules for full network lockdown.

### `--break agent-deny`

```bash
npm test -- --break agent-deny
```

**Before (working):**
```json
"deny": [..., "Agent(*)", ...]
```

**After (broken):**
```json
"deny": [...]
```

Without `Agent(*)`, Claude can spawn subagents. Subagents inherit permissions but run in separate contexts, which can make behavior harder to audit.

### `--break bash-allow`

```bash
npm test -- --break bash-allow
```

**Before (working):**
```json
"allow": ["Bash(echo *)", "Bash(npm *)", "Bash(node *)", "Bash(git *)"]
```

**After (broken):**
```json
"allow": ["Bash(npm *)", "Bash(node *)", "Bash(git *)"]
```

Without `Bash(echo *)`, the echo command is no longer auto-approved. In non-interactive mode (`claude -p`), Claude will skip or fail the command instead of running it automatically.

### `--break additional-dirs`

```bash
npm test -- --break additional-dirs
```

**Before (working):**
```json
"additionalDirectories": ["/absolute/path/to/repo-root"]
```

**After (broken):**
```json
"additionalDirectories": []
```

Without the additional directory entry, Claude cannot read files outside the project root. The repo root's `README.md` becomes inaccessible to the Read tool.

### `--break plan-mode`

```bash
npm test -- --break plan-mode
```

**Before (working):**
```json
"defaultMode": "plan"
```

**After (broken):**
```json
"defaultMode": "default"
```

With `defaultMode` set back to `"default"`, Claude operates normally and creates the file instead of refusing. Plan mode's read-only restriction is removed.

## Known Issues

- **Deny enforcement bugs:** Some versions of Claude Code silently ignore deny rules. The preflight probe detects this and skips deny tests gracefully. If you see 7 skipped tests, check your Claude Code version.
- **Non-interactive `ask` rules:** In `claude -p` mode (non-interactive), tools gated by `ask` rules are skipped because there is no user to approve them. This scenario documents `ask` but does not test it.
- **`disableBypassPermissionsMode`:** This setting prevents `--dangerously-skip-permissions` but is primarily useful in managed environments. It is documented but not tested because testing it would require attempting a bypass.
- **Preflight probe doubles as read-deny test:** The preflight check uses the same prompt as the `read-deny` test. If the preflight passes, the result is reused — no redundant API call.

## Cost

This scenario makes approximately 10 API calls (7 deny + 1 allow + 1 additionalDirs + 1 defaultMode, minus 1 since the preflight doubles as read-deny). Estimated cost: a few cents.

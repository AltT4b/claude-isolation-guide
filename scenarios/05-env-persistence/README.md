# Scenario 05 — Environment Persistence

Want nvm or sdkman available in every Claude Bash call? `CLAUDE_ENV_FILE` makes it work. One trap: completion scripts silently break everything.

## Setup

```bash
export CLAUDE_ENV_FILE=/etc/sandbox-persistent.sh
```

Core init only — no completions:

```bash
# nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> /etc/sandbox-persistent.sh
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> /etc/sandbox-persistent.sh

# sdkman
echo 'export SDKMAN_DIR="$HOME/.sdkman"' >> /etc/sandbox-persistent.sh
echo '[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"'  >> /etc/sandbox-persistent.sh
```

The fixture sets `PROJECT_ENV=sandbox-testing` as a canary value for the interactive proof.

## Verify

### Automated checks

```bash
npm test
```

Validates configuration and demonstrates the completion trap:

| Test | What it checks |
|---|---|
| CLAUDE_ENV_FILE configured | Env var is set and points to a real file |
| Env file structure | Tool init present, no completion scripts |
| Completion script trap | Bad env file silently kills command output |

### Interactive proof (the real test)

The automated checks validate that the config is *correct*, but they can't prove Claude actually *uses* it — `verify.js` runs via Node's `child_process`, not Claude's Bash tool. The only way to verify is to have Claude run a command that reads the canary variable **without explicitly sourcing the file**.

```bash
# Point CLAUDE_ENV_FILE at the fixture and ask Claude to read the canary var.
# Claude's Bash tool will source the file automatically — we never mention it in the prompt.
CLAUDE_ENV_FILE="$(pwd)/sandbox-persistent.sh" \
  claude -p 'Run this exact command and show me the output: echo $PROJECT_ENV'
```

**Expected output** (somewhere in Claude's response):

```
sandbox-testing
```

If Claude returns an empty line or `$PROJECT_ENV` literally, the env file is not being sourced.

**Why this works:** `claude -p` sends a one-shot prompt. Claude's Bash tool sources `CLAUDE_ENV_FILE` before executing, so `$PROJECT_ENV` is already set — even though the prompt never asked Claude to source anything. That's the proof.

```
PASS — CLAUDE_ENV_FILE is set: /etc/sandbox-persistent.sh
PASS — File exists at the configured path.
PASS — Env file contains expected tool initialization (nvm, sdkman, PROJECT_ENV).
PASS — Env file has no active completion scripts.
PASS — Baseline: echo produces output after sourcing good env file.
PASS — Bad env file causes silent failure — echo produced no output.

Passed: 6 / 6
```

> **Note:** If running outside a Claude sandbox, `CLAUDE_ENV_FILE` won't be set. The tests gracefully fall back to validating the fixture file directly. If nvm is not installed, the bad-file test will WARN and verify the dangerous pattern structurally instead.

---

## Deep Dive

### The Completion Script Trap

`CLAUDE_ENV_FILE` is sourced before **every** Bash command — not just during shell init. Completion scripts rely on `COMP_WORDS`, `COMP_CWORD`, `COMPREPLY` which only exist during tab-completion. Sourcing them during normal execution causes **silent failure on all commands**.

**Symptoms:** All commands return empty output. `echo "test"` produces nothing. Bash tool is completely unusable.

**Fix:** Remove the completion line(s) from the env file, restart Claude Code, verify with `echo "test"`.

**Wrong:**
```bash
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
```

**Right:**
```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

## Break It on Purpose

Each experiment modifies the env file. Make the change, run `npm test`, observe which test flips, then **undo the edit** before moving on.

### Experiment A — Add a completion script

Append a completion line to the fixture:

```bash
echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> sandbox-persistent.sh
```

Run `npm test`. **Test 4 flips to FAIL** — the env file now contains an active completion script. If you run `claude -p` with this file as `CLAUDE_ENV_FILE`, every Bash command returns empty output.

**Takeaway:** Completion scripts are the #1 footgun. They source cleanly during tab-completion but break everything during normal execution because `COMP_WORDS` and friends don't exist.

Undo: remove the line you added.

### Experiment B — Point CLAUDE_ENV_FILE at a missing file

```bash
export CLAUDE_ENV_FILE=/tmp/does-not-exist.sh
```

Run `npm test`. **Test 2 flips to FAIL** — the file doesn't exist at the configured path. In a live session, sourcing silently fails and none of your tools (nvm, sdkman) are available.

**Takeaway:** The env var and the file must both exist. A typo in the path means silent failure — no error, just missing tools.

Undo: `export CLAUDE_ENV_FILE=/etc/sandbox-persistent.sh` (or your original value).

### Experiment C — Add a slow command

```bash
echo 'sleep 2' >> sandbox-persistent.sh
```

Run a few commands in a `claude -p` session. Every Bash invocation takes 2+ seconds longer than normal because the env file is sourced before **every** command.

**Takeaway:** Keep the env file lean. A 2-second init script means 2 extra seconds on *every* `echo`, `ls`, and `git status`.

Undo: remove the `sleep 2` line.

## Gotchas

- **Every. Single. Command.** The env file is sourced before every Bash tool invocation. Slow init scripts mean slow commands. Keep it lean.
- **No completions, ever.** Symptoms: all commands return empty output. Fix: remove completion lines, restart Claude Code.
- **`bash -l -c` is the escape hatch.** If a tool isn't in PATH after installation, use `bash -l -c "command"` to force a fresh source of the env file.
- **File must exist before setting `CLAUDE_ENV_FILE`.** If the env var points to a missing file, sourcing fails silently.
- **Don't store secrets in the env file.** It's a shell script sourced in every context. Use a proper secrets manager.

## Next Steps

- [Scenario 06 — Devcontainer Reference](../06-devcontainer-reference/) — container-based isolation
- [Scenario 10 — Combined Defense](../10-combined-defense/) — layering all controls together

# Scenario 05 — Environment Persistence

`CLAUDE_ENV_FILE` points to a shell script sourced before every Bash tool invocation. Environment variables set there persist across all Claude Code Bash commands.

## Why It Matters

Without persistence, installing nvm in one Bash call doesn't carry over to the next. `CLAUDE_ENV_FILE` is the bridge — it re-initializes your tools before every command so they're always available.

## Quick Start

```bash
cd scenarios/05-env-persistence
npm test
```

## Setup

1. **Create the env file** (or use the example in this directory):

   ```bash
   touch /etc/sandbox-persistent.sh
   ```

2. **Set `CLAUDE_ENV_FILE`** to point at it:

   ```bash
   export CLAUDE_ENV_FILE=/etc/sandbox-persistent.sh
   ```

3. **Add tool initialization scripts** — only the core setup, never completions:

   ```bash
   # nvm
   echo 'export NVM_DIR="$HOME/.nvm"' >> /etc/sandbox-persistent.sh
   echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> /etc/sandbox-persistent.sh

   # sdkman
   echo 'export SDKMAN_DIR="$HOME/.sdkman"' >> /etc/sandbox-persistent.sh
   echo '[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"' >> /etc/sandbox-persistent.sh
   ```

4. **Verify** with `bash -l -c "node --version"` or `npm test` in this directory.

## The Completion Script Trap

This is the most important thing in this scenario.

`CLAUDE_ENV_FILE` is sourced before **every** Bash command — not just during shell initialization. Completion scripts rely on special variables (`COMP_WORDS`, `COMP_CWORD`, `COMPREPLY`) that only exist during tab-completion contexts, not during normal command execution.

Sourcing completions during normal execution causes **silent failure on all commands**.

### Wrong way

```bash
# sandbox-persistent-bad.sh — DO NOT USE
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # BREAKS EVERYTHING
```

### Right way

```bash
# sandbox-persistent.sh — correct
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
# NO bash_completion here!
```

### Symptoms

| Symptom | Cause |
|---|---|
| All Bash commands return empty output | Completion script sourced in non-completion context |
| `echo "test"` produces no result | Same — silent failure |
| Bash tool becomes completely unusable | Same |

### Fix

1. Remove the completion line(s) from `/etc/sandbox-persistent.sh`
2. Exit and restart the Claude Code session
3. Verify with `echo "test"` that Bash works again

## Verify It Works

```bash
npm test
```

The tests check:
| Test | What it verifies |
|---|---|
| Good env file is valid | `sandbox-persistent.sh` sources without errors |
| Good env file sets vars | `PROJECT_ENV` is set after sourcing |
| Bad env file flagged | `sandbox-persistent-bad.sh` contains completion patterns |
| Login shell picks up env | `bash -l -c` sources the env file correctly |
| Env file structure | `sandbox-persistent.sh` exists with expected content |

## Gotchas

- **Every. Single. Command.** The env file is sourced before every Bash tool invocation. Slow init scripts mean slow commands. Keep it lean.
- **No completions, ever.** Worth repeating. Symptoms: all commands return empty output. Fix: remove completion lines, restart Claude Code.
- **`bash -l -c` is the escape hatch.** If a tool isn't in PATH after installation, use `bash -l -c "command"` to force a fresh source of the env file.
- **File must exist before setting `CLAUDE_ENV_FILE`.** If the env var points to a missing file, sourcing fails silently.
- **Don't store secrets in the env file.** It's a shell script sourced in every context. Use a proper secrets manager.

## Next Steps

- [Scenario 06 — Devcontainer](../06-devcontainer/) — container-based isolation
- [Scenario 10 — Combined Defense](../10-combined-defense/) — layering all controls together

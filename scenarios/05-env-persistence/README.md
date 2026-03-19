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

The fixture sets `PROJECT_ENV=sandbox-testing` as a canary value to prove sourcing worked.

## Verify

```bash
npm install
npm test
```

## What You'll See

| Test | Expected |
|---|---|
| Good env file sources cleanly | No errors, `PROJECT_ENV` is set |
| Bad env file detected | Completion patterns flagged |
| `bash -l -c` picks up env | Login shell sources the file |

```
PASS — sandbox-persistent.sh sources without errors.
PASS — PROJECT_ENV is set to "sandbox-testing".
PASS — Bad env file contains active completion scripts (correctly identified as dangerous).
PASS — Login shell sources env file and returns PROJECT_ENV="sandbox-testing".
PASS — sandbox-persistent.sh contains expected tool initialization.
PASS — sandbox-persistent.sh has no active completion scripts.

Passed: 6 / 6
```

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

## Gotchas

- **Every. Single. Command.** The env file is sourced before every Bash tool invocation. Slow init scripts mean slow commands. Keep it lean.
- **No completions, ever.** Symptoms: all commands return empty output. Fix: remove completion lines, restart Claude Code.
- **`bash -l -c` is the escape hatch.** If a tool isn't in PATH after installation, use `bash -l -c "command"` to force a fresh source of the env file.
- **File must exist before setting `CLAUDE_ENV_FILE`.** If the env var points to a missing file, sourcing fails silently.
- **Don't store secrets in the env file.** It's a shell script sourced in every context. Use a proper secrets manager.

## Next Steps

- [Scenario 06 — Devcontainer Reference](../06-devcontainer-reference/) — container-based isolation
- [Scenario 10 — Combined Defense](../10-combined-defense/) — layering all controls together

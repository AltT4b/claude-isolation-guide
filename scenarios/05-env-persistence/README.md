# Scenario 05 — Environment Persistence

`CLAUDE_ENV_FILE` → shell script sourced before every Bash command. Tool installs (nvm, sdkman) persist across invocations. **Never add completion scripts — they silently break everything.**

## Setup

```bash
export CLAUDE_ENV_FILE=/etc/sandbox-persistent.sh
```

```bash
# ✅ Right — core init only
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# ❌ Wrong — completions break all Bash commands
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
```

## Verify

```bash
npm test
```

## What It Proves

| Test | Expected |
|---|---|
| Good env file sources cleanly | No errors, `PROJECT_ENV` is set |
| Bad env file detected | Completion patterns flagged |
| `bash -l -c` picks up env | Login shell sources the file |

---

## Deep Dive

### The Completion Script Trap

`CLAUDE_ENV_FILE` is sourced before **every** Bash command — not just during shell init. Completion scripts rely on `COMP_WORDS`, `COMP_CWORD`, `COMPREPLY` which only exist during tab-completion. Sourcing them during normal execution causes **silent failure on all commands**.

**Symptoms:** All commands return empty output. `echo "test"` produces nothing. Bash tool is completely unusable.

**Fix:** Remove the completion line(s) from the env file, restart Claude Code, verify with `echo "test"`.

### Full setup example

```bash
# nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> /etc/sandbox-persistent.sh
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> /etc/sandbox-persistent.sh

# sdkman
echo 'export SDKMAN_DIR="$HOME/.sdkman"' >> /etc/sandbox-persistent.sh
echo '[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"'  >> /etc/sandbox-persistent.sh
```

## Gotchas

- **Every. Single. Command.** The env file is sourced before every Bash tool invocation. Slow init scripts mean slow commands. Keep it lean.
- **No completions, ever.** Worth repeating. Symptoms: all commands return empty output. Fix: remove completion lines, restart Claude Code.
- **`bash -l -c` is the escape hatch.** If a tool isn't in PATH after installation, use `bash -l -c "command"` to force a fresh source of the env file.
- **File must exist before setting `CLAUDE_ENV_FILE`.** If the env var points to a missing file, sourcing fails silently.
- **Don't store secrets in the env file.** It's a shell script sourced in every context. Use a proper secrets manager.

## Next Steps

- [Scenario 06 — Devcontainer Reference](../06-devcontainer-reference/) — container-based isolation
- [Scenario 10 — Combined Defense](../10-combined-defense/) — layering all controls together

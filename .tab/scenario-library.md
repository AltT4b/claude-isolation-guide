# Scenario Library: Claude Code Sandbox & Container Security

## Goal
Build a collection of self-contained scenarios that teach Claude Code users how sandbox configuration and containerization work — and how to combine them for a strong security posture. Each scenario is a mini-guide: what it does, why it matters, how to set it up, and what to watch out for.

## Approach

### Repo structure
```
scenarios/
  01-native-sandbox-basics/
    README.md
    settings.json          # example config
    verify.sh
  02-filesystem-controls/
    README.md
    settings.json
    .env.example           # demonstrates the Read vs Bash gap
    verify.sh
  03-network-isolation/
    README.md
    settings.json
    verify.sh
  04-permissions-hardening/
    README.md
    settings.json
    settings.local.json
    verify.sh
  05-env-persistence/
    README.md
    sandbox-persistent.sh  # example CLAUDE_ENV_FILE
    verify.sh
  06-devcontainer-reference/
    README.md
    .devcontainer/
      devcontainer.json
      Dockerfile
      init-firewall.sh
    verify.sh
  07-standalone-docker/
    README.md
    Dockerfile
    run.sh
    verify.sh
  08-docker-sandboxes/
    README.md
    verify.sh
  09-hardened-container/
    README.md
    Dockerfile
    docker-compose.yml
    verify.sh
  10-combined-defense/
    README.md
    settings.json
    Dockerfile
    verify.sh
LICENSE                        # MIT
README.md                      # Top-level overview, scenario index, threat model primer
```

### Scenario design principles
- Each scenario is **self-contained** — can be read and used independently
- READMEs follow a consistent structure: What / Why / Setup / Verify / Gotchas
- Example configs are **functional**, not pseudocode — copy-paste and go
- Gotchas are first-class content, not footnotes — the gaps are where people get hurt
- Scenarios build in complexity but don't require sequential reading

### README template (per scenario)
```markdown
# Scenario: <Name>

## What This Does
One paragraph explaining the isolation mechanism.

## Why It Matters
The threat or gap this addresses.

## Quick Start
Exact commands to run this scenario — no guessing. Typically:
- For sandbox/permissions scenarios (01-05): `cd` into the directory, run `claude`, then `./verify.sh`
- For container scenarios (06-09): build the container, run Claude inside it, then verify
- Should be copy-paste-able from a cold start

## Setup
Step-by-step with copy-paste commands/configs.

## Verify It Works
How to confirm the isolation is active (test commands, expected outputs).

## Gotchas
Known limitations, foot-guns, and interactions with other layers.

## Next Steps
Which scenarios to explore next for deeper protection.
```

### Top-level README
- Brief threat model primer (what are you protecting against?)
- Scenario index with one-line descriptions
- "Which scenario do I need?" decision guide
- Links to official Anthropic docs

## Decisions
- **10 scenarios, not 3 mega-guides.** Granular is better for discoverability and for users who only need one thing.
- **Scenarios are numbered for suggested reading order** but explicitly designed to work standalone.
- **Functional configs, not documentation-only.** Each scenario ships files you can actually use.
- **Gotchas get their own section.** The escape hatch default, the Read-vs-Bash gap, the IPC escape — these are the most valuable content in the whole library.
- **Every scenario includes a `verify.sh` script.** 3-5 checks that prove the isolation is active. The test is the spec — readers confirm the config works rather than trusting the README. Always verbose — each check explains what it's testing and why before showing pass/fail. The script itself is educational, not just functional.
- **Scenario 10 is opinionated but transparent.** One recommended config that defends against specific named threats. Each setting explains "we block X because of Y." Not a buffet — a sane default with documented knobs to loosen.
- **No managed/enterprise settings scenario.** Hard to set up well, different audience. Mentioned as further reading in the top-level README.
- **MIT license.**
- **Top-level README includes an ASCII diagram** of the three isolation layers (permissions → sandbox → container) as concentric rings. Portable, diffs well, orients the reader immediately.

## Open Questions
*(none — plan is ready for implementation)*

## Out of Scope
- **MCP server sandboxing** — related but a different topic; could be a future addition.
- **Claude Code on the web (cloud sessions)** — different isolation model, not user-configurable.
- **Windows support** — native sandbox isn't available on Windows yet.
- **Managed/enterprise settings** — different audience, hard to set up well. Reference in top-level README only.

## Deferred
- Community container projects (tintinweb, claudebox, etc.) — worth referencing but not reproducing. Can add a "community approaches" appendix later.
- `npx @anthropic-ai/sandbox-runtime` as a standalone tool — interesting but tangential.

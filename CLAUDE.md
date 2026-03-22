# CLAUDE.md

Hands-on guide to Claude Code's isolation layers. The READMEs are the product — every scenario README is a self-contained tutorial with runnable tests.

## Repo Layout

```
docs/                        Reference guides (permissions, sandbox)
scenarios/
  01-permissions/            Deny rules — tool-level access control
  02-sandbox/                OS-level filesystem + network isolation
  03-containers/             Docker hardening
  04-container-with-sandbox/ All three layers combined
  lib/                       Shared utilities (format-result.js, test-helpers.js, srt-settings.js)
```

Each scenario has its own `.claude/settings.json` with isolation rules and fixture files (fake secrets, protected dirs). These are test fixtures — don't clean them up or "fix" the fake credentials.

## What Matters

**The docs are the deliverable.** Code exists to support the tutorials. When editing:

- Scenario READMEs follow a strict structure: intro → Prerequisites → Cost → Configuration → Test Index → Output Format → Quick Reference → Try It → What You Learned. Don't rearrange.
- Every test follows try → break → restore. Break-it instructions must be precise enough to copy-paste.
- Config blocks in READMEs must match the actual `.claude/settings.json` and `docker-compose.yml` files. If you change a config file, update the README. If you change a README config block, update the file.
- `docs/permissions-guide.md` and `docs/sandbox-guide.md` are property references. Keep them exhaustive and in property-per-heading format.

## Writing Style

- Terse. Cut filler words. One sentence beats two if it carries the same info.
- Analogies over explanations — "bouncer at the door vs. locked filing cabinet" beats three paragraphs.
- Bold key terms on first use in a section. Use tables for anything with 3+ parallel items.
- Audience has little time but wants depth available. Front-load the "what" — push the "why" into blockquotes or follow-up paragraphs.

## Key Concepts to Get Right

Three isolation layers, each covering what the others can't:

- **Permissions** — tool-level. Controls which tools Claude can invoke (Read, Edit, Bash, WebFetch, etc.). Deny rules are absolute — no override.
- **Sandbox** — OS-level. Restricts what Bash commands can access (filesystem paths, network domains). Native tools bypass the sandbox entirely.
- **Container** — kernel-level. Privilege boundaries, resource limits, noexec. Works even if permissions and sandbox are misconfigured.

The merge behavior matters: `Read(...)` deny rules merge into `sandbox.filesystem.denyRead`. `Edit(...)` rules merge into `denyWrite`. One-directional — permissions feed into sandbox, not the reverse.

`bypassPermissions` skips prompts, not deny rules. This is the production pattern.

## Commands

No build step. Scenarios 01–02 run directly with `claude -p` from their directories. Scenarios 03–04 need Docker:

```bash
# From a scenario directory with docker-compose.yml
docker compose build
docker compose run --rm bash
```

Test output is formatted through `scenarios/lib/format-result.js`:

```bash
claude -p "..." --output-format json --max-turns 2 | node ../lib/format-result.js
```

## Git Conventions

[Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new scenario or feature
- `fix:` bug fix or correction
- `docs:` documentation changes (most work here)
- `chore:` config, dependencies, maintenance
- `refactor:` restructuring without behavior change

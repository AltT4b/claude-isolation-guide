# Scenario 10 — Combined Defense

## What This Does

One recommended configuration that layers permissions + sandbox + container for defense in depth. Not a buffet — a sane default with documented knobs to loosen.

## Why It Matters

Scenarios 01-09 teach individual mechanisms. Real security comes from combining them. Each layer catches what the others miss:

- Permissions alone don't cover Bash commands
- Sandbox alone doesn't cover Claude's built-in tools (Read, Edit, WebFetch)
- Container alone doesn't restrict what Claude does inside the container

This scenario shows how they compose.

## Quick Start

**Sandbox only** (no Docker required):

```bash
# Copy the settings into your project
cp -r .claude/ /path/to/your/project/.claude/
```

**Sandbox + container**:

```bash
docker compose up --build
```

**Verify the configuration**:

```bash
npm install && npm test
```

## The Three Layers

```
    ┌─────────────────────────────────────┐
    │           Container                  │
    │   ┌─────────────────────────────┐   │
    │   │         Sandbox              │   │
    │   │   ┌─────────────────────┐   │   │
    │   │   │    Permissions       │   │   │
    │   │   │                     │   │   │
    │   │   │  Read · Edit · Web  │   │   │
    │   │   └─────────────────────┘   │   │
    │   │                             │   │
    │   │  Bash · filesystem · net    │   │
    │   └─────────────────────────────┘   │
    │                                     │
    │  process · mount · cgroup · caps    │
    └─────────────────────────────────────┘
```

### Layer 1: Permissions (`settings.json` > `permissions`)

Controls Claude's built-in tools — Read, Edit, Write, WebFetch. These tools run outside the sandbox, so they need their own rules.

**Catches:** unauthorized file reads, arbitrary web requests, settings tampering.

### Layer 2: Sandbox (`settings.json` > `sandbox`)

OS-level Bash restrictions. Every command Claude runs through Bash goes through srt (the sandbox runtime).

**Catches:** filesystem access outside cwd, network exfiltration via curl/wget, writes to sensitive paths.

### Layer 3: Container (`Dockerfile` + `docker-compose.yml`)

Environment isolation. The entire Claude Code session runs inside a locked-down container.

**Catches:** anything that escapes Layers 1 and 2, resource abuse, privilege escalation.

## The Config, Annotated

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
```

> `enabled: true` — turns on the OS-level sandbox for all Bash commands.
> **Blocks:** unrestricted shell access.
>
> `allowUnsandboxedCommands: false` — closes the escape hatch. No command can bypass the sandbox.
> **Blocks:** sandbox bypass via unsandboxed execution.

```json
    "filesystem": {
      "allowWrite": ["."],
```

> `allowWrite: ["."]` — permits writes only within the current working directory.
> **Blocks:** writes to /tmp, /etc, home directory, or any path outside the project.

```json
      "denyRead": [".env*", "*.pem", "*.key"],
```

> `denyRead` — blocks Bash-level reads of secret files matching these patterns.
> **Blocks:** `cat .env`, `cat server.pem`, `cat private.key` — common exfiltration targets.
> **Loosen if:** your .env files don't contain secrets (but why would you?).

```json
      "denyWrite": [".claude/", "secrets/", ".git/hooks/"]
```

> `denyWrite` — blocks writes to sensitive subdirectories even though allowWrite covers cwd.
> **Blocks:** settings tampering (.claude/), secret file modification (secrets/), git hook injection (.git/hooks/).
> **Loosen if:** you need Claude to manage its own settings (not recommended).

```json
    },
    "network": {
      "allowedDomains": [
        "api.anthropic.com",
        "registry.npmjs.org",
        "pypi.org"
      ]
    },
```

> `allowedDomains` — allowlist for outbound network from sandboxed Bash. Everything else is blocked.
> **Blocks:** data exfiltration via curl/wget to attacker-controlled servers.
> **Loosen if:** you need to reach additional APIs or registries.

```json
    "excludedCommands": ["docker", "docker-compose"]
  },
```

> `excludedCommands` — these commands bypass the sandbox entirely.
> **This is the biggest hole in the config.** If your workflow doesn't need Docker from inside Claude, remove these entries.
> **Loosen if:** you need Claude to run containers (accept the risk).

```json
  "permissions": {
    "deny": [
      "Read(.env*)",
      "Read(*.pem)",
      "Read(*.key)",
      "Edit(.claude/settings*)",
      "Write(.claude/settings*)"
    ],
```

> `permissions.deny` — blocks Claude's built-in tools (Read, Edit, Write) from accessing these paths.
> These tools run outside the sandbox, so denyRead alone is not enough.
> **Blocks:** Claude reading secrets via the Read tool, tampering with its own settings.

```json
    "allow": [
      "Bash(npm *)",
      "Bash(node *)",
      "Bash(git *)",
      "Bash(npx *)"
    ]
  }
}
```

> `permissions.allow` — pre-approves common development commands so Claude doesn't prompt for each one.
> **Trade-off:** convenience vs. control. Remove entries to require approval for each command.

## Loosening Knobs

| Need | Setting to change | What you lose |
|------|-------------------|---------------|
| Access npm registry | Add to `allowedDomains` | Network isolation for that domain |
| Docker commands | Remove from `excludedCommands` | Sandbox coverage for Docker |
| Read .env files | Remove from `denyRead` + `permissions.deny` | Secret file protection |
| WebFetch access | Remove from `permissions.deny` | Web request control |
| Write to .claude/ | Remove from `denyWrite` | Settings tamper protection |
| Write to secrets/ | Remove from `denyWrite` | Secret directory protection |
| Additional CLI tools | Add to `permissions.allow` | Per-command approval for those tools |

## Verify It Works

```bash
npm install && npm test
```

The verify script runs two types of checks:

1. **Config validation** (tests 1-4) — parses settings.json and confirms all expected rules are present.
2. **Sandbox enforcement** (tests 5-8) — runs commands through srt and confirms they are blocked or allowed as expected.

For container validation, run:

```bash
docker compose up --build
```

## Gotchas

- **This config is restrictive by design.** Some workflows will need loosening — the Loosening Knobs table shows how.
- **Container is optional but recommended.** The settings.json works without Docker — you just lose the outer ring.
- **`excludedCommands: ["docker"]` is the biggest hole.** If your workflow doesn't need Docker, remove it.
- **Registry domains in allowedDomains.** Including `registry.npmjs.org` lets sandboxed Bash install packages. Remove if you pre-install all deps in the container.
- **Permissions and sandbox are complementary, not redundant.** Permissions control Claude's built-in tools. Sandbox controls Bash. You need both.
- **This is a starting point, not a finish line.** Audit regularly. New tools, new workflows, new threats.

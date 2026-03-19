# Scenario 08 — Docker Sandboxes

Docker commands fail in the sandbox. `excludedCommands` lets them bypass it while everything else stays sandboxed. This scenario covers the tradeoff.

## Config

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "excludedCommands": ["docker", "docker-compose"],
    "network": { "allowedDomains": ["api.anthropic.com"] }
  }
}
```

## Verify

```bash
npm install
npm test
```

## The Tradeoff

| What you keep | What you lose |
|---|---|
| Sandbox for all non-docker commands | Sandbox for docker commands |
| Network isolation for curl/wget | Docker can reach any network |
| Filesystem restrictions for normal commands | Docker can mount any path via `-v` |

**Nuclear option:** `docker run -v /:/host` = full host filesystem access. Deny `Bash(docker run -v /*)` in permissions if concerned.

---

## Deep Dive

### How `excludedCommands` works

**Prefix match.** `"docker"` matches `docker`, `docker-compose`, `docker buildx`, etc. Excluded commands bypass the sandbox entirely. Everything else stays sandboxed.

### `docker exec` is different

Commands via `docker exec` inherit the container's isolation, not the host sandbox.

### What the tests check

| Test | Expected | Why |
|---|---|---|
| Sandbox enabled | `enabled: true` | Sandbox must be on for exclusions to matter |
| excludedCommands present | Contains `"docker"` | Docker commands bypass sandbox |
| allowUnsandboxedCommands | `false` | Non-excluded commands must stay sandboxed |
| Non-docker sandboxed | `curl example.com` blocked | Proves sandbox still enforces for non-excluded |
| Docker available | Informational | Confirms Docker is installed |

Note: Can't test that Docker actually bypasses the sandbox from within `srt`. Tests focus on config correctness + sandbox enforcement for non-excluded commands.

## Gotchas

- **`excludedCommands` is a prefix match.** `"docker"` matches `docker`, `docker-compose`, `docker buildx`, etc. Be aware of what you're excluding.
- **Excluded commands still go through permissions.** They're not sandboxed, but Claude still needs permission approval (unless auto-allowed via `allowedTools`).
- **`docker run -v /:/host` is the nuclear option.** If Claude runs this, it has full filesystem access regardless of any sandbox config. The permissions system is your defense — deny `Bash(docker run -v /*)` if you're worried.
- **`docker exec` inherits the container's isolation, not the host sandbox.** Commands run inside a container are isolated by Docker, not by Claude's sandbox.
- **watchman (jest) has the same problem.** `excludedCommands: ["watchman"]` is a common companion. Or use `jest --no-watchman`.
- **Don't exclude too much.** Every excluded command is a hole in the sandbox. Be surgical.

## Next Steps

- **[Scenario 09 — Hardened Container](../09-hardened-container/):** Docker security best practices for the containers themselves.
- **[Scenario 10 — Combined Defense](../10-combined-defense/):** Layering sandbox + Docker for defense in depth.

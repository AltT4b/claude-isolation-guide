---
logged: 2026-03-19
context: 01-permissions rewrite workshop
---

`--allowedTools` and `--disallowedTools` are per-invocation CLI flags that restrict which tools Claude can use for a single run. They're conceptually related to `permissions.allow`/`permissions.deny` in settings.json but are a different mechanism — ephemeral vs persistent, CLI vs config.

Could be its own short scenario or a sidebar/appendix in the permissions README. Decided to keep it out of 01-permissions to avoid mixing per-invocation flags with persistent policy settings (the same "too many concepts" problem the original scenario had).

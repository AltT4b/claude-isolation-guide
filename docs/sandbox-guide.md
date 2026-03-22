# Claude Code Sandbox Guide

Complete reference for all `sandbox.*` properties in Claude Code settings. The sandbox provides **OS-level** filesystem and network isolation for Bash commands (via [bubblewrap](https://github.com/containers/bubblewrap) on Linux, Seatbelt on macOS), complementing the tool-level permissions system.

**Platform support:** macOS, Linux, and WSL2.

---

## Top-Level Sandbox Properties

### `sandbox.enabled`

Enables Bash sandboxing with OS-level filesystem and network isolation.

- **Type:** boolean
- **Default:** `false`

```json
{
  "sandbox": {
    "enabled": true
  }
}
```

### `sandbox.autoAllowBashIfSandboxed`

Auto-approves Bash commands that run inside the sandbox. Commands outside sandbox boundaries or matching explicit deny rules still go through normal permissions.

- **Type:** boolean
- **Default:** `true`

```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true
  }
}
```

### `sandbox.excludedCommands`

Commands that run **outside** the sandbox (bypass sandbox restrictions). Use for tools incompatible with sandboxing.

- **Type:** array of strings
- **Default:** `[]`

```json
{
  "sandbox": {
    "enabled": true,
    "excludedCommands": ["docker", "git", "watchman"]
  }
}
```

### `sandbox.allowUnsandboxedCommands`

Controls the `dangerouslyDisableSandbox` escape hatch. When `false`, commands must run sandboxed or be listed in `excludedCommands`.

- **Type:** boolean
- **Default:** `true`

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false
  }
}
```

### `sandbox.enableWeakerNestedSandbox`

Enables a weaker sandbox mode for unprivileged Docker environments that lack namespace support. **Significantly reduces sandbox security** — only use when additional isolation is enforced externally.

- **Type:** boolean
- **Default:** `false`
- **Platform:** Linux and WSL2 only

```json
{
  "sandbox": {
    "enabled": true,
    "enableWeakerNestedSandbox": true
  }
}
```

### `sandbox.enableWeakerNetworkIsolation`

Allows access to macOS TLS trust service (`com.apple.trustd.agent`) inside the sandbox. Required for Go-based tools (`gh`, `gcloud`, `terraform`) to verify TLS certificates when using custom CA certificates with HTTP proxies. **Reduces security** by opening a potential data exfiltration path.

- **Type:** boolean
- **Default:** `false`
- **Platform:** macOS only

```json
{
  "sandbox": {
    "enabled": true,
    "enableWeakerNetworkIsolation": true
  }
}
```

---

## Filesystem Properties (`sandbox.filesystem.*`)

### Path Prefix Conventions

All filesystem path arrays use these prefixes:

| Prefix | Meaning | Example |
|--------|---------|---------|
| `/path` | Absolute from filesystem root | `/tmp/build` |
| `~/path` | Relative to home directory | `~/.kube` |
| `./path` | Relative to project root (project settings) or `~/.claude` (user settings) | `./output` |
| `//path` | Legacy absolute (still supported) | `//var/log` |

All filesystem arrays are **merged across settings scopes** (managed + user + project + local), not replaced.

### `sandbox.filesystem.allowWrite`

Grants write access to additional paths beyond the current working directory.

- **Type:** array of path strings
- **Default:** `[]` (only cwd is writable)

```json
{
  "sandbox": {
    "filesystem": {
      "allowWrite": [
        "/tmp/build",
        "~/.kube",
        "./output"
      ]
    }
  }
}
```

### `sandbox.filesystem.denyWrite`

Blocks write access to specific paths. Also merges with paths from `Edit(...)` deny permission rules.

- **Type:** array of path strings
- **Default:** `[]`

```json
{
  "sandbox": {
    "filesystem": {
      "denyWrite": [
        "/etc",
        "/usr/local/bin",
        "~/secrets"
      ]
    }
  }
}
```

### `sandbox.filesystem.denyRead`

Blocks read access to specific paths. Also merges with paths from `Read(...)` deny permission rules.

- **Type:** array of path strings
- **Default:** `[]`

```json
{
  "sandbox": {
    "filesystem": {
      "denyRead": [
        "~/.aws/credentials",
        "~/.ssh/private-keys"
      ]
    }
  }
}
```

### `sandbox.filesystem.allowRead`

Carves exceptions within a `denyRead` region. Takes precedence over `denyRead`.

- **Type:** array of path strings
- **Default:** `[]`

```json
{
  "sandbox": {
    "filesystem": {
      "denyRead": ["~/"],
      "allowRead": ["."]
    }
  }
}
```

This blocks reading the entire home directory but allows reading the project directory.

### `sandbox.filesystem.allowManagedReadPathsOnly`

**(Managed settings only)** Restricts `allowRead` to only paths from managed settings; ignores user/project/local `allowRead` entries.

- **Type:** boolean
- **Default:** `false`

```json
{
  "sandbox": {
    "filesystem": {
      "allowManagedReadPathsOnly": true
    }
  }
}
```

---

## Network Properties (`sandbox.network.*`)

### `sandbox.network.allowedDomains`

Domains that Bash commands can access for outbound network traffic. Domains not listed trigger a user confirmation prompt. Supports wildcard subdomains.

- **Type:** array of domain strings
- **Default:** `[]`

```json
{
  "sandbox": {
    "network": {
      "allowedDomains": [
        "github.com",
        "*.npmjs.org",
        "registry.yarnpkg.com",
        "*.example.com"
      ]
    }
  }
}
```

### `sandbox.network.allowManagedDomainsOnly`

**(Managed settings only)** Only allows domains from managed settings. Non-allowed domains are **blocked automatically without prompting** (unlike the default behavior which prompts). Denied domains from all scopes are still respected.

- **Type:** boolean
- **Default:** `false`

```json
{
  "sandbox": {
    "network": {
      "allowManagedDomainsOnly": true,
      "allowedDomains": ["github.com", "internal-registry.example.com"]
    }
  }
}
```

### `sandbox.network.allowUnixSockets`

Allows access to specific Unix socket paths. Used for SSH agents, Docker sockets, etc.

- **Type:** array of socket path strings
- **Default:** `[]`

> **Warning:** Allowing Docker socket (`/var/run/docker.sock`) grants host system access and can enable sandbox bypasses.

```json
{
  "sandbox": {
    "network": {
      "allowUnixSockets": [
        "~/.ssh/agent-socket",
        "/var/run/ssh-agent"
      ]
    }
  }
}
```

### `sandbox.network.allowAllUnixSockets`

Allows access to **all** Unix sockets. **Significantly weakens sandbox security** — grants access to powerful system services.

- **Type:** boolean
- **Default:** `false`

```json
{
  "sandbox": {
    "network": {
      "allowAllUnixSockets": true
    }
  }
}
```

### `sandbox.network.allowLocalBinding`

Allows processes to bind to localhost ports (start local servers).

- **Type:** boolean
- **Default:** `false`
- **Platform:** macOS only

```json
{
  "sandbox": {
    "network": {
      "allowLocalBinding": true
    }
  }
}
```

### `sandbox.network.httpProxyPort`

HTTP proxy port for outbound network traffic from sandboxed commands. If not specified, Claude Code manages its own proxy automatically.

- **Type:** integer (1–65535)
- **Default:** automatic

```json
{
  "sandbox": {
    "network": {
      "httpProxyPort": 8080
    }
  }
}
```

### `sandbox.network.socksProxyPort`

SOCKS5 proxy port for outbound network traffic from sandboxed commands. If not specified, Claude Code manages its own proxy automatically.

- **Type:** integer (1–65535)
- **Default:** automatic

```json
{
  "sandbox": {
    "network": {
      "socksProxyPort": 8081
    }
  }
}
```

---

## How Sandbox and Permissions Interact

Permissions and sandbox are **two layers** that work together:

1. **Permissions** (tool-level): control which tools Claude can invoke — evaluated first
2. **Sandbox** (OS-level): enforce what Bash commands can actually access on disk and network — applied to Bash execution only

### Which tools each layer covers

- **Sandbox:** Bash commands only. Every Bash invocation runs inside the sandbox's namespace isolation, subject to filesystem and network rules.
- **Permissions:** All tools — Read, Write, Edit, Bash, WebFetch, WebSearch, Agent, and MCP tools.
- **Native tools bypass the sandbox entirely.** Read, Write, Edit, WebFetch, WebSearch, and Agent do not run inside the sandbox. Only `permissions.deny` rules can block native tool access.

### Merge direction: permissions feed into sandbox

Path patterns from `permissions.deny` merge **into** the sandbox's filesystem lists. One-way: permissions feed into sandbox, not the reverse.

- `Read(...)` deny rule paths merge into `sandbox.filesystem.denyRead`
- `Edit(...)` deny rule paths merge into `sandbox.filesystem.denyWrite`

The practical effect: `Read(.env*)` blocks both the Read tool and `cat .env` in Bash. A `sandbox.filesystem.denyRead` entry alone only blocks Bash — native tools would still have access.

### Error attribution

Because merged path lists blur the boundary between layers, Claude may report a permissions-layer block as "sandbox policy." The block is real; the attribution is just imprecise.

### Deny rules under bypassPermissions

`permissions.deny` rules are enforced regardless of `defaultMode`. Bypass mode skips prompts, not deny rules — making `bypassPermissions` + targeted denies a practical production configuration. See the [Permissions Guide](permissions-guide.md#permissionsdefaultmode).

---

## Complete Example

```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["docker", "watchman"],
    "allowUnsandboxedCommands": false,
    "enableWeakerNestedSandbox": false,
    "enableWeakerNetworkIsolation": false,
    "filesystem": {
      "allowWrite": ["/tmp/build", "~/.kube", "./output"],
      "denyWrite": ["/etc", "/usr/local/bin", "~/secrets"],
      "denyRead": ["~/.aws/credentials", "~/.ssh/private-keys"],
      "allowRead": ["."],
      "allowManagedReadPathsOnly": false
    },
    "network": {
      "allowedDomains": [
        "github.com",
        "*.npmjs.org",
        "registry.yarnpkg.com"
      ],
      "allowManagedDomainsOnly": false,
      "allowUnixSockets": ["~/.ssh/agent-socket"],
      "allowAllUnixSockets": false,
      "allowLocalBinding": true,
      "httpProxyPort": 8080,
      "socksProxyPort": 8081
    }
  }
}
```

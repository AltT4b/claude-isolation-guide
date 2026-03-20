---
logged: 2026-03-20
context: Scoping 01-permissions-rewrite — MCP permissions were out of scope for the permissions-only scenario
---

## MCP Tool Permissions Scenario

`permissions.deny` and `permissions.allow` can target MCP tools using the `mcp__<server>__<tool>` pattern syntax. This deserves its own scenario because:

- Needs a real (or stub) MCP server running to test against
- Pattern matching behavior (`mcp__*__*` vs specific server/tool combos) needs verification
- Interaction between MCP tool permissions and regular tool permissions is undocumented

### What the scenario should cover

- Deny a specific MCP tool: `mcp__<server>__<tool>`
- Deny all tools from a server: `mcp__<server>__*`
- Allow a specific MCP tool while denying the rest
- Verify `permission_denials` output format for MCP tools

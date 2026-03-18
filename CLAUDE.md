# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

This is a new/empty repository. Update this file as the project takes shape with build commands, architecture notes, and development workflows.

## Sandbox Environment

- Persistent env vars: append `export VAR=value` to `/etc/sandbox-persistent.sh` (sourced via `CLAUDE_ENV_FILE`)
- If a tool isn't found in PATH after installation, use `bash -l -c "command"` to pick up the updated environment
- **Never** add shell completion scripts to `/etc/sandbox-persistent.sh` — they break the bash tool (silent failures on all commands)
- Available package managers: npm, pip, uv
- sudo is available for system packages
- Docker daemon is available; published ports accessible on localhost
- Outbound network is firewalled — request access for specific domains/ports as needed

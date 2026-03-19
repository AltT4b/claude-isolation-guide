#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Validate CLAUDE_ENV_FILE configuration and demonstrate the
// completion script trap.
//
// What it tests (automated):
//   1. CLAUDE_ENV_FILE is set and points to an existing file
//   2. Env file has correct structure (tool init, no completions)
//   3. Bad env file demonstrates the completion script trap
//
// Interactive proof (cannot be automated — requires Claude's Bash tool):
//   Ask Claude to run: echo $PROJECT_ENV
//   If it returns "sandbox-testing", auto-sourcing is working.
//
// Usage:
//   npm test      # runs this script
//
// Requires: Node.js >= 18
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// -- Colors -----------------------------------------------------------------
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// -- Counters ---------------------------------------------------------------
let passCount = 0;
let failCount = 0;

// -- Output helpers ---------------------------------------------------------
function banner(title) {
  console.log();
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}  ${title}${RESET}`);
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
}

function info(msg) { console.log(`  ${BOLD}What:${RESET}  ${msg}`); }
function why(msg)  { console.log(`  ${BOLD}Why:${RESET}   ${msg}`); }
function cmd(msg)  { console.log(`  ${BOLD}Cmd:${RESET}   ${msg}`); }

function pass(msg) {
  console.log(`  ${GREEN}PASS${RESET} — ${msg}`);
  passCount++;
}

function fail(msg) {
  console.log(`  ${RED}FAIL${RESET} — ${msg}`);
  failCount++;
}

function warn(msg) {
  console.log(`  ${YELLOW}WARN${RESET} — ${msg}`);
}

// -- Paths ------------------------------------------------------------------
const goodEnvFile = path.join(__dirname, "sandbox-persistent.sh");
const badEnvFile = path.join(__dirname, "sandbox-persistent-bad.sh");

// ---------------------------------------------------------------------------
// Test 1: CLAUDE_ENV_FILE is set and points to a real file
// ---------------------------------------------------------------------------
banner("Test 1 — CLAUDE_ENV_FILE Is Configured");
info("Checking that CLAUDE_ENV_FILE is set in the environment.");
why("Claude sources this file before every Bash tool invocation.");
why("If unset or pointing to a missing file, env persistence won't work.");

{
  const envFileVar = process.env.CLAUDE_ENV_FILE;
  if (envFileVar) {
    pass(`CLAUDE_ENV_FILE is set: ${envFileVar}`);
    if (fs.existsSync(envFileVar)) {
      pass("File exists at the configured path.");
    } else {
      fail(`File does not exist: ${envFileVar}`);
    }
  } else {
    warn("CLAUDE_ENV_FILE is not set in this environment.");
    warn("This is expected when running outside a Claude sandbox.");
    warn("Falling back to validating the fixture file directly.");
    if (fs.existsSync(goodEnvFile)) {
      pass(`Fixture env file exists: ${goodEnvFile}`);
    } else {
      fail("Fixture env file not found.");
    }
  }
}

// ---------------------------------------------------------------------------
// Test 2: Env file structure is correct
// ---------------------------------------------------------------------------
banner("Test 2 — Env File Structure");
info("Checking that the env file has tool init and no completion scripts.");
why("CLAUDE_ENV_FILE is sourced before EVERY command — keep it lean, no completions.");

{
  // Use the real CLAUDE_ENV_FILE if set, otherwise validate the fixture
  const fileToCheck = process.env.CLAUDE_ENV_FILE && fs.existsSync(process.env.CLAUDE_ENV_FILE)
    ? process.env.CLAUDE_ENV_FILE
    : goodEnvFile;

  const content = fs.readFileSync(fileToCheck, "utf8");

  // Check for expected patterns
  const hasNvmDir = /NVM_DIR/.test(content);
  const hasSdkmanDir = /SDKMAN_DIR/.test(content);
  const hasProjectEnv = /PROJECT_ENV/.test(content);

  // Check for forbidden patterns (active completion lines)
  const hasActiveCompletion = content.split("\n").some(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith("#") && /bash_completion/.test(trimmed);
  });

  if (hasNvmDir && hasSdkmanDir && hasProjectEnv) {
    pass("Env file contains expected tool initialization (nvm, sdkman, PROJECT_ENV).");
  } else {
    const missing = [];
    if (!hasNvmDir) missing.push("NVM_DIR");
    if (!hasSdkmanDir) missing.push("SDKMAN_DIR");
    if (!hasProjectEnv) missing.push("PROJECT_ENV");
    fail(`Env file is missing: ${missing.join(", ")}.`);
  }

  if (hasActiveCompletion) {
    fail("Env file contains active completion scripts — this will break Bash.");
  } else {
    pass("Env file has no active completion scripts.");
  }
}

// ---------------------------------------------------------------------------
// Test 3: Bad env file demonstrates the completion trap
// ---------------------------------------------------------------------------
banner("Test 3 — Completion Script Trap (Demonstration)");
info("Sourcing the bad env file to show the silent failure mode.");
why("Completion scripts reference COMP_WORDS/COMP_CWORD/COMPREPLY — variables that");
why("only exist during tab completion. Sourcing them during normal execution causes");
why("silent failure: commands run but produce no output.");

{
  // First, prove that echo works with the good file (baseline)
  const goodCmd = `bash -c 'source "${goodEnvFile}" && echo "hello from sandbox"'`;
  cmd(goodCmd);
  try {
    const goodOutput = execSync(goodCmd, { encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (goodOutput === "hello from sandbox") {
      pass("Baseline: echo produces output after sourcing good env file.");
    } else {
      fail(`Baseline: expected "hello from sandbox", got: "${goodOutput}".`);
    }
  } catch (err) {
    fail("Baseline: command failed after sourcing good env file.");
  }

  // Now show that the bad file kills output
  const badCmd = `bash -c 'source "${badEnvFile}" 2>/dev/null && echo "hello from sandbox"'`;
  cmd(badCmd);
  try {
    const badOutput = execSync(badCmd, { encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (badOutput === "") {
      pass("Bad env file causes silent failure — echo produced no output.");
    } else if (badOutput === "hello from sandbox") {
      warn("nvm is not installed, so the bad completion line was skipped (conditional source).");
      warn("On a system with nvm installed, this would produce empty output.");
      const content = fs.readFileSync(badEnvFile, "utf8");
      const hasActive = content.split("\n").some(line =>
        !line.trim().startsWith("#") && /bash_completion/.test(line)
      );
      if (hasActive) {
        pass("Bad env file contains active completion script (would break on systems with nvm).");
      } else {
        fail("Bad env file is missing the active completion line.");
      }
    } else {
      fail(`Unexpected output: "${badOutput}".`);
    }
  } catch (err) {
    pass("Bad env file caused command failure (error instead of silent failure).");
  }
}

// ---------------------------------------------------------------------------
// Interactive Proof
// ---------------------------------------------------------------------------
banner("Interactive Proof — Verify Claude's Auto-Sourcing");
console.log();
console.log(`  The automated tests above validate configuration and demonstrate the`);
console.log(`  completion trap. But they can't prove that Claude actually sources the`);
console.log(`  env file — that only happens inside Claude's Bash tool pipeline.`);
console.log();
console.log(`  ${BOLD}Run this to prove it:${RESET}`);
console.log();
console.log(`    CLAUDE_ENV_FILE="$(pwd)/sandbox-persistent.sh" \\`);
console.log(`      claude -p 'Run this exact command and show me the output: echo \$PROJECT_ENV'`);
console.log();
console.log(`  If Claude's response includes ${GREEN}sandbox-testing${RESET}, auto-sourcing is active.`);
console.log(`  If it returns an empty line, the file is not being sourced.`);
console.log();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
banner("Summary");
const total = passCount + failCount;
console.log();
console.log(`  ${GREEN}Passed:${RESET} ${passCount} / ${total}`);
console.log(`  ${RED}Failed:${RESET} ${failCount} / ${total}`);
console.log();

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed. Configuration is correct.${RESET}`);
  console.log(`  ${BOLD}Next:${RESET} Run the interactive proof above to confirm Claude's auto-sourcing.`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

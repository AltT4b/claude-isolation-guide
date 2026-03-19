#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Prove that CLAUDE_ENV_FILE environment persistence works.
//
// What it tests:
//   1. Good env file is syntactically valid (sources without error)
//   2. Good env file sets expected vars (PROJECT_ENV)
//   3. Bad env file contains completion scripts (flagged as dangerous)
//   4. Login shell picks up env file via CLAUDE_ENV_FILE
//   5. Env file exists and has the right structure
//
// This scenario does NOT use srt — it tests shell environment files directly.
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
// Test 1: Good env file is syntactically valid
// ---------------------------------------------------------------------------
banner("Test 1 — Good Env File Is Syntactically Valid");
info("Sourcing sandbox-persistent.sh and checking exit code.");
why("CLAUDE_ENV_FILE is sourced before every Bash command.");
why("A syntax error here would break every single command execution.");

{
  const command = `bash -c 'source "${goodEnvFile}"'`;
  cmd(command);
  try {
    execSync(command, { encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
    pass("sandbox-persistent.sh sources without errors.");
  } catch (err) {
    const output = (err.stdout || "") + (err.stderr || "");
    fail("sandbox-persistent.sh failed to source.");
    console.log(`       Output: ${output.trim()}`);
  }
}

// ---------------------------------------------------------------------------
// Test 2: Good env file sets expected vars
// ---------------------------------------------------------------------------
banner("Test 2 — Good Env File Sets Expected Variables");
info("Sourcing sandbox-persistent.sh and checking that PROJECT_ENV is set.");
why("Environment variables defined in CLAUDE_ENV_FILE should persist across commands.");
why("If PROJECT_ENV is not set, the env file is not doing its job.");

{
  const command = `bash -c 'source "${goodEnvFile}" && echo "$PROJECT_ENV"'`;
  cmd(command);
  try {
    const output = execSync(command, { encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (output === "sandbox-testing") {
      pass(`PROJECT_ENV is set to "${output}".`);
    } else {
      fail(`PROJECT_ENV is "${output}" — expected "sandbox-testing".`);
    }
  } catch (err) {
    const output = (err.stdout || "") + (err.stderr || "");
    fail("Failed to read PROJECT_ENV after sourcing.");
    console.log(`       Output: ${output.trim()}`);
  }
}

// ---------------------------------------------------------------------------
// Test 3: Bad env file contains completion scripts
// ---------------------------------------------------------------------------
banner("Test 3 — Bad Env File Contains Completion Scripts");
info("Scanning sandbox-persistent-bad.sh for bash_completion patterns.");
why("Completion scripts rely on COMP_WORDS/COMP_CWORD/COMPREPLY — variables that");
why("only exist during tab completion, not during normal command execution.");
why("Sourcing them in CLAUDE_ENV_FILE causes silent failure on ALL commands.");

{
  cmd(`grep bash_completion "${badEnvFile}"`);
  const content = fs.readFileSync(badEnvFile, "utf8");
  const hasCompletionPattern = /bash_completion/.test(content);
  const hasActiveCompletionLine = content.split("\n").some(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith("#") && /bash_completion/.test(trimmed);
  });

  if (hasActiveCompletionLine) {
    pass("Bad env file contains active completion scripts (correctly identified as dangerous).");
  } else if (hasCompletionPattern) {
    warn("bash_completion appears only in comments — expected an active (uncommented) line.");
    fail("Bad env file should have an active completion line for educational purposes.");
  } else {
    fail("Bad env file does not contain bash_completion patterns — expected it for demonstration.");
  }
}

// ---------------------------------------------------------------------------
// Test 4: Login shell picks up env file
// ---------------------------------------------------------------------------
banner("Test 4 — Login Shell Can Source Env File");
info("Using bash -l -c to source the env file and verify it sets expected vars.");
why("bash -l -c is the escape hatch when a tool isn't in PATH after installation.");
why("It forces a fresh login shell that can source the env file.");

{
  const command = `bash -l -c 'source "${goodEnvFile}" && echo "$PROJECT_ENV"'`;
  cmd(`bash -l -c 'source "..." && echo "$PROJECT_ENV"'`);
  try {
    const output = execSync(command, {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (output === "sandbox-testing") {
      pass(`Login shell sources env file and returns PROJECT_ENV="${output}".`);
    } else {
      fail(`Login shell returned "${output}" — expected "sandbox-testing".`);
    }
  } catch (err) {
    const output = (err.stdout || "") + (err.stderr || "");
    fail("Login shell failed to source env file.");
    console.log(`       Output: ${output.trim()}`);
  }
}

// ---------------------------------------------------------------------------
// Test 5: Env file structure is correct
// ---------------------------------------------------------------------------
banner("Test 5 — Env File Structure");
info("Checking that sandbox-persistent.sh exists and has expected content.");
why("CLAUDE_ENV_FILE must point to a file that exists. Missing file = silent failure.");
why("The file should contain tool init scripts but NO completion scripts.");

{
  cmd(`stat "${goodEnvFile}"`);

  if (!fs.existsSync(goodEnvFile)) {
    fail("sandbox-persistent.sh does not exist.");
  } else {
    const content = fs.readFileSync(goodEnvFile, "utf8");

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
      pass("sandbox-persistent.sh contains expected tool initialization.");
    } else {
      const missing = [];
      if (!hasNvmDir) missing.push("NVM_DIR");
      if (!hasSdkmanDir) missing.push("SDKMAN_DIR");
      if (!hasProjectEnv) missing.push("PROJECT_ENV");
      fail(`sandbox-persistent.sh is missing: ${missing.join(", ")}.`);
    }

    if (hasActiveCompletion) {
      fail("sandbox-persistent.sh contains active completion scripts — this will break Bash.");
    } else {
      pass("sandbox-persistent.sh has no active completion scripts.");
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
banner("Summary");
const total = passCount + failCount;
console.log();
console.log(`  ${GREEN}Passed:${RESET} ${passCount} / ${total}`);
console.log(`  ${RED}Failed:${RESET} ${failCount} / ${total}`);
console.log();
console.log(`  ${BOLD}Note:${RESET} These tests verify env file syntax, structure, and the`);
console.log("  completion script trap. They do not test sandbox enforcement —");
console.log("  this scenario is about shell environment persistence, not sandboxing.");
console.log();

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed. Environment persistence is configured correctly.${RESET}`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
  console.log(`  ${YELLOW}Check sandbox-persistent.sh for syntax errors or forbidden patterns.${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

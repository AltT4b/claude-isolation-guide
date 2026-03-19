#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Check prerequisites for Docker AI Sandboxes.
//
// What it tests:
//   1. Docker is available (docker --version)
//   2. Docker sandbox CLI is present (docker sandbox --help)
//
// These are prerequisite checks — an actual Docker AI Sandbox session
// requires Docker Desktop with the sandbox feature enabled and an
// interactive terminal, which cannot be automated here.
//
// Usage:
//   npm install   # installs dependencies
//   npm test      # runs this script
//
// Requires: Node.js >= 18
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Test 1: Docker is available
// ---------------------------------------------------------------------------
banner("Test 1 — Docker Availability");
info("Checking if Docker is installed and accessible.");
why("Docker AI Sandboxes require Docker Desktop to be installed.");
why("The 'docker sandbox' command is provided by Docker Desktop 4.40+.");

{
  cmd("docker --version");
  try {
    const version = execSync("docker --version", { encoding: "utf8", timeout: 10000 }).trim();
    pass(`Docker is available: ${version}`);
  } catch {
    fail("Docker is not installed or not in PATH.");
    warn("Install Docker Desktop from https://www.docker.com/products/docker-desktop/");
    warn("Docker AI Sandboxes require Docker Desktop, not just Docker Engine.");
  }
}

// ---------------------------------------------------------------------------
// Test 2: Docker sandbox CLI is present
// ---------------------------------------------------------------------------
banner("Test 2 — Docker Sandbox CLI");
info("Checking if the 'docker sandbox' subcommand is available.");
why("'docker sandbox run claude' is the entry point for Docker AI Sandboxes.");
why("This subcommand requires Docker Desktop 4.40+ with the AI Sandbox feature.");

{
  cmd("docker sandbox --help");
  try {
    const output = execSync("docker sandbox --help 2>&1", { encoding: "utf8", timeout: 10000 }).trim();
    if (output.toLowerCase().includes("sandbox") || output.toLowerCase().includes("usage")) {
      pass("'docker sandbox' CLI is available.");
    } else {
      fail("'docker sandbox' returned unexpected output.");
      console.log(`       Output: ${output.split("\n").slice(0, 3).join("\n       ")}`);
    }
  } catch (err) {
    const output = ((err.stdout || "") + (err.stderr || "")).trim();
    if (output.toLowerCase().includes("not a docker command") || output.toLowerCase().includes("unknown")) {
      fail("'docker sandbox' is not available — Docker Desktop may be too old or not installed.");
      warn("Docker AI Sandboxes require Docker Desktop 4.40+.");
      warn("Update Docker Desktop or check that the AI Sandbox feature is enabled.");
    } else {
      fail("'docker sandbox' command failed.");
      console.log(`       Output: ${output.split("\n").slice(0, 3).join("\n       ")}`);
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
console.log(`  ${BOLD}Note:${RESET} These tests check prerequisites for Docker AI Sandboxes.`);
console.log("  An actual sandbox session requires Docker Desktop with the feature");
console.log("  enabled and an interactive terminal.");
console.log();

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed. Docker AI Sandbox prerequisites are met.${RESET}`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
  console.log(`  ${YELLOW}Docker AI Sandboxes require Docker Desktop 4.40+.${RESET}`);
  console.log(`  ${YELLOW}See: https://docs.docker.com/desktop/features/ai-sandbox/${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

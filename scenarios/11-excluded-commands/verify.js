#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Prove that sandbox + Docker exclusion config is correct.
//
// What it tests:
//   1. Sandbox is enabled (parse settings.json)
//   2. excludedCommands includes docker (parse settings.json)
//   3. allowUnsandboxedCommands is false (parse settings.json)
//   4. Non-docker commands are sandboxed (srt: curl should fail)
//   5. Docker is available (informational — not pass/fail)
//
// Note: We cannot test that Docker commands actually bypass the sandbox
// from within srt. The verify focuses on config correctness and confirms
// sandbox enforcement for non-excluded commands.
//
// Usage:
//   npm install   # installs @anthropic-ai/sandbox-runtime
//   npm test      # runs this script
//
// Requires: Node.js >= 18
// ---------------------------------------------------------------------------

const fs = require("fs");
const os = require("os");
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

// -- Settings transform -----------------------------------------------------
// srt expects the same keys as settings.json but without the "sandbox"
// wrapper, and with relative filesystem paths resolved to absolute ones.

function buildSrtSettings() {
  const settings = JSON.parse(
    fs.readFileSync(path.join(__dirname, ".claude", "settings.json"), "utf8")
  );
  const s = settings.sandbox;
  const cwd = __dirname;
  const home = os.homedir();

  const resolve = (p) =>
    p === "." ? cwd :
    p.startsWith("/") ? p :
    p.startsWith("~/") ? home + p.slice(1) :
    path.join(cwd, p);

  const out = {};

  // Network passes through unchanged — no paths to resolve
  if (s.network) out.network = s.network;

  // Filesystem needs path resolution
  if (s.filesystem) {
    out.filesystem = Object.fromEntries(
      Object.entries(s.filesystem).map(([k, v]) =>
        [k, Array.isArray(v) ? v.map(resolve) : v]
      )
    );
  }

  return out;
}

// -- Sandbox execution ------------------------------------------------------

function sandboxExec(command) {
  const settingsPath = path.join(os.tmpdir(), `srt-settings-${process.pid}.json`);
  fs.writeFileSync(settingsPath, JSON.stringify(srtSettings, null, 2));

  try {
    const output = execSync(`npx srt -s "${settingsPath}" "${command}"`, {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, output: output.trim() };
  } catch (err) {
    const output = (err.stdout || "") + (err.stderr || "");
    return { ok: false, output: output.trim() };
  } finally {
    try { fs.unlinkSync(settingsPath); } catch {}
  }
}

// -- Load settings ----------------------------------------------------------
const settings = JSON.parse(
  fs.readFileSync(path.join(__dirname, ".claude", "settings.json"), "utf8")
);
const sandbox = settings.sandbox;

// -- Build srt settings once ------------------------------------------------
const srtSettings = buildSrtSettings();

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------
banner("Pre-flight Check");
info("Verifying that srt (sandbox runtime) is installed.");
why("srt is the same sandbox runtime that Claude Code uses to execute Bash commands.");
why("Running commands through srt applies identical OS-level restrictions.");

try {
  const version = execSync("npx srt --version", { encoding: "utf8", timeout: 10000 }).trim();
  pass(`srt is available (${version}).`);
} catch {
  fail("srt is NOT available.");
  warn("Run:  npm install");
  warn("Make sure you have Node.js >= 18.");
  console.log("\nCannot continue without the sandbox runtime. Exiting.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Test 1: Sandbox is enabled
// ---------------------------------------------------------------------------
banner("Test 1 — Sandbox Is Enabled");
info("Checking that sandbox.enabled is true in .claude/settings.json.");
why("The sandbox must be enabled for excludedCommands to matter.");
why("Without sandbox enabled, all commands run unsandboxed — exclusions are irrelevant.");

{
  cmd("Parse .claude/settings.json -> sandbox.enabled");
  if (sandbox.enabled === true) {
    pass("sandbox.enabled is true.");
  } else {
    fail(`sandbox.enabled is ${JSON.stringify(sandbox.enabled)} — expected true.`);
  }
}

// ---------------------------------------------------------------------------
// Test 2: excludedCommands includes docker
// ---------------------------------------------------------------------------
banner("Test 2 — excludedCommands Includes Docker");
info("Checking that 'docker' is in sandbox.excludedCommands.");
why("Docker commands are incompatible with the sandbox — they need direct host access.");
why("excludedCommands lets Docker bypass the sandbox while keeping it active for everything else.");

{
  cmd("Parse .claude/settings.json -> sandbox.excludedCommands");
  const excluded = sandbox.excludedCommands;
  if (Array.isArray(excluded) && excluded.includes("docker")) {
    pass(`excludedCommands includes "docker" (full list: ${JSON.stringify(excluded)}).`);
  } else {
    fail(`excludedCommands does not include "docker" — got ${JSON.stringify(excluded)}.`);
  }
}

// ---------------------------------------------------------------------------
// Test 3: allowUnsandboxedCommands is false
// ---------------------------------------------------------------------------
banner("Test 3 — allowUnsandboxedCommands Is False");
info("Checking that sandbox.allowUnsandboxedCommands is false.");
why("This ensures non-excluded commands cannot escape the sandbox.");
why("If true, any command could run unsandboxed — defeating the purpose of excludedCommands.");

{
  cmd("Parse .claude/settings.json -> sandbox.allowUnsandboxedCommands");
  if (sandbox.allowUnsandboxedCommands === false) {
    pass("allowUnsandboxedCommands is false — the escape hatch is closed.");
  } else {
    fail(`allowUnsandboxedCommands is ${JSON.stringify(sandbox.allowUnsandboxedCommands)} — expected false.`);
  }
}

// ---------------------------------------------------------------------------
// Test 4: Non-docker commands are still sandboxed
// ---------------------------------------------------------------------------
banner("Test 4 — Non-Docker Commands Are Sandboxed");
info("Running curl through srt to confirm sandbox enforcement for non-excluded commands.");
why("excludedCommands should only exempt docker — everything else stays sandboxed.");
why("If curl can reach the internet, the sandbox is not enforcing network isolation.");

{
  const command = "curl -sf --max-time 5 https://example.com";
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    fail("curl to example.com succeeded — sandbox may not be enforcing network rules.");
  } else {
    pass("curl to example.com was blocked — non-docker commands are sandboxed.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 5: Docker availability (informational)
// ---------------------------------------------------------------------------
banner("Test 5 — Docker Availability (Informational)");
info("Checking if Docker is installed on this system.");
why("This is informational — Docker availability depends on the host, not the sandbox config.");
why("If Docker is not installed, the excludedCommands config is still valid but untestable.");

{
  cmd("docker --version");
  try {
    const version = execSync("docker --version", { encoding: "utf8", timeout: 10000 }).trim();
    warn(`Docker is available: ${version}`);
    console.log("       Docker commands would bypass the sandbox via excludedCommands.");
  } catch {
    warn("Docker is not installed or not in PATH.");
    console.log("       This does not affect sandbox config correctness.");
    console.log("       Install Docker to test excluded command behavior manually.");
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
console.log(`  ${BOLD}Note:${RESET} Tests 1-3 verify config correctness. Test 4 confirms sandbox`);
console.log("  enforcement for non-excluded commands. Docker bypass behavior cannot");
console.log("  be tested from within srt — see README.md for manual testing.");
console.log();

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed. Sandbox + Docker exclusion config is correct.${RESET}`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
  console.log(`  ${YELLOW}Make sure sandbox is enabled in .claude/settings.json and the`);
  console.log(`  excludedCommands list includes "docker".${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

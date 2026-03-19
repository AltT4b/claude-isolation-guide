#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Prove that Claude Code's native sandbox is working.
//
// Replaces verify.sh: one language, no inline Node-in-bash, no quoting games.
//
// What it tests:
//   1. Filesystem writes outside cwd are blocked
//   2. Outbound network to non-allowed domains is blocked
//   3. Normal operations within cwd still work
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
  const cwd = process.cwd();
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

// -- Build settings once ----------------------------------------------------
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
// Test 1: Write outside cwd should fail
// ---------------------------------------------------------------------------
banner("Test 1 — Write Outside Working Directory");
info("Attempting to create a file outside the current working directory.");
why("The sandbox restricts filesystem writes to cwd and its subdirectories.");
why("A malicious command like 'echo pwned > /tmp/evil' should be blocked.");

{
  const command = `touch /tmp/sandbox-test-write-${process.pid}`;
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    fail("Write to /tmp succeeded — sandbox may not be active.");
  } else {
    pass("Write to /tmp was denied by the sandbox.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 2: Outbound network to non-allowed domain should fail
// ---------------------------------------------------------------------------
banner("Test 2 — Outbound Network to Non-Allowed Domain");
info("Attempting to reach https://example.com (not in the network allowlist).");
why("The sandbox network filter blocks connections to domains not in allowedDomains.");
why("This prevents data exfiltration to attacker-controlled servers.");

{
  const command = "curl -sf --max-time 5 https://example.com";
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    fail("Outbound request to example.com succeeded — network filtering may be off.");
  } else {
    pass("Outbound request to example.com was blocked.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 3: Normal operation within cwd should succeed
// ---------------------------------------------------------------------------
banner("Test 3 — Normal Operation Within Working Directory");
info("Writing, reading, and deleting a temp file inside the current directory.");
why("The sandbox should allow normal file operations within the project directory.");
why("This confirms the sandbox is not overly restrictive.");

{
  const tempFile = `.sandbox-verify-temp-${process.pid}`;
  const command = `echo 'hello sandbox' > ${tempFile} && cat ${tempFile} && rm ${tempFile}`;
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    if (result.output.includes("hello sandbox")) {
      pass("Write/read/delete within cwd succeeded.");
    } else {
      fail(`Command ran but output was unexpected: ${result.output}`);
    }
  } else {
    fail("Normal file operations within cwd failed — sandbox may be too restrictive.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
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

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed. The sandbox is active and working correctly.${RESET}`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
  console.log(`  ${YELLOW}Make sure sandbox is enabled in .claude/settings.json and you are`);
  console.log(`  running inside a Claude Code session with sandbox support.${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

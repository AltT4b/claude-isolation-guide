#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Prove that the combined defense configuration is working.
//
// This is the capstone verify script. It validates both the static
// configuration (settings.json structure) and dynamic sandbox enforcement
// (via srt). Together these confirm all three layers are correctly wired.
//
// What it tests:
//   Config validation:
//     1. Sandbox enabled + escape hatch closed
//     2. Filesystem deny rules present (.env*, .pem, .key)
//     3. Network allowlist is minimal (only expected domains)
//     4. Permissions deny rules present
//   Sandbox enforcement:
//     5. Write outside cwd should fail
//     6. Read .env should fail
//     7. Network to non-allowed domain should fail
//     8. Normal operation within cwd should succeed
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

// -- Load settings ----------------------------------------------------------
const settingsFile = path.join(__dirname, ".claude", "settings.json");
const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));

// -- Settings transform -----------------------------------------------------
// srt expects the same keys as settings.json but without the "sandbox"
// wrapper, and with relative filesystem paths resolved to absolute ones.

function buildSrtSettings() {
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

// ===========================================================================
// PART 1: Config Validation
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 1: Sandbox enabled + escape hatch closed
// ---------------------------------------------------------------------------
banner("Test 1 — Sandbox Enabled + Escape Hatch Closed");
info("Checking that sandbox.enabled is true and allowUnsandboxedCommands is false.");
why("These two settings are the foundation. If the sandbox is off or the escape");
why("hatch is open, none of the other restrictions matter.");

{
  const sandbox = settings.sandbox;
  let ok = true;

  if (sandbox && sandbox.enabled === true) {
    pass("sandbox.enabled is true.");
  } else {
    fail("sandbox.enabled is not true — sandbox is disabled.");
    ok = false;
  }

  if (sandbox && sandbox.allowUnsandboxedCommands === false) {
    pass("sandbox.allowUnsandboxedCommands is false — escape hatch is closed.");
  } else {
    fail("sandbox.allowUnsandboxedCommands is not false — commands can bypass the sandbox.");
    ok = false;
  }
}

// ---------------------------------------------------------------------------
// Test 2: Filesystem deny rules present
// ---------------------------------------------------------------------------
banner("Test 2 — Filesystem Deny Rules Present");
info("Checking that denyRead includes .env*, *.pem, and *.key patterns.");
why("These patterns block Bash-level reads of secret files. Without them,");
why("a command like 'cat .env' could exfiltrate credentials.");

{
  const denyRead = (settings.sandbox.filesystem || {}).denyRead || [];
  const expected = [".env*", "*.pem", "*.key"];

  for (const pattern of expected) {
    if (denyRead.includes(pattern)) {
      pass(`denyRead includes "${pattern}".`);
    } else {
      fail(`denyRead is missing "${pattern}".`);
    }
  }

  const denyWrite = (settings.sandbox.filesystem || {}).denyWrite || [];
  const expectedWrite = [".claude/", "secrets/", ".git/hooks/"];

  for (const pattern of expectedWrite) {
    if (denyWrite.includes(pattern)) {
      pass(`denyWrite includes "${pattern}".`);
    } else {
      fail(`denyWrite is missing "${pattern}".`);
    }
  }
}

// ---------------------------------------------------------------------------
// Test 3: Network allowlist is minimal
// ---------------------------------------------------------------------------
banner("Test 3 — Network Allowlist Is Minimal");
info("Checking that allowedDomains contains only expected domains.");
why("Every domain in the allowlist is a potential exfiltration channel.");
why("A minimal list limits the attack surface.");

{
  const allowed = (settings.sandbox.network || {}).allowedDomains || [];
  const expected = ["api.anthropic.com", "registry.npmjs.org", "pypi.org"];

  for (const domain of expected) {
    if (allowed.includes(domain)) {
      pass(`allowedDomains includes "${domain}".`);
    } else {
      fail(`allowedDomains is missing "${domain}".`);
    }
  }

  const unexpected = allowed.filter((d) => !expected.includes(d));
  if (unexpected.length === 0) {
    pass("No unexpected domains in allowedDomains.");
  } else {
    fail(`Unexpected domains in allowedDomains: ${unexpected.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 4: Permissions deny rules present
// ---------------------------------------------------------------------------
banner("Test 4 — Permissions Deny Rules Present");
info("Checking that permissions.deny blocks Read of secrets and Edit of settings.");
why("Permissions control Claude's built-in tools (Read, Edit, Write).");
why("These run outside the sandbox, so they need their own deny rules.");

{
  const deny = (settings.permissions || {}).deny || [];
  const expected = [
    "Read(.env*)",
    "Read(*.pem)",
    "Read(*.key)",
    "Edit(.claude/settings*)",
    "Write(.claude/settings*)",
  ];

  for (const rule of expected) {
    if (deny.includes(rule)) {
      pass(`permissions.deny includes "${rule}".`);
    } else {
      fail(`permissions.deny is missing "${rule}".`);
    }
  }
}

// ===========================================================================
// PART 2: Sandbox Enforcement (via srt)
// ===========================================================================

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------
banner("Pre-flight Check");
info("Verifying that srt (sandbox runtime) is installed.");
why("srt is the same sandbox runtime that Claude Code uses to execute Bash commands.");
why("Running commands through srt applies identical OS-level restrictions.");

let srtAvailable = false;
let srtSkipped = 0;
try {
  const version = execSync("npx srt --version", { encoding: "utf8", timeout: 10000 }).trim();
  pass(`srt is available (${version}).`);
  srtAvailable = true;
} catch {
  fail("srt is NOT available.");
  warn("Run:  npm install");
  warn("Make sure you have Node.js >= 18.");
  warn("Skipping sandbox enforcement tests (5-8).");
  srtSkipped = 4;
}

if (srtAvailable) {

// ---------------------------------------------------------------------------
// Test 5: Write outside cwd should fail
// ---------------------------------------------------------------------------
banner("Test 5 — Write Outside Working Directory");
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
// Test 6: Read .env should fail
// ---------------------------------------------------------------------------
banner("Test 6 — Read .env.example (denyRead)");
info("Attempting to read .env.example via a sandboxed Bash command.");
why("denyRead: [\".env*\"] should block all reads of files matching .env*.");
why("This protects secrets in .env files from Bash-level exfiltration.");

{
  const command = `cat ${process.cwd()}/.env.example`;
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
// Test 7: Network to non-allowed domain should fail
// ---------------------------------------------------------------------------
banner("Test 7 — Outbound Network to Non-Allowed Domain");
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
// Test 8: Normal operation within cwd should succeed
// ---------------------------------------------------------------------------
banner("Test 8 — Normal Operation Within Working Directory");
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

} // end if (srtAvailable)

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
banner("Summary");
const total = passCount + failCount;
console.log();
console.log(`  ${GREEN}Passed:${RESET} ${passCount} / ${total}`);
console.log(`  ${RED}Failed:${RESET} ${failCount} / ${total}`);
if (srtSkipped > 0) {
  console.log(`  ${YELLOW}Skipped:${RESET} ${srtSkipped} (srt not available — tests 5-8)`);
}
console.log();
console.log(`  ${BOLD}Note:${RESET} Tests 1-4 validate the static configuration.`);
console.log("  Tests 5-8 validate sandbox enforcement via srt.");
console.log("  Container isolation (Layer 3) is validated by running");
console.log("  'docker compose up' — see README.md for details.");
console.log();

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed. Combined defense is correctly configured.${RESET}`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
  console.log(`  ${YELLOW}Make sure sandbox is enabled in .claude/settings.json and the`);
  console.log(`  configuration matches the expected combined defense settings.${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

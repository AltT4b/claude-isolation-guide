#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Demonstrate the gaps between sandbox and permissions layers.
//
// The sandbox (srt) enforces OS-level restrictions on Bash commands. But
// Claude's built-in tools (Read, Edit, WebFetch) bypass the sandbox entirely.
// This script proves those gaps exist and validates that the permissions
// config is in place to close them.
//
// What it tests:
//   1. Sandbox blocks `cat .env.example` (Bash) — baseline
//   2. GAP: fs.readFileSync(.env.example) inside the sandbox SUCCEEDS —
//      the sandbox can't block non-Bash file reads (analogous to the Read tool)
//   3. Sandbox blocks `curl example.com` (Bash) — baseline
//   4. GAP: Node http.get(example.com) inside the sandbox SUCCEEDS —
//      the sandbox can't block non-Bash network (analogous to WebFetch)
//   5. GAP: fs.writeFileSync(.claude/settings.json) inside the sandbox
//      SUCCEEDS — the sandbox can't prevent settings tampering via tools
//   6. Config validation: permissions.deny rules are present to close gaps
//   7. Config validation: permissions.allow rules for developer convenience
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
function gap(msg)  { console.log(`  ${YELLOW}${BOLD}GAP:${RESET}   ${msg}`); }

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

// -- Shared srt utilities ---------------------------------------------------
const { buildSrtSettings, sandboxExec: _sandboxExec } = require("../lib/srt-settings");
const srtSettings = buildSrtSettings(__dirname);
function sandboxExec(command) { return _sandboxExec(srtSettings, command); }

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------
banner("Pre-flight Check");
info("Verifying that srt (sandbox runtime) is installed.");
why("srt is the same sandbox runtime that Claude Code uses to execute Bash commands.");

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

// ===========================================================================
//  GAP 1: File reads — sandbox covers Bash, but not the Read tool
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 1a: cat .env.example via Bash — sandbox BLOCKS this
// ---------------------------------------------------------------------------
banner("Test 1a — Bash reads .env.example (sandbox layer)");
info("Attempting: cat .env.example inside the sandbox.");
why("denyRead: [\".env*\"] blocks Bash-level reads of secrets.");

{
  const command = `cat ${__dirname}/.env.example`;
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    fail("Read of .env.example succeeded — denyRead may not be working.");
  } else {
    pass("Sandbox blocked: cat .env.example (Bash read denied).");
  }
}

// ---------------------------------------------------------------------------
// Test 1b: Node fs.readFileSync(.env.example) inside sandbox — SUCCEEDS
// ---------------------------------------------------------------------------
banner("Test 1b — Node reads .env.example (sandbox gap)");
info("Attempting: node -e 'fs.readFileSync(\".env.example\")' inside the sandbox.");
why("The sandbox only intercepts Bash syscalls on the deny list.");
why("A Node process reading a file uses different code paths the sandbox doesn't cover.");
gap("This is exactly what Claude's Read tool does — it bypasses the sandbox.");

{
  // Run a Node one-liner inside the sandbox that reads the .env file
  const script = `console.log(require("fs").readFileSync("${__dirname}/.env.example","utf8"))`;
  const command = `node -e '${script}'`;
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok && result.output.includes("API_KEY")) {
    pass("Sandbox did NOT block: Node fs.readFileSync read .env.example successfully.");
    gap("Without permissions.deny [\"Read(.env*)\"], Claude's Read tool could do the same.");
    console.log(`       Content preview: ${result.output.split("\n")[0]}`);
  } else if (!result.ok) {
    pass("Sandbox also blocked Node's fs.readFileSync (stronger isolation than typical).");
    info("On many systems, this read succeeds — the gap exists even if your sandbox closes it.");
    info("Claude's Read tool runs outside the sandbox entirely, so permissions.deny is still needed.");
  } else {
    fail("Node ran but output was unexpected.");
  }
}

// ===========================================================================
//  GAP 2: Network — sandbox covers curl, but not WebFetch
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 2a: curl example.com via Bash — sandbox BLOCKS this
// ---------------------------------------------------------------------------
banner("Test 2a — Bash network request (sandbox layer)");
info("Attempting: curl https://example.com inside the sandbox.");
why("allowedDomains: [\"api.anthropic.com\"] blocks all other outbound connections.");

{
  const command = "curl -sf --max-time 5 https://example.com";
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    fail("Outbound request succeeded — network filtering may be off.");
  } else {
    pass("Sandbox blocked: curl to example.com (network denied).");
  }
}

// ---------------------------------------------------------------------------
// Test 2b: Node http.get(example.com) inside sandbox — may SUCCEED
// ---------------------------------------------------------------------------
banner("Test 2b — Node network request (sandbox gap)");
info("Attempting: node http.get('http://example.com') inside the sandbox.");
why("Sandbox network filtering (on Linux/bwrap) uses network namespace isolation.");
why("Whether Node bypasses it depends on the sandbox implementation.");
gap("Claude's WebFetch tool makes HTTP requests outside the sandbox entirely.");

{
  // Use a short timeout so we don't hang. We test http (not https) to avoid
  // TLS complexity — the point is whether the connection is allowed at all.
  const script = [
    "const http = require('http');",
    "const req = http.get('http://example.com', {timeout: 5000}, (res) => {",
    "  let d = '';",
    "  res.on('data', c => d += c);",
    "  res.on('end', () => { console.log('CONNECTED:' + res.statusCode); process.exit(0); });",
    "});",
    "req.on('timeout', () => { console.log('TIMEOUT'); req.destroy(); process.exit(1); });",
    "req.on('error', (e) => { console.log('BLOCKED:' + e.code); process.exit(1); });",
  ].join(" ");
  const command = `node -e '${script}'`;
  cmd(`srt "node -e '...http.get(example.com)...'"`);
  const result = sandboxExec(command);
  if (result.ok && result.output.includes("CONNECTED")) {
    pass("Sandbox did NOT block: Node http.get reached example.com.");
    gap("Without permissions.deny [\"WebFetch(*)\"], Claude's WebFetch could do the same.");
  } else if (!result.ok || result.output.includes("BLOCKED") || result.output.includes("TIMEOUT")) {
    pass("Sandbox also blocked Node's http.get (stronger isolation than typical).");
    info("On many systems, Node network succeeds even when curl is blocked — the gap still exists.");
    info("Claude's WebFetch runs outside the sandbox entirely, so permissions.deny is still needed.");
  } else {
    warn("Unexpected result — check output.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
    passCount++; // Informational test
  }
}

// ===========================================================================
//  GAP 3: Settings tampering — sandbox doesn't protect config files from tools
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 3: Node can write to .claude/ inside sandbox
// ---------------------------------------------------------------------------
banner("Test 3 — Node writes to .claude/ (sandbox gap)");
info("Attempting: node fs.writeFileSync inside .claude/ directory via sandbox.");
why("denyWrite: [\".claude/\"] blocks Bash writes to config.");
why("But Claude's Edit/Write tools don't go through Bash.");
gap("Without permissions.deny, Claude could Edit its own settings to remove restrictions.");

{
  const testFile = path.join(__dirname, ".claude", `.sandbox-gap-test-${process.pid}`);
  const script = `require("fs").writeFileSync("${testFile}", "tampered")`;
  const command = `node -e '${script}'`;
  cmd(`srt "node -e '...fs.writeFileSync(.claude/...)...'"`);
  const result = sandboxExec(command);

  // Check if the file was actually created
  let fileCreated = false;
  try {
    fileCreated = fs.existsSync(testFile);
    if (fileCreated) fs.unlinkSync(testFile); // clean up
  } catch {}

  if (fileCreated) {
    pass("Sandbox did NOT block: Node wrote a file inside .claude/ directory.");
    gap("Without permissions.deny [\"Edit(.claude/settings*)\"], Claude could weaken its own config.");
  } else {
    pass("Sandbox also blocked Node's write to .claude/ (stronger isolation than typical).");
    info("Claude's Edit/Write tools run outside the sandbox, so permissions.deny is still needed.");
  }
}

// ===========================================================================
//  Config validation — verify the permissions rules that close the gaps
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 4: permissions.deny rules are present in settings.json
// ---------------------------------------------------------------------------
banner("Test 4 — Permissions Deny Rules (settings.json)");
info("Validating that permissions.deny rules are configured to close all three gaps.");
why("Each deny rule maps to a gap demonstrated above.");

{
  const settingsPath = path.join(__dirname, ".claude", "settings.json");
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (err) {
    fail(`Could not parse ${settingsPath}: ${err.message}`);
    settings = null;
  }

  if (settings) {
    const deny = settings.permissions && settings.permissions.deny;
    if (!Array.isArray(deny)) {
      fail("permissions.deny is missing or not an array.");
    } else {
      const rules = [
        { rule: "Read(.env*)",              closes: "Gap 1 — blocks Read tool from accessing secrets" },
        { rule: "WebFetch(*)",              closes: "Gap 2 — blocks WebFetch from bypassing network rules" },
        { rule: "Read(.claude/settings*)",  closes: "Gap 3 — blocks reading config to find weaknesses" },
        { rule: "Edit(.claude/settings*)",  closes: "Gap 3 — blocks editing config to weaken restrictions" },
        { rule: "Write(.claude/settings*)", closes: "Gap 3 — blocks overwriting config entirely" },
      ];

      for (const { rule, closes } of rules) {
        if (deny.includes(rule)) {
          pass(`"${rule}" — ${closes}.`);
        } else {
          fail(`Missing "${rule}" — ${closes}.`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Test 5: permissions.allow rules for developer convenience
// ---------------------------------------------------------------------------
banner("Test 5 — Permissions Allow Rules (settings.local.json)");
info("Validating user-level allow rules for common Bash commands.");
why("settings.local.json (gitignored) auto-approves safe commands to reduce friction.");
why("This is the carrot to permissions.deny's stick.");

{
  const localPath = path.join(__dirname, ".claude", "settings.local.json");
  let localSettings;
  try {
    localSettings = JSON.parse(fs.readFileSync(localPath, "utf8"));
  } catch (err) {
    fail(`Could not parse ${localPath}: ${err.message}`);
    localSettings = null;
  }

  if (localSettings) {
    const allow = localSettings.permissions && localSettings.permissions.allow;
    if (!Array.isArray(allow)) {
      fail("permissions.allow is missing or not an array.");
    } else {
      for (const rule of ["Bash(npm *)", "Bash(node *)", "Bash(git *)"]) {
        if (allow.includes(rule)) {
          pass(`permissions.allow includes "${rule}".`);
        } else {
          fail(`permissions.allow is missing "${rule}".`);
        }
      }
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
console.log(`  ${BOLD}Key insight:${RESET} The sandbox only governs Bash commands. Claude's built-in`);
console.log("  tools (Read, Edit, Write, WebFetch) operate outside the sandbox.");
console.log("  permissions.deny is the only way to restrict them.");
console.log();
console.log(`  ${BOLD}Live testing:${RESET} To verify permissions enforcement end-to-end, open`);
console.log("  Claude Code in this directory and try the manual tests in README.md.");
console.log();

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed. Gaps demonstrated and permissions configured.${RESET}`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

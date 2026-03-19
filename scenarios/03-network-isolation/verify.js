#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Prove that sandbox network isolation is working.
//
// Replaces verify.sh: one language, no inline Node-in-bash, no quoting games.
//
// What it tests:
//   1. Allowed domain (httpbin.org) is reachable
//   2. Non-allowed domain (example.com) is blocked
//   3. Another non-allowed domain (icanhazip.com) is blocked
//   4. Localhost is blocked (not in allowedDomains)
//   5. DNS resolution behavior (both outcomes confirm isolation)
//
// Note: WebFetch/WebSearch are Claude's built-in tools and operate
// outside the sandbox. They cannot be tested with srt. See README.md
// for manual testing instructions.
//
// Usage:
//   npm install   # installs @anthropic-ai/sandbox-runtime
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
// Test 1: Allowed domain should be reachable
// ---------------------------------------------------------------------------
banner("Test 1 — Allowed Domain (httpbin.org)");
info("Attempting to reach httpbin.org, which is in allowedDomains.");
why("allowedDomains acts as an allowlist — listed domains should be reachable.");
why("This confirms the sandbox permits traffic to explicitly allowed destinations.");

{
  const command = "curl -sf --max-time 10 https://httpbin.org/get";
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    if (result.output.includes("origin")) {
      pass("Request to httpbin.org succeeded — allowed domain is reachable.");
    } else {
      pass("Request to httpbin.org returned a response (may not be JSON).");
    }
  } else {
    fail("Request to httpbin.org failed — allowed domain should be reachable.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
    warn("This could be a network issue unrelated to the sandbox.");
  }
}

// ---------------------------------------------------------------------------
// Test 2: Non-allowed domain should be blocked
// ---------------------------------------------------------------------------
banner("Test 2 — Blocked Domain (example.com)");
info("Attempting to reach example.com, which is NOT in allowedDomains.");
why("Any domain not listed in allowedDomains is blocked by default.");
why("This is the core of network isolation — default deny, explicit allow.");

{
  const command = "curl -sf --max-time 5 https://example.com";
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    fail("Request to example.com succeeded — network filtering may be off.");
  } else {
    pass("Request to example.com was blocked.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 3: Another non-allowed domain should be blocked
// ---------------------------------------------------------------------------
banner("Test 3 — Another Blocked Domain (icanhazip.com)");
info("Attempting to reach icanhazip.com, which is NOT in allowedDomains.");
why("Testing a second domain confirms this isn't a one-off — it's a policy.");
why("icanhazip.com returns your public IP — a common recon/exfiltration target.");

{
  const command = "curl -sf --max-time 5 https://icanhazip.com";
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    fail("Request to icanhazip.com succeeded — network filtering may be off.");
  } else {
    pass("Request to icanhazip.com was blocked.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 4: Localhost should be blocked (not in allowedDomains)
// ---------------------------------------------------------------------------
banner("Test 4 — Localhost Access");
info("Attempting to reach localhost:9999 (not in allowedDomains).");
why("localhost is not special — it's treated like any other domain.");
why("If you run services on localhost (Docker, dev servers), they're unreachable");
why("from sandboxed Bash unless you add localhost to allowedDomains.");

{
  const command = "curl -sf --max-time 3 http://localhost:9999";
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    fail("Request to localhost succeeded — it should be blocked unless in allowedDomains.");
  } else {
    pass("Request to localhost was blocked (not in allowedDomains).");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 5: DNS resolution vs HTTP blocking
// ---------------------------------------------------------------------------
banner("Test 5 — DNS Resolution");
info("Checking if DNS resolves for a blocked domain (example.com).");
why("The sandbox may block at the socket level, preventing DNS tools from binding.");
why("On macOS, this means DNS lookups also fail — not just HTTP connections.");
why("This is informational — both outcomes are valid sandbox behavior.");

{
  const command = "nslookup example.com";
  cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  const output = result.output;

  if (/address|has address|93\.184/i.test(output)) {
    pass("DNS resolved but HTTP is still blocked — sandbox isolates at the connection level.");
    console.log(`       Output: ${output.split("\n").slice(0, 3).join("\n       ")}`);
  } else {
    pass("DNS also blocked — sandbox isolates at the socket level, preventing bind().");
    console.log(`       Output: ${output.split("\n").slice(0, 3).join("\n       ")}`);
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
console.log(`  ${BOLD}Note:${RESET} These tests cover Bash-level network isolation only.`);
console.log("  WebFetch and WebSearch are Claude's built-in tools and operate");
console.log("  outside the sandbox. See README.md for manual testing instructions.");
console.log();

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed. Network isolation is active and working correctly.${RESET}`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
  console.log(`  ${YELLOW}Make sure sandbox is enabled in .claude/settings.json and the network`);
  console.log(`  rules match the expected configuration for this scenario.${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

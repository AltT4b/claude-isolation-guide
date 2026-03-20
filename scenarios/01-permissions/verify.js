#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Scenario 01: Permissions
//
// Demonstrates that the sandbox only governs Bash commands. Claude's built-in
// tools (Read, Edit, Write, WebFetch) bypass the sandbox entirely. The
// permissions layer (permissions.deny / permissions.allow) closes that gap.
//
// Tests:
//   1. Config: permissions.deny rules present
//   2. Config: allow/deny don't conflict
//   3. Config: settings.local.json has convenience allows
//   4. Gap demo: sandbox blocks `cat .env.example` (Bash)
//   5. Gap demo: Node fs.readFileSync bypasses sandbox
//   6. Gap demo: sandbox blocks `curl example.com` (network)
//   7. Gap demo: Node http.get may bypass sandbox
//
// Usage:
//   npm install
//   npm test
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const t = require("../lib/test-helpers");
const { buildSrtSettings, sandboxExec: _sandboxExec } = require("../lib/srt-settings");

const srtSettings = buildSrtSettings(__dirname);
function sandboxExec(command) { return _sandboxExec(srtSettings, command); }

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------
t.banner("Pre-flight Check");
t.info("Verifying that srt (sandbox runtime) is installed.");
t.why("srt is the same sandbox runtime that Claude Code uses to execute Bash commands.");

try {
  const version = execSync("npx srt --version", { encoding: "utf8", timeout: 10000 }).trim();
  t.pass(`srt is available (${version}).`);
} catch {
  t.fail("srt is NOT available.");
  t.warn("Run:  npm install");
  t.warn("Make sure you have Node.js >= 18.");
  console.log("\nCannot continue without the sandbox runtime. Exiting.");
  process.exit(1);
}

// ===========================================================================
//  Config validation
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 1 — permissions.deny rules present
// ---------------------------------------------------------------------------
t.banner("Test 1 — Config: permissions.deny rules present");
t.info("Checking that settings.json has the expected deny rules.");
t.why("Each deny rule closes a specific gap between the sandbox and Claude's built-in tools.");

const settingsPath = path.join(__dirname, ".claude", "settings.json");
let settings;
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
} catch (err) {
  t.fail(`Could not parse ${settingsPath}: ${err.message}`);
  settings = null;
}

if (settings) {
  const deny = settings.permissions && settings.permissions.deny;
  if (!Array.isArray(deny)) {
    t.fail("permissions.deny is missing or not an array.");
  } else {
    const expectedRules = [
      { rule: "Read(.env*)",              closes: "blocks Read tool from accessing .env secrets" },
      { rule: "Read(*.pem)",              closes: "blocks Read tool from accessing PEM certificates" },
      { rule: "Read(*.key)",              closes: "blocks Read tool from accessing private keys" },
      { rule: "Edit(.claude/settings*)",  closes: "blocks Edit tool from weakening config" },
      { rule: "Write(.claude/settings*)", closes: "blocks Write tool from overwriting config" },
      { rule: "WebFetch(*)",              closes: "blocks WebFetch from bypassing network rules" },
    ];

    let allPresent = true;
    for (const { rule, closes } of expectedRules) {
      if (deny.includes(rule)) {
        t.pass(`"${rule}" — ${closes}.`);
      } else {
        t.fail(`Missing "${rule}" — ${closes}.`);
        allPresent = false;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Test 2 — allow/deny don't conflict
// ---------------------------------------------------------------------------
t.banner("Test 2 — Config: allow/deny don't conflict");
t.info("Checking that no pattern appears in both permissions.allow and permissions.deny.");
t.why("Conflicting rules create confusion about what's actually enforced.");

{
  const deny = (settings && settings.permissions && settings.permissions.deny) || [];

  // Collect allow from both settings.json and settings.local.json
  let allow = (settings && settings.permissions && settings.permissions.allow) || [];

  const localPath = path.join(__dirname, ".claude", "settings.local.json");
  let localSettings;
  try {
    localSettings = JSON.parse(fs.readFileSync(localPath, "utf8"));
    const localAllow = (localSettings.permissions && localSettings.permissions.allow) || [];
    allow = allow.concat(localAllow);
  } catch {
    // settings.local.json may not exist; that's fine for this test
  }

  const conflicts = allow.filter((rule) => deny.includes(rule));
  if (conflicts.length === 0) {
    t.pass("No conflicts between allow and deny rules.");
  } else {
    for (const c of conflicts) {
      t.fail(`"${c}" appears in both allow and deny.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Test 3 — settings.local.json has convenience allows
// ---------------------------------------------------------------------------
t.banner("Test 3 — Config: settings.local.json has convenience allows");
t.info("Checking that settings.local.json pre-approves common safe commands.");
t.why("Allow rules reduce prompt fatigue by auto-approving trusted commands.");

{
  const localPath = path.join(__dirname, ".claude", "settings.local.json");
  let localSettings;
  try {
    localSettings = JSON.parse(fs.readFileSync(localPath, "utf8"));
  } catch (err) {
    t.fail(`Could not parse ${localPath}: ${err.message}`);
    localSettings = null;
  }

  if (localSettings) {
    const allow = localSettings.permissions && localSettings.permissions.allow;
    if (!Array.isArray(allow)) {
      t.fail("permissions.allow is missing or not an array.");
    } else {
      for (const rule of ["Bash(npm *)", "Bash(node *)", "Bash(git *)"]) {
        if (allow.includes(rule)) {
          t.pass(`permissions.allow includes "${rule}".`);
        } else {
          t.fail(`permissions.allow is missing "${rule}".`);
        }
      }
    }
  }
}

// ===========================================================================
//  Gap demonstrations
// ===========================================================================

// Check if the sandbox backend (bwrap/Seatbelt) is available
let srtWorking = false;
{
  const probe = sandboxExec("echo probe");
  if (probe.ok) {
    srtWorking = true;
  } else {
    const output = probe.output.toLowerCase();
    if (output.includes("not available") || output.includes("not installed")) {
      t.banner("Sandbox Backend Not Available");
      t.warn("bubblewrap (bwrap) is not installed — gap demonstration tests will be skipped.");
      t.warn("On Linux, install bwrap: sudo apt-get install bubblewrap");
      t.warn("Config validation tests above are still valid.");
    } else {
      srtWorking = true;
    }
  }
}

if (srtWorking) {

// ---------------------------------------------------------------------------
// Test 4 — sandbox blocks `cat .env.example` (Bash)
// ---------------------------------------------------------------------------
t.banner("Test 4 — Gap demo: sandbox blocks `cat .env.example` (Bash)");
t.info("Attempting: cat .env.example inside the sandbox.");
t.why("sandbox.denyRead blocks Bash-level reads of .env files. This is the baseline.");

{
  const command = `cat ${path.join(__dirname, ".env.example")}`;
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    t.fail("Read of .env.example succeeded — denyRead may not be working.");
  } else {
    t.pass("Sandbox blocked: cat .env.example (Bash read denied).");
  }
}

// ---------------------------------------------------------------------------
// Test 5 — Node fs.readFileSync bypasses sandbox
// ---------------------------------------------------------------------------
t.banner("Test 5 — Gap demo: Node fs.readFileSync bypasses sandbox");
t.info("Attempting: node -e 'fs.readFileSync(\".env.example\")' inside the sandbox.");
t.why("The sandbox only intercepts Bash syscalls on the deny list.");
t.gap("Claude's Read tool operates outside the sandbox entirely — permissions.deny is needed.");

{
  const envPath = path.join(__dirname, ".env.example");
  const script = `console.log(require("fs").readFileSync("${envPath}","utf8"))`;
  const command = `node -e '${script}'`;
  t.cmd(`srt "node -e '...fs.readFileSync(.env.example)...'"`);
  const result = sandboxExec(command);

  if (result.ok && result.output.includes("API_KEY")) {
    t.pass("Node fs.readFileSync read .env.example — sandbox did NOT block it.");
    t.gap("This proves the gap: sandbox.denyRead stops `cat` but not programmatic reads.");
    t.gap("Claude's Read tool works the same way. Only permissions.deny [\"Read(.env*)\"] closes this.");
    console.log(`       Content preview: ${result.output.split("\n")[0]}`);
  } else {
    t.pass("Sandbox also blocked Node's fs.readFileSync (stronger isolation than typical).");
    t.info("On many systems, this read succeeds — the gap exists even if your sandbox closes it.");
    t.info("Claude's Read tool runs outside the sandbox entirely, so permissions.deny is still needed.");
  }
}

// ---------------------------------------------------------------------------
// Test 6 — sandbox blocks `curl example.com` (network)
// ---------------------------------------------------------------------------
t.banner("Test 6 — Gap demo: sandbox blocks `curl example.com` (network)");
t.info("Attempting: curl https://example.com inside the sandbox.");
t.why("sandbox.allowedDomains blocks all outbound connections except api.anthropic.com.");

{
  const command = "curl -sf --max-time 5 https://example.com";
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    t.fail("Outbound request succeeded — network filtering may be off.");
  } else {
    t.pass("Sandbox blocked: curl to example.com (network denied).");
  }
}

// ---------------------------------------------------------------------------
// Test 7 — Node http.get may bypass sandbox
// ---------------------------------------------------------------------------
t.banner("Test 7 — Gap demo: Node http.get may bypass sandbox");
t.info("Attempting: node http.get('http://example.com') inside the sandbox.");
t.why("Sandbox network filtering depends on the implementation (namespaces, seccomp, etc).");
t.gap("Claude's WebFetch tool makes HTTP requests outside the sandbox entirely.");

{
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
  t.cmd(`srt "node -e '...http.get(example.com)...'"`);
  const result = sandboxExec(command);

  if (result.ok && result.output.includes("CONNECTED")) {
    t.pass("Node http.get reached example.com — sandbox did NOT block it.");
    t.gap("This proves the gap: sandbox.network stops `curl` but not programmatic requests.");
    t.gap("Claude's WebFetch works the same way. Only permissions.deny [\"WebFetch(*)\"] closes this.");
  } else {
    t.pass("Sandbox also blocked Node's http.get (stronger isolation than typical).");
    t.info("On many systems, Node network succeeds even when curl is blocked — the gap still exists.");
    t.info("Claude's WebFetch runs outside the sandbox entirely, so permissions.deny is still needed.");
  }
}

} // end if (srtWorking)

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
t.summary("The sandbox only governs Bash. permissions.deny is the only way to restrict Claude's built-in tools.");
process.exit(t.exitCode());

#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Prove that the sandbox works end-to-end.
//
// Tests config validation (settings.json correctness) and enforcement
// (actual OS-level blocking via srt).
//
// What it tests:
//   Part 1 (Config):  sandbox enabled, filesystem deny rules, network
//                     allowlist, escape hatches
//   Part 2 (Enforce): write outside cwd, read .env*, write secrets/,
//                     curl blocked domain, curl allowed domain, normal ops
//
// Usage:
//   npm install   # installs @anthropic-ai/sandbox-runtime
//   npm test      # runs this script
//
// Requires: Node.js >= 18
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const t = require("../lib/test-helpers");
const { buildSrtSettings, sandboxExec: _sandboxExec } = require("../lib/srt-settings");

// -- Load settings ----------------------------------------------------------
const settingsPath = path.join(__dirname, ".claude", "settings.json");
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const sandbox = settings.sandbox;

// -- srt helper -------------------------------------------------------------
const srtSettings = buildSrtSettings(__dirname);
function sandboxExec(command) { return _sandboxExec(srtSettings, command); }

// ===========================================================================
// Pre-flight
// ===========================================================================
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
// Part 1: Config Validation
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 1 — Sandbox enabled + escape hatch closed
// ---------------------------------------------------------------------------
t.banner("Test 1 — Sandbox Enabled + Escape Hatch Closed");
t.info("Checking sandbox.enabled and allowUnsandboxedCommands.");
t.why("enabled must be true for the sandbox to wrap Bash commands.");
t.why("allowUnsandboxedCommands must be false so users can't bypass it.");

{
  let ok = true;

  if (sandbox.enabled === true) {
    t.pass("sandbox.enabled is true.");
  } else {
    t.fail(`sandbox.enabled is ${sandbox.enabled} (expected true).`);
    ok = false;
  }

  if (sandbox.allowUnsandboxedCommands === false) {
    t.pass("allowUnsandboxedCommands is false.");
  } else {
    t.fail(`allowUnsandboxedCommands is ${sandbox.allowUnsandboxedCommands} (expected false).`);
    ok = false;
  }
}

// ---------------------------------------------------------------------------
// Test 2 — Filesystem deny rules present
// ---------------------------------------------------------------------------
t.banner("Test 2 — Filesystem Deny Rules");
t.info("Checking that denyRead and denyWrite contain expected patterns.");
t.why("Deny rules override allow rules — they are the strongest protection.");

{
  const fsConf = sandbox.filesystem || {};
  const denyRead = fsConf.denyRead || [];
  const denyWrite = fsConf.denyWrite || [];

  const expectedDenyRead = [".env*", "~/.ssh"];
  const expectedDenyWrite = ["secrets/", ".claude/", ".git/hooks/"];

  let ok = true;

  for (const pattern of expectedDenyRead) {
    if (denyRead.includes(pattern)) {
      t.pass(`denyRead contains "${pattern}".`);
    } else {
      t.fail(`denyRead is missing "${pattern}".`);
      ok = false;
    }
  }

  for (const pattern of expectedDenyWrite) {
    if (denyWrite.includes(pattern)) {
      t.pass(`denyWrite contains "${pattern}".`);
    } else {
      t.fail(`denyWrite is missing "${pattern}".`);
      ok = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Test 3 — Network allowlist
// ---------------------------------------------------------------------------
t.banner("Test 3 — Network Allowlist");
t.info("Checking allowedDomains contains expected entries and nothing extra.");
t.why("A tight allowlist prevents data exfiltration to unknown servers.");

{
  const netConf = sandbox.network || {};
  const allowed = netConf.allowedDomains || [];
  const expected = ["api.anthropic.com", "registry.npmjs.org"];

  for (const domain of expected) {
    if (allowed.includes(domain)) {
      t.pass(`allowedDomains contains "${domain}".`);
    } else {
      t.fail(`allowedDomains is missing "${domain}".`);
    }
  }

  const unexpected = allowed.filter((d) => !expected.includes(d));
  if (unexpected.length > 0) {
    t.warn(`Unexpected domains in allowlist: ${unexpected.join(", ")}`);
  } else {
    t.pass("No unexpected domains in allowlist.");
  }
}

// ---------------------------------------------------------------------------
// Test 4 — Escape hatches
// ---------------------------------------------------------------------------
t.banner("Test 4 — Escape Hatches (excludedCommands)");
t.info("Checking excludedCommands for expected and unexpected entries.");
t.why("excludedCommands let specific tools bypass the sandbox — keep the list tight.");

{
  const excluded = sandbox.excludedCommands || [];

  if (excluded.includes("docker")) {
    t.pass('excludedCommands contains "docker" (expected for container workflows).');
  } else {
    t.fail('excludedCommands is missing "docker".');
  }

  const expectedExcluded = ["docker", "docker-compose"];
  const unexpected = excluded.filter((c) => !expectedExcluded.includes(c));
  if (unexpected.length > 0) {
    t.warn(`Unexpected excluded commands: ${unexpected.join(", ")}`);
  } else {
    t.pass("No unexpected entries in excludedCommands.");
  }
}

// ===========================================================================
// Part 2: Sandbox Enforcement via srt
// ===========================================================================

// Check if the sandbox backend (bwrap) is available
let srtWorking = false;
{
  // Quick probe: run a trivial command through srt
  const probe = sandboxExec("echo probe");
  if (probe.ok) {
    srtWorking = true;
  } else {
    const output = probe.output.toLowerCase();
    if (output.includes("not available") || output.includes("not installed")) {
      t.banner("Sandbox Backend Not Available");
      t.warn("bubblewrap (bwrap) is not installed — srt enforcement tests will be skipped.");
      t.warn("On Linux, install bwrap: sudo apt-get install bubblewrap");
      t.warn("On macOS, srt uses Seatbelt (built-in) — this should not happen.");
    } else {
      // srt failed for a different reason — might still be working
      srtWorking = true;
    }
  }
}

if (srtWorking) {

// ---------------------------------------------------------------------------
// Test 5 — Write to /tmp blocked
// ---------------------------------------------------------------------------
t.banner("Test 5 — Write to /tmp Blocked");
t.info("Attempting to create a file in /tmp (outside allowWrite).");
t.why("/tmp is outside the working directory — the sandbox should block it.");

{
  const command = `touch /tmp/sandbox-test-${process.pid}`;
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    t.fail("Write to /tmp succeeded — sandbox may not be enforcing filesystem rules.");
  } else {
    t.pass("Write to /tmp was denied by the sandbox.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 6 — Read .env.example blocked
// ---------------------------------------------------------------------------
t.banner("Test 6 — Read .env.example Blocked");
t.info("Attempting to cat .env.example (matched by denyRead .env*).");
t.why("denyRead overrides any implicit read access — secrets stay secret.");

{
  const command = `cat ${__dirname}/.env.example`;
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    t.fail("Reading .env.example succeeded — denyRead may not be working.");
  } else {
    t.pass("Reading .env.example was denied by the sandbox.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 7 — Write to secrets/ blocked
// ---------------------------------------------------------------------------
t.banner("Test 7 — Write to secrets/ Blocked");
t.info("Attempting to write a file into secrets/ (in denyWrite).");
t.why("denyWrite overrides allowWrite — even though cwd is writable, secrets/ is not.");

{
  const command = `echo test > ${__dirname}/secrets/sandbox-test-${process.pid}`;
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    t.fail("Write to secrets/ succeeded — denyWrite may not be working.");
  } else {
    t.pass("Write to secrets/ was denied by the sandbox.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 8 — curl example.com blocked
// ---------------------------------------------------------------------------
t.banner("Test 8 — Outbound Network to Non-Allowed Domain");
t.info("Attempting to reach https://example.com (not in allowedDomains).");
t.why("The network allowlist blocks connections to unlisted domains.");

{
  const command = "curl -sf --max-time 5 https://example.com";
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    t.fail("Outbound request to example.com succeeded — network filtering may be off.");
  } else {
    t.pass("Outbound request to example.com was blocked.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 9 — curl api.anthropic.com allowed
// ---------------------------------------------------------------------------
t.banner("Test 9 — Outbound Network to Allowed Domain");
t.info("Attempting to reach https://api.anthropic.com (in allowedDomains).");
t.why("Allowed domains should be reachable. An HTTP error is fine — the connection itself matters.");

{
  const command = "curl -sf --max-time 5 https://api.anthropic.com";
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  // Connection may succeed with an HTTP error (e.g. 401/403) — that's fine.
  // We check that it wasn't a sandbox/network block.
  if (result.ok) {
    t.pass("Request to api.anthropic.com succeeded.");
  } else {
    // curl -f returns non-zero for HTTP errors (e.g. 401/403) — that's fine.
    // Only fail if the output indicates a sandbox/network deny.
    const output = result.output.toLowerCase();
    if (output.includes("denied") || output.includes("not permitted")) {
      t.fail("Request to api.anthropic.com was blocked by the sandbox.");
    } else {
      t.pass("Connection to api.anthropic.com was allowed (HTTP error is expected without auth).");
    }
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 10 — Normal file ops in cwd succeed
// ---------------------------------------------------------------------------
t.banner("Test 10 — Normal File Operations in Working Directory");
t.info("Writing, reading, and deleting a temp file inside the current directory.");
t.why("The sandbox should allow normal operations within the project directory.");

{
  const tempFile = `.sandbox-verify-temp-${process.pid}`;
  const command = `echo 'hello sandbox' > ${tempFile} && cat ${tempFile} && rm ${tempFile}`;
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    if (result.output.includes("hello sandbox")) {
      t.pass("Write/read/delete within cwd succeeded.");
    } else {
      t.fail(`Command ran but output was unexpected: ${result.output}`);
    }
  } else {
    t.fail("Normal file operations within cwd failed — sandbox may be too restrictive.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

} // end if (srtWorking)

// ===========================================================================
// Summary
// ===========================================================================
t.summary("Sandbox enforcement is working. Every Bash command runs inside OS-level isolation.");
process.exit(t.exitCode());

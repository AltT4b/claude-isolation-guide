#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Scenario 02: Sandbox
//
// Tests sandbox configuration (settings.json correctness) and enforcement
// (actual OS-level blocking via srt, the sandbox runtime).
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

const SCENARIO_DIR = __dirname;
const SETTINGS_PATH = path.join(SCENARIO_DIR, ".claude", "settings.json");

// -- Load settings -----------------------------------------------------------
const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
const sandbox = settings.sandbox;

// -- srt helper --------------------------------------------------------------
const srtSettings = buildSrtSettings(SCENARIO_DIR);
function sandboxExec(command) { return _sandboxExec(srtSettings, command); }

// ===========================================================================
// Pre-flight: verify srt is installed
// ===========================================================================
t.banner("Pre-flight — srt available");
t.info("Checking that srt (sandbox runtime) is installed.");
t.why("srt is the same sandbox runtime that Claude Code uses to wrap Bash commands.");

let srtAvailable = false;
try {
  const version = execSync("npx srt --version", { encoding: "utf8", timeout: 10000 }).trim();
  t.pass(`srt is available (${version}).`);
  srtAvailable = true;
} catch {
  t.fail("srt is NOT available. Run: npm install");
  t.summary("Cannot continue without the sandbox runtime.");
  process.exit(1);
}

// ===========================================================================
// Config validation (no srt calls)
// ===========================================================================

t.banner("Config — sandbox enabled + escape hatch closed");
t.info("Verifying sandbox.enabled and allowUnsandboxedCommands.");
t.why("enabled must be true for the sandbox to wrap Bash commands. allowUnsandboxedCommands must be false so users can't bypass it.");
{
  if (sandbox.enabled === true) {
    t.pass("sandbox.enabled is true.");
  } else {
    t.fail(`sandbox.enabled is ${sandbox.enabled} (expected true).`);
  }

  if (sandbox.allowUnsandboxedCommands === false) {
    t.pass("allowUnsandboxedCommands is false.");
  } else {
    t.fail(`allowUnsandboxedCommands is ${sandbox.allowUnsandboxedCommands} (expected false).`);
  }
}

t.banner("Config — filesystem deny rules");
t.info("Checking that denyRead and denyWrite contain expected patterns.");
t.why("Deny rules override allow rules — they are the strongest filesystem protection.");
{
  const fsConf = sandbox.filesystem || {};
  const denyRead = fsConf.denyRead || [];
  const denyWrite = fsConf.denyWrite || [];

  for (const pattern of [".env*"]) {
    if (denyRead.includes(pattern)) {
      t.pass(`denyRead contains "${pattern}".`);
    } else {
      t.fail(`denyRead is missing "${pattern}".`);
    }
  }

  for (const pattern of ["secrets/"]) {
    if (denyWrite.includes(pattern)) {
      t.pass(`denyWrite contains "${pattern}".`);
    } else {
      t.fail(`denyWrite is missing "${pattern}".`);
    }
  }
}

t.banner("Config — network allowlist");
t.info("Checking allowedDomains contains expected entries and nothing extra.");
t.why("A tight allowlist prevents data exfiltration to unknown servers.");
{
  const allowed = (sandbox.network || {}).allowedDomains || [];
  const expected = ["api.anthropic.com"];

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

t.banner("Config — escape hatches (excludedCommands)");
t.info("Checking excludedCommands for expected and unexpected entries.");
t.why("excludedCommands bypass the sandbox entirely — keep the list tight.");
{
  const excluded = sandbox.excludedCommands || [];
  const expected = ["docker", "docker-compose"];

  for (const cmd of expected) {
    if (excluded.includes(cmd)) {
      t.pass(`excludedCommands contains "${cmd}".`);
    } else {
      t.fail(`excludedCommands is missing "${cmd}".`);
    }
  }

  const unexpected = excluded.filter((c) => !expected.includes(c));
  if (unexpected.length > 0) {
    t.warn(`Unexpected excluded commands: ${unexpected.join(", ")}`);
  } else {
    t.pass("No unexpected entries in excludedCommands.");
  }
}

// ===========================================================================
// Enforcement tests via srt
// ===========================================================================

// Quick probe to check if the sandbox backend works
let srtWorking = false;
{
  const probe = sandboxExec("echo probe");
  if (probe.ok) {
    srtWorking = true;
  } else {
    const output = probe.output.toLowerCase();
    if (output.includes("not available") || output.includes("not installed")) {
      t.banner("Sandbox Backend Not Available");
      t.warn("bubblewrap (bwrap) is not installed — enforcement tests will be skipped.");
      t.warn("On Linux: sudo apt-get install bubblewrap");
      t.warn("On macOS: srt uses Seatbelt (built-in) — this should not happen.");
    } else {
      srtWorking = true;
    }
  }
}

if (srtWorking) {

// ---------------------------------------------------------------------------
t.banner("Test — write to /tmp blocked");
t.info("Attempting to create a file in /tmp (outside allowWrite).");
t.why("/tmp is outside the working directory — the sandbox should block it.");
{
  const command = `touch /tmp/sandbox-test-${process.pid}`;
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (!result.ok) {
    t.pass("Write to /tmp was denied by the sandbox.");
  } else {
    t.fail("Write to /tmp succeeded — sandbox may not be enforcing filesystem rules.");
  }
}

// ---------------------------------------------------------------------------
t.banner("Test — read .env.example blocked");
t.info("Attempting to cat .env.example (matched by denyRead .env*).");
t.why("denyRead overrides any implicit read access — secrets stay secret.");
{
  const command = `cat ${SCENARIO_DIR}/.env.example`;
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (!result.ok) {
    t.pass("Reading .env.example was denied by the sandbox.");
  } else {
    t.fail("Reading .env.example succeeded — denyRead may not be working.");
  }
}

// ---------------------------------------------------------------------------
t.banner("Test — write to secrets/ blocked");
t.info("Attempting to write a file into secrets/ (in denyWrite).");
t.why("denyWrite overrides allowWrite — even though cwd is writable, secrets/ is not.");
{
  const command = `echo test > ${SCENARIO_DIR}/secrets/sandbox-test-${process.pid}`;
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (!result.ok) {
    t.pass("Write to secrets/ was denied by the sandbox.");
  } else {
    t.fail("Write to secrets/ succeeded — denyWrite may not be working.");
  }
}

// ---------------------------------------------------------------------------
t.banner("Test — outbound network to non-allowed domain");
t.info("Attempting to reach https://example.com (not in allowedDomains).");
t.why("The network allowlist blocks connections to unlisted domains.");
{
  const command = "curl -sf --max-time 5 https://example.com";
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (!result.ok) {
    t.pass("Outbound request to example.com was blocked.");
  } else {
    t.fail("Outbound request to example.com succeeded — network filtering may be off.");
  }
}

// ---------------------------------------------------------------------------
t.banner("Test — outbound network to allowed domain");
t.info("Attempting to reach https://api.anthropic.com (in allowedDomains).");
t.why("Allowed domains should be reachable. An HTTP error is fine — the connection itself matters.");
{
  const command = "curl -sf --max-time 5 https://api.anthropic.com";
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok) {
    t.pass("Request to api.anthropic.com succeeded.");
  } else {
    const output = result.output.toLowerCase();
    if (output.includes("denied") || output.includes("not permitted")) {
      t.fail("Request to api.anthropic.com was blocked by the sandbox.");
    } else {
      t.pass("Connection to api.anthropic.com was allowed (HTTP error is expected without auth).");
    }
  }
}

// ---------------------------------------------------------------------------
t.banner("Test — write to parent directory blocked");
t.info("Attempting to create a file in ../ (outside allowWrite).");
t.why("allowWrite only covers cwd — writing to the parent directory is a classic escape.");
{
  const marker = `sandbox-escape-test-${process.pid}`;
  const command = `touch ${path.resolve(SCENARIO_DIR, "..", marker)}`;
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  // Clean up in case the sandbox didn't block it
  const markerPath = path.join(SCENARIO_DIR, "..", marker);
  const escaped = fs.existsSync(markerPath);
  if (escaped) try { fs.unlinkSync(markerPath); } catch {}
  if (!escaped && !result.ok) {
    t.pass("Write to parent directory was denied by the sandbox.");
  } else {
    t.fail("Write to parent directory succeeded — sandbox may not be enforcing allowWrite boundary.");
  }
}

// ---------------------------------------------------------------------------
t.banner("Test — read outside project allowed");
t.info("Reading /etc/hosts (outside project, but not in denyRead).");
t.why("The sandbox allows reads broadly by default — only denyRead patterns are blocked. This contrasts with the .env test above.");
{
  const command = "cat /etc/hosts";
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok && result.output.includes("localhost")) {
    t.pass("Reading /etc/hosts succeeded — reads outside the project are allowed by default.");
  } else if (result.ok) {
    t.pass("Reading /etc/hosts succeeded (unexpected content, but not blocked).");
  } else {
    t.fail("Reading /etc/hosts was blocked — sandbox may be over-restricting reads.");
  }
}

// ---------------------------------------------------------------------------
t.banner("Test — normal file ops in working directory");
t.info("Writing, reading, and deleting a temp file inside the current directory.");
t.why("The sandbox should allow normal operations within the project directory.");
{
  const tempFile = `.sandbox-verify-temp-${process.pid}`;
  const command = `echo 'hello sandbox' > ${tempFile} && cat ${tempFile} && rm ${tempFile}`;
  t.cmd(`srt "${command}"`);
  const result = sandboxExec(command);
  if (result.ok && result.output.includes("hello sandbox")) {
    t.pass("Write/read/delete within cwd succeeded.");
  } else if (result.ok) {
    t.fail(`Command ran but output was unexpected: ${result.output}`);
  } else {
    t.fail("Normal file operations within cwd failed — sandbox may be too restrictive.");
  }
}

} // end if (srtWorking)

// ===========================================================================
// Summary
// ===========================================================================
t.summary("Sandbox enforcement is working. Every Bash command runs inside OS-level isolation.");
process.exit(t.exitCode());

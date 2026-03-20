#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Scenario 03: Containers
//
// Tests Docker container hardening controls. Config checks validate that
// docker-compose.yml has the expected security settings. Enforcement tests
// probe the runtime environment to prove each control is active.
//
// Usage:
//   docker compose build
//   docker compose run --rm sandbox
// ---------------------------------------------------------------------------

const fs = require("fs");
const { execSync } = require("child_process");
const t = require("../lib/test-helpers");

// ---------------------------------------------------------------------------
// Config validation (no runtime probes)
// ---------------------------------------------------------------------------

const COMPOSE_PATH = __dirname + "/docker-compose.yml";
let composeRaw = "";
try {
  composeRaw = fs.readFileSync(COMPOSE_PATH, "utf8");
} catch {}

if (composeRaw) {

t.banner("Config — cap_drop");
t.info("Checking that docker-compose.yml drops all Linux capabilities.");
t.why("cap_drop: [ALL] prevents raw sockets, mount, and kernel tricks — and blocks bwrap inside the container.");
{
  if (/cap_drop:[\s\S]*?-\s*ALL/m.test(composeRaw)) {
    t.pass("cap_drop includes ALL.");
  } else {
    t.fail("cap_drop: [ALL] not found in docker-compose.yml.");
  }
}

t.banner("Config — no-new-privileges");
t.info("Checking that docker-compose.yml prevents privilege escalation.");
t.why("Without this, a setuid binary could regain capabilities that cap_drop removed.");
{
  if (/no-new-privileges:\s*true/m.test(composeRaw)) {
    t.pass("no-new-privileges:true is set.");
  } else {
    t.fail("no-new-privileges:true not found in docker-compose.yml.");
  }
}

t.banner("Config — read_only");
t.info("Checking that docker-compose.yml makes the root filesystem read-only.");
t.why("A read-only root prevents persistent backdoors and config tampering.");
{
  if (/read_only:\s*true/m.test(composeRaw)) {
    t.pass("read_only is true.");
  } else {
    t.fail("read_only: true not found in docker-compose.yml.");
  }
}

t.banner("Config — non-root user");
t.info("Checking that docker-compose.yml sets a non-root user.");
t.why("Running as non-root limits damage if the container is compromised.");
{
  if (/user:\s*["']?\d+:\d+["']?/m.test(composeRaw)) {
    t.pass("user directive is set.");
  } else {
    t.fail("user directive not found in docker-compose.yml.");
  }
}

t.banner("Config — memory limit");
t.info("Checking that docker-compose.yml sets a memory limit.");
t.why("Resource limits prevent OOM-killing the host or starving other containers.");
{
  if (/memory:\s*\S+/m.test(composeRaw)) {
    t.pass("Memory limit is set.");
  } else {
    t.fail("Memory limit not found in docker-compose.yml.");
  }
}

t.banner("Config — network disabled");
t.info("Checking that docker-compose.yml sets network_mode: none.");
t.why("Disables all networking. Docker has no domain-level allowlist — this is the only built-in network lockdown.");
{
  if (/network_mode:\s*none/m.test(composeRaw)) {
    t.pass("network_mode is none.");
  } else {
    t.fail("network_mode: none not found in docker-compose.yml.");
  }
}

} else {
  t.banner("Config — docker-compose.yml");
  t.skip("docker-compose.yml not found — config checks skipped.");
}

// ---------------------------------------------------------------------------
// Enforcement tests (runtime probes)
// ---------------------------------------------------------------------------

t.banner("Test — in-container");
t.info("Checking for signs we're inside a Docker container.");
t.why("All other enforcement tests are meaningless if we're running on the host.");
{
  let inContainer = false;

  if (fs.existsSync("/.dockerenv")) {
    inContainer = true;
  }

  if (!inContainer) {
    try {
      const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
      if (/docker|container|kubepods/i.test(cgroup)) {
        inContainer = true;
      }
    } catch {}
  }

  if (!inContainer) {
    try {
      const mountinfo = fs.readFileSync("/proc/1/mountinfo", "utf8");
      if (/docker|overlay/i.test(mountinfo)) {
        inContainer = true;
      }
    } catch {}
  }

  if (inContainer) {
    t.pass("Running inside a container.");
  } else {
    t.fail("Not running inside a container. Run: docker compose run --rm sandbox");
  }
}

t.banner("Test — non-root user");
t.info("Checking that the process is not running as root (UID 0).");
t.why("A non-root user limits damage if the container is compromised.");
{
  const uid = process.getuid();
  if (uid !== 0) {
    t.pass(`Running as UID ${uid} (non-root).`);
  } else {
    t.fail('Running as root (UID 0). Set user: "1001:1001" in docker-compose.yml.');
  }
}

t.banner("Test — capabilities dropped");
t.info("Checking that the effective capability set is all zeros.");
t.why("Dropping all capabilities prevents raw sockets, mount, and kernel tricks.");
{
  try {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const match = status.match(/^CapEff:\s+([0-9a-fA-F]+)$/m);
    if (match) {
      const capEff = match[1];
      if (parseInt(capEff, 16) === 0) {
        t.pass(`CapEff is ${capEff} — all capabilities dropped.`);
      } else {
        t.fail(`CapEff is ${capEff} — capabilities still present. Add cap_drop: [ALL] to docker-compose.yml.`);
      }
    } else {
      t.fail("Could not find CapEff in /proc/self/status.");
    }
  } catch (err) {
    t.fail(`Could not read /proc/self/status: ${err.message}`);
  }
}

t.banner("Test — read-only root");
t.info("Attempting to write a file to the root filesystem.");
t.why("A read-only root prevents persistent backdoors and config tampering.");
{
  const testFile = "/usr/local/sandbox-verify-test";
  try {
    fs.writeFileSync(testFile, "test");
    try { fs.unlinkSync(testFile); } catch {}
    t.fail("Write to root filesystem succeeded. Add read_only: true to docker-compose.yml.");
  } catch (err) {
    if (err.code === "EROFS" || err.code === "EACCES" || err.code === "EPERM") {
      t.pass(`Write blocked (${err.code}) — root filesystem is read-only.`);
    } else {
      t.fail(`Unexpected error writing to root filesystem: ${err.code} — ${err.message}`);
    }
  }
}

t.banner("Test — resource limits");
t.info("Checking cgroup memory limit is set.");
t.why("Resource limits prevent OOM-killing the host or starving other containers.");
{
  let limitFound = false;

  try {
    const raw = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
    if (raw !== "max") {
      const bytes = parseInt(raw, 10);
      const gb = (bytes / (1024 ** 3)).toFixed(1);
      t.pass(`Memory limit: ${gb} GB (cgroups v2).`);
      limitFound = true;
    }
  } catch {}

  if (!limitFound) {
    try {
      const raw = fs.readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8").trim();
      const bytes = parseInt(raw, 10);
      if (bytes < 2 ** 62) {
        const gb = (bytes / (1024 ** 3)).toFixed(1);
        t.pass(`Memory limit: ${gb} GB (cgroups v1).`);
        limitFound = true;
      }
    } catch {}
  }

  if (!limitFound) {
    t.fail("No memory limit detected. Add deploy.resources.limits.memory to docker-compose.yml.");
  }
}

t.banner("Test — network disabled");
t.info("Attempting to reach an external host via curl.");
t.why("network_mode: none disables all networking — no interfaces except loopback.");
{
  let curlSucceeded = false;
  try {
    execSync("curl -sf --max-time 3 https://example.com", {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    curlSucceeded = true;
  } catch {}

  if (!curlSucceeded) {
    t.pass("Outbound network request failed — networking is disabled.");
  } else {
    t.fail("Outbound request to example.com succeeded. Set network_mode: none in docker-compose.yml.");
  }
}

t.banner("Test — claude CLI installed");
t.info("Checking that the Claude CLI is available in the container.");
t.why("Proves the hardened container can run Claude — the CLI works under all six controls.");
{
  try {
    const version = execSync("claude --version", {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    t.pass(`Claude CLI is installed (${version}).`);
  } catch (err) {
    const output = (err.stdout || "") + (err.stderr || "");
    t.fail(`Claude CLI not found: ${output.trim() || err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

t.summary("0 API calls. Docker build and run only.");
process.exit(t.exitCode());

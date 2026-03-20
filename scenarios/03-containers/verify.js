// ---------------------------------------------------------------------------
// verify.js — Container hardening checks for Scenario 03.
//
// Proves that five Docker security controls are active:
//   1. Running inside a container
//   2. Non-root user
//   3. All capabilities dropped
//   4. Read-only root filesystem
//   5. Resource limits visible
// ---------------------------------------------------------------------------

const fs = require("fs");
const t = require("../lib/test-helpers");

// ── Test 1 — Running inside container ──────────────────────────────────────

t.banner("Test 1 — Running inside container");
t.info("Check for signs we're inside a Docker container.");
t.why("All other tests are meaningless if we're running on the host.");

let inContainer = false;

// Check 1: /.dockerenv exists
if (fs.existsSync("/.dockerenv")) {
  inContainer = true;
}

// Check 2: /proc/1/cgroup contains docker/container/kubepods
if (!inContainer) {
  try {
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
    if (/docker|container|kubepods/i.test(cgroup)) {
      inContainer = true;
    }
  } catch (_) {}
}

// Check 3: /proc/1/mountinfo contains docker or overlay
if (!inContainer) {
  try {
    const mountinfo = fs.readFileSync("/proc/1/mountinfo", "utf8");
    if (/docker|overlay/i.test(mountinfo)) {
      inContainer = true;
    }
  } catch (_) {}
}

if (inContainer) {
  t.pass("Running inside a container.");
} else {
  t.fail("Not running inside a container. Run: docker compose run --rm sandbox");
}

// ── Test 2 — Non-root user ─────────────────────────────────────────────────

t.banner("Test 2 — Non-root user");
t.info("Check that the process is not running as root (UID 0).");
t.why("A non-root user limits damage if the container is compromised.");

const uid = process.getuid();
if (uid !== 0) {
  t.pass(`Running as UID ${uid} (non-root).`);
} else {
  t.fail("Running as root (UID 0). Set user: \"1001:1001\" in docker-compose.yml.");
}

// ── Test 3 — All capabilities dropped ──────────────────────────────────────

t.banner("Test 3 — All capabilities dropped");
t.info("Check that the effective capability set is all zeros.");
t.why("Dropping all capabilities prevents raw sockets, mount, and kernel tricks.");

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

// ── Test 4 — Read-only root filesystem ─────────────────────────────────────

t.banner("Test 4 — Read-only root filesystem");
t.info("Attempt to write a file to the root filesystem.");
t.why("A read-only root prevents persistent backdoors and config tampering.");

const testFile = "/usr/local/sandbox-verify-test";
try {
  fs.writeFileSync(testFile, "test");
  // If we get here, the write succeeded — that's a failure.
  try { fs.unlinkSync(testFile); } catch (_) {}
  t.fail("Write to root filesystem succeeded. Add read_only: true to docker-compose.yml.");
} catch (err) {
  if (err.code === "EROFS" || err.code === "EACCES" || err.code === "EPERM") {
    t.pass(`Write blocked (${err.code}) — root filesystem is read-only.`);
  } else {
    t.fail(`Unexpected error writing to root filesystem: ${err.code} — ${err.message}`);
  }
}

// ── Test 5 — Resource limits visible ───────────────────────────────────────

t.banner("Test 5 — Resource limits visible");
t.info("Check cgroup memory limit is set.");
t.why("Resource limits prevent OOM-killing the host or starving other containers.");

let limitFound = false;

// Try cgroups v2 first
try {
  const raw = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
  if (raw !== "max") {
    const bytes = parseInt(raw, 10);
    const gb = (bytes / (1024 ** 3)).toFixed(1);
    t.pass(`Memory limit: ${gb} GB (cgroups v2).`);
    limitFound = true;
  }
} catch (_) {}

// Fall back to cgroups v1
if (!limitFound) {
  try {
    const raw = fs.readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8").trim();
    const bytes = parseInt(raw, 10);
    // The default "unlimited" value is a huge number close to max int64
    if (bytes < 2 ** 62) {
      const gb = (bytes / (1024 ** 3)).toFixed(1);
      t.pass(`Memory limit: ${gb} GB (cgroups v1).`);
      limitFound = true;
    }
  } catch (_) {}
}

if (!limitFound) {
  t.fail("No memory limit detected. Add deploy.resources.limits.memory to docker-compose.yml.");
}

// ── Summary ────────────────────────────────────────────────────────────────

t.summary("Container hardening is active. These controls enforce isolation even if Claude's app logic is bypassed.");
process.exit(t.exitCode());

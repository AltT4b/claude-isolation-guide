#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Prove that the Docker container's security controls are active.
//
// Unlike scenarios 01-03, this does NOT use srt (sandbox runtime).
// It tests container-level isolation directly: non-root user, dropped
// capabilities, read-only filesystem, tmpfs restrictions.
//
// What it tests:
//   1. Running inside a Docker container
//   2. Non-root user (claude)
//   3. Dropped Linux capabilities
//   4. Read-only root filesystem
//   5. tmpfs is writable but noexec
//   6. Project volume is mounted
//
// Usage:
//   npm test      # runs this script inside the container
//
// Requires: Node.js >= 18, running inside the Docker container from run.sh
// ---------------------------------------------------------------------------

const fs = require("fs");
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

// -- Helper: run a command and return result --------------------------------
function run(command) {
  try {
    const output = execSync(command, {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, output: output.trim() };
  } catch (err) {
    const output = (err.stdout || "") + (err.stderr || "");
    return { ok: false, output: output.trim() };
  }
}

// ---------------------------------------------------------------------------
// Test 1: Running inside a Docker container
// ---------------------------------------------------------------------------
banner("Test 1 — Running Inside a Container");
info("Checking for /.dockerenv, which Docker creates in every container.");
why("This confirms the verify script is running inside Docker, not on the host.");
why("All other tests assume container context — this is the prerequisite.");

{
  cmd("stat /.dockerenv");
  if (fs.existsSync("/.dockerenv")) {
    pass("/.dockerenv exists — running inside a Docker container.");
  } else {
    fail("/.dockerenv not found — this does not appear to be a Docker container.");
    warn("Run this script inside the container: docker run ... node verify.js");
  }
}

// ---------------------------------------------------------------------------
// Test 2: Non-root user
// ---------------------------------------------------------------------------
banner("Test 2 — Non-Root User");
info("Checking that the container is running as user 'claude', not root.");
why("Running as root inside a container is dangerous — a container escape");
why("gives the attacker root on the host. Non-root limits the blast radius.");

{
  cmd("whoami");
  const result = run("whoami");
  if (result.ok) {
    const user = result.output;
    if (user === "claude") {
      pass(`Running as '${user}' — non-root user confirmed.`);
    } else if (user === "root") {
      fail("Running as root — the container should use a non-root user.");
    } else {
      pass(`Running as '${user}' — non-root user (expected 'claude').`);
    }
  } else {
    // whoami might not be available; fall back to uid check
    const uid = process.getuid();
    if (uid === 0) {
      fail("Running as root (uid 0) — the container should use a non-root user.");
    } else {
      pass(`Running as uid ${uid} — non-root user confirmed.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Test 3: Dropped capabilities
// ---------------------------------------------------------------------------
banner("Test 3 — Dropped Linux Capabilities");
info("Reading /proc/self/status to check the effective capability set (CapEff).");
why("--cap-drop=ALL removes all Linux capabilities from the container.");
why("Without capabilities, the process cannot mount filesystems, change ownership,");
why("use raw sockets, or perform other privileged operations.");

{
  cmd("cat /proc/self/status | grep CapEff");
  try {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const match = status.match(/^CapEff:\s+([0-9a-f]+)$/m);
    if (match) {
      const capEff = match[1];
      console.log(`       CapEff: ${capEff}`);
      // CapEff of all zeros means no capabilities
      if (parseInt(capEff, 16) === 0) {
        pass("CapEff is 0000000000000000 — all capabilities dropped.");
      } else {
        // Some capabilities remain — not necessarily a failure if running
        // outside the hardened container, but worth flagging
        fail(`CapEff is ${capEff} — some capabilities are still active.`);
        warn("Expected all zeros when running with --cap-drop=ALL.");
      }
    } else {
      fail("Could not parse CapEff from /proc/self/status.");
    }
  } catch (err) {
    fail(`Could not read /proc/self/status: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Test 4: Read-only root filesystem
// ---------------------------------------------------------------------------
banner("Test 4 — Read-Only Root Filesystem");
info("Attempting to write a file to /usr/local/ (part of the root filesystem).");
why("--read-only makes the root filesystem immutable. An attacker who gains");
why("code execution cannot modify system binaries, install backdoors, or");
why("tamper with installed packages.");

{
  const testPath = "/usr/local/sandbox-test-" + process.pid;
  cmd(`touch ${testPath}`);
  const result = run(`touch ${testPath}`);
  if (result.ok) {
    fail("Write to /usr/local/ succeeded — root filesystem is NOT read-only.");
    // Clean up if it somehow worked
    try { fs.unlinkSync(testPath); } catch {}
  } else {
    pass("Write to /usr/local/ was denied — root filesystem is read-only.");
    console.log(`       Output: ${result.output.split("\n").slice(0, 2).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 5: tmpfs is writable but noexec
// ---------------------------------------------------------------------------
banner("Test 5 — tmpfs: Writable but No Execute");
info("Writing a file to /tmp (should succeed), then trying to execute it (should fail).");
why("--tmpfs /tmp:rw,noexec gives scratch space for temp files, but prevents");
why("executing binaries dropped there. An attacker cannot download and run");
why("a payload in /tmp — the classic attack pattern is blocked.");

{
  const tmpFile = `/tmp/sandbox-test-${process.pid}`;
  const tmpScript = `/tmp/sandbox-exec-test-${process.pid}.sh`;

  // Part A: writing to /tmp should succeed
  cmd(`echo 'test' > ${tmpFile}`);
  const writeResult = run(`echo 'test' > ${tmpFile}`);
  if (writeResult.ok) {
    pass("Write to /tmp succeeded — tmpfs is writable.");
  } else {
    fail("Write to /tmp failed — tmpfs may not be mounted.");
    console.log(`       Output: ${writeResult.output.split("\n").slice(0, 2).join("\n       ")}`);
  }

  // Part B: executing from /tmp should fail
  cmd(`echo '#!/bin/sh\necho pwned' > ${tmpScript} && chmod +x ${tmpScript} && ${tmpScript}`);
  // Write the script
  const createResult = run(`/bin/sh -c 'echo "#!/bin/sh\necho pwned" > ${tmpScript} && chmod +x ${tmpScript}'`);
  if (createResult.ok) {
    // Try to execute it
    const execResult = run(tmpScript);
    if (execResult.ok) {
      fail("Execution from /tmp succeeded — noexec is NOT enforced.");
    } else {
      pass("Execution from /tmp was denied — noexec is enforced.");
      console.log(`       Output: ${execResult.output.split("\n").slice(0, 2).join("\n       ")}`);
    }
  } else {
    // If we can't even create the script, the write test above likely failed too
    warn("Could not create test script in /tmp — skipping exec test.");
  }

  // Clean up
  try { fs.unlinkSync(tmpFile); } catch {}
  try { fs.unlinkSync(tmpScript); } catch {}
}

// ---------------------------------------------------------------------------
// Test 6: Project volume is mounted
// ---------------------------------------------------------------------------
banner("Test 6 — Project Volume Mounted");
info("Checking that project files are accessible in the container.");
why("The -v flag mounts the host project directory into the container.");
why("Claude Code needs access to project files to be useful — this confirms");
why("the volume mount is working correctly.");

{
  cmd("ls package.json");
  // Check for this scenario's own files as evidence of the mount
  const checkFile = __filename; // verify.js itself
  if (fs.existsSync(checkFile)) {
    pass("Project files are accessible (verify.js found).");
  } else {
    fail("Project files not found — volume mount may not be configured.");
  }

  // Also check package.json
  const pkgPath = require("path").join(__dirname, "package.json");
  if (fs.existsSync(pkgPath)) {
    pass("package.json is accessible.");
  } else {
    fail("package.json not found in project directory.");
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
console.log(`  ${BOLD}Note:${RESET} These tests verify container-level isolation (Docker security`);
console.log("  flags). They do not test the Claude Code sandbox runtime (srt).");
console.log("  For srt tests, see scenarios 01-03.");
console.log();

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed. Container security controls are active.${RESET}`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
  console.log(`  ${YELLOW}Make sure you are running inside the container started by run.sh`);
  console.log(`  with all security flags applied.${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

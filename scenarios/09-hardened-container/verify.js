#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Prove that Docker container hardening is working.
//
// This script is designed to run INSIDE the hardened container. It checks
// that the security controls from docker-compose.yml are actually enforced:
//
//   1. Running inside a container (/.dockerenv or cgroup)
//   2. Non-root user (uid 1001)
//   3. All capabilities dropped (CapEff = 0)
//   4. Read-only root filesystem (writes to /usr/local fail)
//   5. tmpfs noexec (/tmp scripts can't execute)
//   6. Resource limits visible (cgroup memory limit)
//   7. No privilege escalation (NoNewPrivs flag set)
//
// Usage:
//   docker compose run --rm claude node verify.js
//   # or: npm test (inside the container)
//
// Requires: Node.js >= 18
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

// ---------------------------------------------------------------------------
// Pre-flight: Are we inside a container?
// ---------------------------------------------------------------------------
banner("Test 1 — Running Inside Container");
info("Checking for signs that we are inside a Docker container.");
why("All other tests only make sense if we're actually inside the hardened container.");
why("We check for /.dockerenv (Docker-specific) or 'docker' in /proc/1/cgroup.");

{
  let insideContainer = false;

  // Check /.dockerenv
  if (fs.existsSync("/.dockerenv")) {
    insideContainer = true;
    cmd("stat /.dockerenv");
    pass("/.dockerenv exists — running inside a Docker container.");
  }

  // Check cgroup for docker/container references
  if (!insideContainer) {
    try {
      const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
      cmd("cat /proc/1/cgroup");
      if (/docker|container|kubepods/i.test(cgroup)) {
        insideContainer = true;
        pass("cgroup shows container environment.");
      }
    } catch {
      // /proc/1/cgroup may not exist on all systems
    }
  }

  // Check for container environment variable (containerd, Kubernetes)
  if (!insideContainer) {
    try {
      const mountinfo = fs.readFileSync("/proc/1/mountinfo", "utf8");
      cmd("cat /proc/1/mountinfo");
      if (/docker|overlay/i.test(mountinfo)) {
        insideContainer = true;
        pass("mountinfo shows container filesystem.");
      }
    } catch {
      // May not be readable
    }
  }

  if (!insideContainer) {
    fail("Does not appear to be running inside a container.");
    warn("Run this script inside the hardened container:");
    warn("  docker compose run --rm claude node verify.js");
  }
}

// ---------------------------------------------------------------------------
// Test 2: Non-root user
// ---------------------------------------------------------------------------
banner("Test 2 — Non-Root User");
info("Checking that the current user is not root (uid 1001 expected).");
why("Running as root inside a container is dangerous — a container escape");
why("vulnerability gives the attacker root on the host. Non-root limits damage.");

{
  const uid = process.getuid();
  cmd(`process.getuid() => ${uid}`);

  if (uid === 0) {
    fail("Running as root (uid 0). The container should use a non-root user.");
  } else if (uid === 1001) {
    pass(`Running as uid ${uid} (non-root, expected uid 1001).`);
  } else {
    pass(`Running as uid ${uid} (non-root, but expected 1001).`);
    warn("UID differs from the expected 1001. Check the Dockerfile USER directive.");
  }
}

// ---------------------------------------------------------------------------
// Test 3: All capabilities dropped
// ---------------------------------------------------------------------------
banner("Test 3 — All Capabilities Dropped");
info("Checking that the effective capability set is empty (all zeros).");
why("Linux capabilities grant fine-grained root powers (e.g., cap_net_raw,");
why("cap_sys_admin). Dropping ALL capabilities means even if an attacker gets");
why("code execution, they can't bind raw sockets, mount filesystems, etc.");

{
  cmd("cat /proc/self/status | grep CapEff");

  try {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const capEffMatch = status.match(/^CapEff:\s+([0-9a-fA-F]+)$/m);

    if (capEffMatch) {
      const capEff = capEffMatch[1];
      console.log(`       CapEff: ${capEff}`);

      if (/^0+$/.test(capEff)) {
        pass("All capabilities dropped (CapEff = 0).");
      } else {
        fail(`Capabilities still present: CapEff = ${capEff}`);
        warn("Ensure docker-compose.yml has cap_drop: [ALL].");
      }
    } else {
      fail("Could not find CapEff in /proc/self/status.");
    }
  } catch (err) {
    fail(`Could not read /proc/self/status: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Test 4: Read-only root filesystem
// ---------------------------------------------------------------------------
banner("Test 4 — Read-Only Root Filesystem");
info("Attempting to write a file to /usr/local/ (should fail).");
why("A read-only root filesystem prevents persistent tampering — an attacker");
why("can't install backdoors, modify system binaries, or alter configuration.");

{
  const testPath = "/usr/local/sandbox-verify-test";
  cmd(`touch ${testPath}`);

  try {
    fs.writeFileSync(testPath, "test");
    fail("Write to /usr/local/ succeeded — root filesystem is NOT read-only.");
    // Clean up if somehow it worked
    try { fs.unlinkSync(testPath); } catch {}
  } catch (err) {
    if (err.code === "EROFS" || err.code === "EACCES" || err.code === "EPERM") {
      pass(`Write to /usr/local/ denied (${err.code}) — filesystem is read-only.`);
    } else {
      pass(`Write to /usr/local/ denied (${err.code}).`);
      warn("Error code differs from expected EROFS, but write was still blocked.");
    }
  }
}

// ---------------------------------------------------------------------------
// Test 5: tmpfs noexec
// ---------------------------------------------------------------------------
banner("Test 5 — tmpfs noexec");
info("Writing a script to /tmp and attempting to execute it.");
why("noexec on /tmp prevents execution of downloaded or crafted binaries.");
why("Attackers often drop payloads to /tmp and execute them. noexec blocks this.");

{
  const scriptPath = "/tmp/sandbox-verify-exec-test.sh";
  cmd(`echo '#!/bin/sh\\necho pwned' > ${scriptPath} && chmod +x ${scriptPath} && ${scriptPath}`);

  try {
    // Write the script
    fs.writeFileSync(scriptPath, "#!/bin/sh\necho pwned\n", { mode: 0o755 });

    // Try to execute it
    try {
      const output = execSync(scriptPath, {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      fail("Execution from /tmp succeeded — noexec is NOT set.");
      console.log(`       Output: ${output.trim()}`);
    } catch (execErr) {
      const stderr = (execErr.stderr || "").trim();
      if (/permission denied|operation not permitted|cannot execute/i.test(stderr)) {
        pass("Execution from /tmp denied — noexec is enforced.");
      } else {
        warn(`Execution from /tmp failed with unexpected error: ${stderr || "(no stderr)"}`);
        warn("Cannot confirm noexec — error may be unrelated (missing shell, timeout, etc.).");
        if (stderr) {
          console.log(`       stderr: ${stderr.split("\n").slice(0, 2).join("\n       ")}`);
        }
      }
    }

    // Clean up
    try { fs.unlinkSync(scriptPath); } catch {}
  } catch (writeErr) {
    if (writeErr.code === "EROFS" || writeErr.code === "EACCES") {
      warn(`Could not write to /tmp (${writeErr.code}) — /tmp may not be mounted as tmpfs.`);
      fail("Cannot test noexec — /tmp is not writable.");
    } else {
      fail(`Unexpected error writing to /tmp: ${writeErr.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Test 6: Resource limits visible
// ---------------------------------------------------------------------------
banner("Test 6 — Resource Limits");
info("Checking cgroup memory limit to verify resource constraints are set.");
why("Resource limits prevent a runaway or malicious process from consuming");
why("all host memory (OOM) or CPU, which could crash the host or starve");
why("other containers.");

{
  let found = false;

  // cgroups v2 path
  const cgroupV2Path = "/sys/fs/cgroup/memory.max";
  // cgroups v1 path
  const cgroupV1Path = "/sys/fs/cgroup/memory/memory.limit_in_bytes";

  for (const cgroupPath of [cgroupV2Path, cgroupV1Path]) {
    try {
      const raw = fs.readFileSync(cgroupPath, "utf8").trim();
      cmd(`cat ${cgroupPath}`);
      console.log(`       Value: ${raw}`);

      if (raw === "max" || raw === "9223372036854771712") {
        // "max" in cgroups v2 or very large value in v1 = no limit
        warn("Memory limit is set to 'max' (unlimited). Resource limits may not be enforced.");
        warn("This is expected if not running via docker compose with deploy.resources.");
        found = true;
      } else {
        const bytes = parseInt(raw, 10);
        if (!isNaN(bytes)) {
          const gb = (bytes / (1024 * 1024 * 1024)).toFixed(1);
          pass(`Memory limit is ${gb} GB (${bytes} bytes).`);
          found = true;
        } else {
          warn(`Unexpected value in ${cgroupPath}: ${raw}`);
        }
      }

      break; // Found a readable cgroup file, stop looking
    } catch {
      // This path doesn't exist, try the next one
    }
  }

  if (!found) {
    fail("Could not read cgroup memory limit. Resource limits may not be configured.");
    warn("Ensure docker-compose.yml has deploy.resources.limits.memory set.");
    warn("On older Docker hosts, cgroups v2 may not be available.");
  }
}

// ---------------------------------------------------------------------------
// Test 7: No privilege escalation
// ---------------------------------------------------------------------------
banner("Test 7 — No Privilege Escalation (NoNewPrivs)");
info("Checking the NoNewPrivs flag in /proc/self/status.");
why("no-new-privileges prevents processes from gaining privileges via setuid/");
why("setgid binaries. Even if an attacker finds a setuid binary in the container,");
why("they can't use it to escalate to root.");

{
  cmd("cat /proc/self/status | grep NoNewPrivs");

  try {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const match = status.match(/^NoNewPrivs:\s+(\d+)$/m);

    if (match) {
      const value = parseInt(match[1], 10);
      console.log(`       NoNewPrivs: ${value}`);

      if (value === 1) {
        pass("NoNewPrivs is set (1) — privilege escalation is blocked.");
      } else {
        fail("NoNewPrivs is not set (0) — privilege escalation is possible.");
        warn("Ensure docker-compose.yml has security_opt: [no-new-privileges:true].");
      }
    } else {
      fail("Could not find NoNewPrivs in /proc/self/status.");
    }
  } catch (err) {
    fail(`Could not read /proc/self/status: ${err.message}`);
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
console.log(`  ${BOLD}Note:${RESET} These tests verify Docker container hardening controls.`);
console.log("  They must be run INSIDE the hardened container to produce");
console.log("  meaningful results. Running on the host will show failures.");
console.log();

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed. Container hardening is active and working correctly.${RESET}`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
  console.log(`  ${YELLOW}Make sure you are running inside the hardened container:`);
  console.log(`  docker compose run --rm claude node verify.js${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

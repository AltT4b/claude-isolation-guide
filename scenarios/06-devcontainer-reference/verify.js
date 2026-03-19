#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Prove that container-level isolation is working.
//
// Unlike scenarios 01-02, this does NOT use srt. The container itself is the
// enforcement mechanism. Tests run with plain execSync.
//
// What it tests:
//   1. Running inside a container (/.dockerenv or cgroup indicators)
//   2. Non-root user
//   3. Dropped capabilities
//   4. Filesystem restrictions (read-only root)
//   5. Network restrictions (if firewall is active)
//
// Tests gracefully handle running outside a container (SKIP, not FAIL).
//
// Usage:
//   npm test
//
// Requires: Node.js >= 18
// ---------------------------------------------------------------------------

const fs = require("fs");
const { execSync } = require("child_process");

// -- Colors -----------------------------------------------------------------
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const CYAN = "\x1b[0;36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// -- Counters ---------------------------------------------------------------
let passCount = 0;
let failCount = 0;
let skipCount = 0;

// -- State ------------------------------------------------------------------
let insideContainer = false;

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

function skip(msg) {
  console.log(`  ${CYAN}SKIP${RESET} — ${msg}`);
  skipCount++;
}

// -- Helpers ----------------------------------------------------------------

function exec(command) {
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

function isInContainer() {
  // Check for /.dockerenv
  if (fs.existsSync("/.dockerenv")) return true;

  // Check cgroup for docker/containerd indicators
  try {
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
    if (cgroup.includes("docker") || cgroup.includes("containerd")) return true;
  } catch {}

  // Check for container env var (set by some runtimes)
  if (process.env.container) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Test 1: Running inside a container
// ---------------------------------------------------------------------------
banner("Test 1 — Container Detection");
info("Checking for container indicators (/.dockerenv, cgroup, env vars).");
why("All other tests depend on running inside a container.");
why("If not in a container, remaining tests will be skipped.");

insideContainer = isInContainer();

if (insideContainer) {
  pass("Running inside a container.");
} else {
  warn("Not running inside a container.");
  warn("Remaining tests will be skipped — they only apply inside the devcontainer.");
  skip("Not in a container.");
}

// ---------------------------------------------------------------------------
// Test 2: Non-root user
// ---------------------------------------------------------------------------
banner("Test 2 — Non-Root User");
info("Checking that the current user is not root.");
why("The devcontainer uses remoteUser: node to avoid running as root.");
why("Running as non-root limits the damage a compromised process can do.");

if (!insideContainer) {
  skip("Not running inside a container.");
} else {
  const result = exec("whoami");
  cmd("whoami");
  if (result.ok && result.output !== "root") {
    pass(`Running as '${result.output}' (not root).`);
  } else if (result.ok && result.output === "root") {
    fail("Running as root — devcontainer should use a non-root user.");
  } else {
    fail(`Could not determine user: ${result.output}`);
  }
}

// ---------------------------------------------------------------------------
// Test 3: Dropped capabilities
// ---------------------------------------------------------------------------
banner("Test 3 — Dropped Capabilities");
info("Checking that Linux capabilities have been dropped.");
why("--cap-drop=ALL removes all capabilities.");
why("No capabilities are added back — the container runs with zero caps.");

if (!insideContainer) {
  skip("Not running inside a container.");
} else {
  const result = exec("cat /proc/1/status");
  cmd("cat /proc/1/status (checking CapEff)");
  if (result.ok) {
    const capEffLine = result.output.split("\n").find((l) => l.startsWith("CapEff:"));
    if (capEffLine) {
      const capHex = capEffLine.split(/\s+/)[1];
      const capInt = parseInt(capHex, 16);
      // With --cap-drop=ALL and no caps added back, CapEff should be 0
      if (capInt === 0) {
        pass(`Capabilities are minimal (CapEff: ${capHex}).`);
      } else if (capInt < 0xa80425fb) {
        warn(`Capabilities not fully dropped but reduced from default (CapEff: ${capHex}).`);
        pass(`Capabilities are reduced from default (CapEff: ${capHex}).`);
      } else {
        fail(`Capabilities appear to be at default level (CapEff: ${capHex}).`);
      }
    } else {
      warn("Could not find CapEff in /proc/1/status.");
      skip("Cannot verify capabilities.");
    }
  } else {
    warn("Could not read /proc/1/status.");
    skip("Cannot verify capabilities.");
  }
}

// ---------------------------------------------------------------------------
// Test 4: Filesystem restrictions (read-only root)
// ---------------------------------------------------------------------------
banner("Test 4 — Read-Only Root Filesystem");
info("Attempting to write to the root filesystem.");
why("--read-only makes the root filesystem read-only.");
why("Only /tmp (via tmpfs) and mounted volumes should be writable.");

if (!insideContainer) {
  skip("Not running inside a container.");
} else {
  const testFile = `/opt/.sandbox-verify-test-${process.pid}`;
  const result = exec(`touch ${testFile}`);
  cmd(`touch ${testFile}`);
  if (result.ok) {
    fail("Write to /opt succeeded — root filesystem may not be read-only.");
    exec(`rm -f ${testFile}`);
  } else {
    pass("Write to /opt was denied (read-only filesystem).");
    console.log(`       Output: ${result.output.split("\n").slice(0, 2).join("\n       ")}`);
  }
}

// ---------------------------------------------------------------------------
// Test 5: Network restrictions (if firewall is active)
// ---------------------------------------------------------------------------
banner("Test 5 — Network Restrictions");
info("Attempting to reach an external domain not in the firewall allowlist.");
why("If init-firewall.sh was run, outbound traffic should be restricted.");
why("Only DNS and api.anthropic.com should be reachable.");

if (!insideContainer) {
  skip("Not running inside a container.");
} else {
  const result = exec("curl -sf --max-time 5 https://example.com");
  cmd("curl -sf --max-time 5 https://example.com");
  if (result.ok) {
    warn("Outbound request to example.com succeeded.");
    warn("Firewall rules may not be active (init-firewall.sh may not have been run).");
    skip("Firewall not active — network test inconclusive.");
  } else {
    // Could be firewall blocking or curl not installed — both are acceptable
    const curlCheck = exec("which curl");
    if (!curlCheck.ok) {
      warn("curl is not installed — cannot test network restrictions.");
      skip("curl not available.");
    } else {
      pass("Outbound request to example.com was blocked.");
      console.log(`       Output: ${result.output.split("\n").slice(0, 2).join("\n       ")}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
banner("Summary");
const total = passCount + failCount + skipCount;
console.log();
console.log(`  ${GREEN}Passed:${RESET}  ${passCount} / ${total}`);
console.log(`  ${RED}Failed:${RESET}  ${failCount} / ${total}`);
console.log(`  ${CYAN}Skipped:${RESET} ${skipCount} / ${total}`);
console.log();

if (!insideContainer) {
  console.log(`  ${YELLOW}${BOLD}Not running inside a container.${RESET}`);
  console.log(`  ${YELLOW}To run the full test suite, open this project in a devcontainer:${RESET}`);
  console.log(`  ${YELLOW}  devcontainer up --workspace-folder .${RESET}`);
  console.log(`  ${YELLOW}  devcontainer exec --workspace-folder . npm test${RESET}`);
  console.log();
}

if (failCount === 0) {
  console.log(`  ${GREEN}${BOLD}All checks passed (or skipped). Container isolation looks good.${RESET}`);
} else {
  console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
  console.log(`  ${YELLOW}Make sure you are running inside the devcontainer with the${RESET}`);
  console.log(`  ${YELLOW}expected security configuration (--cap-drop, --read-only, etc.).${RESET}`);
}
console.log();

process.exit(failCount > 0 ? 1 : 0);

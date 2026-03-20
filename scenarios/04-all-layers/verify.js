#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Scenario 04: All Layers
//
// Tests all 3 isolation layers working together inside a single container:
//   Layer 1: Permissions — tool-level deny rules
//   Layer 2: Sandbox/SRT — OS-level filesystem and network isolation
//   Layer 3: Container   — Docker hardening controls
//
// The thesis: these layers aren't redundant. Each catches what the others miss.
//
// Usage:
//   docker compose build
//   docker compose run --rm sandbox
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const t = require("../lib/test-helpers");
const { buildSrtSettings, sandboxExec: _sandboxExec } = require("../lib/srt-settings");

const SCENARIO_DIR = __dirname;
const SETTINGS_PATH = path.join(SCENARIO_DIR, ".claude", "settings.json");
const COMPOSE_PATH = path.join(SCENARIO_DIR, "docker-compose.yml");

// -- Load settings -----------------------------------------------------------
const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));

// -- srt helper --------------------------------------------------------------
const srtSettings = buildSrtSettings(SCENARIO_DIR);
function sandboxExec(command) { return _sandboxExec(srtSettings, command); }

// ===========================================================================
// LAYER 3: Container — Config validation
// ===========================================================================

let composeRaw = "";
try { composeRaw = fs.readFileSync(COMPOSE_PATH, "utf8"); } catch {}

if (composeRaw) {

t.banner("Layer 3 (Container) — Config: cap_add");
t.info("Checking that docker-compose.yml adds SYS_ADMIN and NET_ADMIN for SRT.");
t.why("bwrap needs SYS_ADMIN for mount/namespaces. socat needs NET_ADMIN for SRT's network proxy.");
{
  if (/cap_add:[\s\S]*?-\s*SYS_ADMIN/m.test(composeRaw)) {
    t.pass("cap_add includes SYS_ADMIN.");
  } else {
    t.fail("cap_add: [SYS_ADMIN] not found — bwrap won't work.");
  }
  if (/cap_add:[\s\S]*?-\s*NET_ADMIN/m.test(composeRaw)) {
    t.pass("cap_add includes NET_ADMIN.");
  } else {
    t.fail("cap_add: [NET_ADMIN] not found — SRT network proxy won't work.");
  }
}

t.banner("Layer 3 (Container) — Config: seccomp unconfined");
t.info("Checking seccomp is unconfined to allow SRT namespace creation.");
t.why("Docker's default seccomp blocks the syscalls bwrap needs. This is the tradeoff for nested SRT.");
{
  if (/seccomp:\s*unconfined/m.test(composeRaw)) {
    t.pass("seccomp:unconfined is set.");
  } else {
    t.fail("seccomp:unconfined not found — SRT may not work inside this container.");
  }
}

t.banner("Layer 3 (Container) — Config: user directive");
t.info("Checking that user is set to root (required for bwrap capabilities).");
t.why("Docker doesn't propagate cap_add to non-root effective sets. Root is needed for bwrap.");
{
  if (/user:\s*["']?0:0["']?/m.test(composeRaw)) {
    t.pass("user is 0:0 (root) — required for bwrap.");
  } else if (/user:\s*["']?\d+:\d+["']?/m.test(composeRaw)) {
    t.warn("user is non-root — bwrap may lack SYS_ADMIN in the effective set.");
  } else {
    t.pass("No user directive — defaults to root.");
  }
}

t.banner("Layer 3 (Container) — Config: memory limit");
t.info("Checking for memory resource limit.");
t.why("Prevents OOM-killing the host or starving other containers.");
{
  if (/memory:\s*\S+/m.test(composeRaw)) {
    t.pass("Memory limit is set.");
  } else {
    t.fail("Memory limit not found.");
  }
}

} // end compose config checks

// ===========================================================================
// LAYER 3: Container — Runtime probes
// ===========================================================================

t.banner("Layer 3 (Container) — Runtime: in-container");
t.info("Checking for signs we're inside a Docker container.");
t.why("All other container enforcement tests are meaningless on the host.");
{
  let inContainer = false;
  if (fs.existsSync("/.dockerenv")) inContainer = true;
  if (!inContainer) {
    try {
      const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
      if (/docker|container|kubepods/i.test(cgroup)) inContainer = true;
    } catch {}
  }
  if (!inContainer) {
    try {
      const mountinfo = fs.readFileSync("/proc/1/mountinfo", "utf8");
      if (/docker|overlay/i.test(mountinfo)) inContainer = true;
    } catch {}
  }
  if (inContainer) {
    t.pass("Running inside a container.");
  } else {
    t.fail("Not running inside a container. Run: docker compose run --rm sandbox");
  }
}

t.banner("Layer 3 (Container) — Runtime: running as root (required for bwrap)");
t.info("Confirming root — needed because Docker doesn't propagate cap_add to non-root effective set.");
t.why("Non-root isolation is delegated to Layer 2 (SRT runs commands in a restricted namespace).");
{
  const uid = process.getuid();
  if (uid === 0) {
    t.pass("Running as root (UID 0) — required for bwrap capabilities.");
  } else {
    t.warn(`Running as UID ${uid} (non-root). bwrap may lack SYS_ADMIN.`);
  }
}

t.banner("Layer 3 (Container) — Runtime: SYS_ADMIN capability present");
t.info("Checking that SYS_ADMIN is in the effective capability set (needed for bwrap).");
t.why("Without SYS_ADMIN, bwrap can't create mount namespaces or mount proc inside them.");
{
  const CAP_SYS_ADMIN_BIT = 1 << 21; // 0x200000
  try {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const match = status.match(/^CapEff:\s+([0-9a-fA-F]+)$/m);
    if (match) {
      const capEff = parseInt(match[1], 16);
      if (capEff & CAP_SYS_ADMIN_BIT) {
        t.pass(`CapEff is ${match[1]} — SYS_ADMIN is present.`);
      } else {
        t.fail(`CapEff is ${match[1]} — SYS_ADMIN is missing. Add cap_add: [SYS_ADMIN] to docker-compose.yml.`);
      }
    } else {
      t.fail("Could not find CapEff in /proc/self/status.");
    }
  } catch (err) {
    t.fail(`Could not read /proc/self/status: ${err.message}`);
  }
}

t.banner("Layer 3 (Container) — Runtime: resource limits");
t.info("Checking cgroup memory limit.");
t.why("Resource limits prevent the container from starving the host.");
{
  let limitFound = false;
  try {
    const raw = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
    if (raw !== "max") {
      const gb = (parseInt(raw, 10) / 1024 ** 3).toFixed(1);
      t.pass(`Memory limit: ${gb} GB (cgroups v2).`);
      limitFound = true;
    }
  } catch {}
  if (!limitFound) {
    try {
      const raw = fs.readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8").trim();
      const bytes = parseInt(raw, 10);
      if (bytes < 2 ** 62) {
        t.pass(`Memory limit: ${(bytes / 1024 ** 3).toFixed(1)} GB (cgroups v1).`);
        limitFound = true;
      }
    } catch {}
  }
  if (!limitFound) t.fail("No memory limit detected.");
}

// ===========================================================================
// LAYER 2: Sandbox — Config validation
// ===========================================================================

t.banner("Layer 2 (Sandbox) — Config: enabled + escape hatch closed");
t.info("Verifying sandbox.enabled and allowUnsandboxedCommands.");
t.why("These must be set for the sandbox to enforce anything via Bash.");
{
  const sb = settings.sandbox || {};
  if (sb.enabled === true) {
    t.pass("sandbox.enabled is true.");
  } else {
    t.fail(`sandbox.enabled is ${sb.enabled} (expected true).`);
  }
  if (sb.allowUnsandboxedCommands === false) {
    t.pass("allowUnsandboxedCommands is false.");
  } else {
    t.fail(`allowUnsandboxedCommands is ${sb.allowUnsandboxedCommands} (expected false).`);
  }
}

t.banner("Layer 2 (Sandbox) — Config: filesystem deny rules");
t.info("Checking denyRead and denyWrite patterns.");
t.why("Deny rules are the strongest sandbox protection — they override allow rules.");
{
  const fsConf = (settings.sandbox || {}).filesystem || {};
  for (const p of [".env*"]) {
    if ((fsConf.denyRead || []).includes(p)) {
      t.pass(`denyRead contains "${p}".`);
    } else {
      t.fail(`denyRead is missing "${p}".`);
    }
  }
  for (const p of ["secrets/"]) {
    if ((fsConf.denyWrite || []).includes(p)) {
      t.pass(`denyWrite contains "${p}".`);
    } else {
      t.fail(`denyWrite is missing "${p}".`);
    }
  }
}

t.banner("Layer 2 (Sandbox) — Config: network allowlist");
t.info("Checking allowedDomains.");
t.why("Domain-level filtering is the fine-grained network control that Docker can't provide natively.");
{
  const allowed = ((settings.sandbox || {}).network || {}).allowedDomains || [];
  if (allowed.includes("api.anthropic.com")) {
    t.pass('allowedDomains contains "api.anthropic.com".');
  } else {
    t.fail('allowedDomains is missing "api.anthropic.com".');
  }
  const unexpected = allowed.filter(d => d !== "api.anthropic.com");
  if (unexpected.length > 0) {
    t.warn(`Unexpected domains: ${unexpected.join(", ")}`);
  } else {
    t.pass("No unexpected domains in allowlist.");
  }
}

t.banner("Layer 2 (Sandbox) — Config: no escape hatches");
t.info("Checking excludedCommands is empty.");
t.why("Inside a container, there's no need for docker/docker-compose exclusions.");
{
  const excluded = (settings.sandbox || {}).excludedCommands || [];
  if (excluded.length === 0) {
    t.pass("excludedCommands is empty — no sandbox escape hatches.");
  } else {
    t.warn(`excludedCommands is not empty: ${excluded.join(", ")}`);
  }
}

// ===========================================================================
// LAYER 2: Sandbox — SRT enforcement tests
// ===========================================================================

t.banner("Layer 2 (Sandbox) — Pre-flight: bwrap available");
t.info("Checking that bubblewrap is installed and can create namespaces.");
t.why("bwrap is the sandbox engine SRT uses on Linux. It must be installed and functional.");

let bwrapAvailable = false;
{
  // Step 1: Check bwrap binary exists
  let bwrapPath = "";
  try {
    bwrapPath = execSync("which bwrap", {
      encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {}

  if (!bwrapPath) {
    t.fail("bwrap binary not found in PATH. Check Dockerfile installs bubblewrap.");
  } else {
    // Step 2: Check bwrap can create a namespace
    try {
      const out = execSync("bwrap --unshare-user --uid 1000 --gid 1000 --ro-bind / / echo bwrap-ok", {
        encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (out.includes("bwrap-ok")) {
        t.pass(`bwrap works (${bwrapPath}) — namespace creation succeeded.`);
        bwrapAvailable = true;
      } else {
        t.fail(`bwrap ran but unexpected output: ${out.slice(0, 200)}`);
      }
    } catch (err) {
      const output = ((err.stdout || "") + (err.stderr || "")).trim();
      t.fail(`bwrap namespace creation failed: ${output.slice(0, 300) || err.message}`);
    }
  }
}

t.banner("Layer 2 (Sandbox) — Pre-flight: srt inside container");
t.info("Checking if srt can run commands inside the sandbox runtime.");
t.why("This is the key test — SRT working inside Docker proves the 3-layer architecture is viable.");

let srtAvailable = false;
if (!bwrapAvailable) {
  t.warn("Skipping srt check — bwrap is not functional.");
} else {
  // Check srt is installed
  let srtInstalled = false;
  try {
    execSync("npx srt --version", {
      encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"],
    });
    srtInstalled = true;
  } catch (err) {
    const output = ((err.stdout || "") + (err.stderr || "")).trim();
    t.fail(`srt not found. npm install may have failed: ${output.slice(0, 200) || err.message}`);
  }

  if (srtInstalled) {
    const probe = sandboxExec("echo probe");
    if (probe.ok && probe.output.includes("probe")) {
      t.pass("srt works inside the container — sandboxed execution confirmed.");
      srtAvailable = true;
    } else {
      t.fail(`srt probe failed: ${probe.output.slice(0, 300)}`);
    }
  }
}

if (srtAvailable) {

// ---------------------------------------------------------------------------
t.banner("Layer 2 (Sandbox) — Enforcement: write to /tmp blocked");
t.info("Attempting to write to /tmp (outside allowWrite).");
t.why("/tmp is outside the project directory — the sandbox should block it.");
{
  const result = sandboxExec(`touch /tmp/sandbox-test-${process.pid}`);
  if (!result.ok) {
    t.pass("Write to /tmp was denied by the sandbox.");
  } else {
    t.fail("Write to /tmp succeeded — sandbox may not be enforcing filesystem rules.");
  }
}

// ---------------------------------------------------------------------------
t.banner("Layer 2 (Sandbox) — Enforcement: read .env.example blocked");
t.info("Attempting to cat .env.example (matched by denyRead .env*).");
t.why("Layer 1 blocks the Read tool. Layer 2 blocks cat. Both protect the same secret, different vectors.");
{
  const result = sandboxExec(`cat ${SCENARIO_DIR}/.env.example`);
  if (!result.ok) {
    t.pass("Reading .env.example was denied by the sandbox.");
  } else {
    t.fail("Reading .env.example succeeded — denyRead may not be working.");
  }
}

// ---------------------------------------------------------------------------
t.banner("Layer 2 (Sandbox) — Enforcement: write to secrets/ blocked");
t.info("Attempting to write into secrets/ (in denyWrite).");
t.why("denyWrite overrides allowWrite — the secrets directory is protected.");
{
  const result = sandboxExec(`echo test > ${SCENARIO_DIR}/secrets/sandbox-test-${process.pid}`);
  if (!result.ok) {
    t.pass("Write to secrets/ was denied by the sandbox.");
  } else {
    t.fail("Write to secrets/ succeeded — denyWrite may not be working.");
  }
}

// ---------------------------------------------------------------------------
t.banner("Layer 2 (Sandbox) — Enforcement: outbound network blocked");
t.info("Attempting to reach https://example.com (not in allowedDomains).");
t.why("SRT's domain filtering blocks this — Docker's bridge network alone would allow it.");
{
  const result = sandboxExec("curl -sf --max-time 5 https://example.com");
  if (!result.ok) {
    t.pass("Outbound request to example.com was blocked by SRT.");
  } else {
    t.fail("Request to example.com succeeded — domain filtering may not be working.");
  }
}

// ---------------------------------------------------------------------------
t.banner("Layer 2 (Sandbox) — Enforcement: allowed domain reachable");
t.info("Attempting to reach https://api.anthropic.com (in allowedDomains).");
t.why("Allowed domains should pass through SRT's proxy. HTTP errors are fine — the connection matters.");
{
  const result = sandboxExec("curl -sf --max-time 5 https://api.anthropic.com");
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
t.banner("Layer 2 (Sandbox) — Enforcement: normal ops in cwd");
t.info("Writing, reading, and deleting a temp file in the working directory.");
t.why("Normal operations in the project directory should still work under all 3 layers.");
{
  const tempFile = `.sandbox-verify-temp-${process.pid}`;
  const result = sandboxExec(`echo 'hello sandbox' > ${tempFile} && cat ${tempFile} && rm ${tempFile}`);
  if (result.ok && result.output.includes("hello sandbox")) {
    t.pass("Write/read/delete within cwd succeeded.");
  } else if (result.ok) {
    t.fail(`Command ran but unexpected output: ${result.output}`);
  } else {
    t.fail("Normal file operations within cwd failed — sandbox may be too restrictive.");
  }
}

} else {
  t.banner("Layer 2 (Sandbox) — Enforcement tests skipped");
  t.warn("SRT could not create namespaces inside this container.");
  t.warn("Check: seccomp:unconfined in docker-compose.yml, bubblewrap installed, kernel supports unprivileged user namespaces.");
}

// ===========================================================================
// LAYER 1: Permissions — Config validation
// ===========================================================================

t.banner("Layer 1 (Permissions) — Config: deny rules");
t.info("Checking that all expected deny rules are present.");
t.why("Permissions block Claude's built-in tools — the only control for Read, WebFetch, WebSearch, Agent.");
{
  const deny = (settings.permissions || {}).deny || [];
  const expected = [
    "Read(.env*)",
    "Edit(.claude/settings*)",
    "Write(.claude/settings*)",
    "Bash(curl *)",
    "WebFetch(*)",
    "WebSearch(*)",
    "Agent(*)",
  ];
  const missing = expected.filter(r => !deny.includes(r));
  if (missing.length === 0) {
    t.pass("All 7 deny rules are present.");
  } else {
    for (const r of missing) t.fail(`Missing deny rule: ${r}`);
  }
}

t.banner("Layer 1 (Permissions) — Config: no shadowed allows");
t.info("Checking that allow rules aren't shadowed by deny rules.");
t.why("Deny > allow precedence means a shadowed allow is dead code.");
{
  const deny = (settings.permissions || {}).deny || [];
  const allow = (settings.permissions || {}).allow || [];
  const shadowed = allow.filter(r => deny.includes(r));
  if (shadowed.length === 0) {
    t.pass("All allow rules are effective (none shadowed by deny).");
  } else {
    for (const r of shadowed) t.fail(`"${r}" is shadowed by deny.`);
  }
}

// ===========================================================================
// All layers — Claude CLI check
// ===========================================================================

t.banner("All layers — Claude CLI available");
t.info("Checking that the Claude CLI is installed and runs under all 3 layers.");
t.why("Proves the hardened, sandboxed container can actually run Claude.");
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

// ===========================================================================
// Summary
// ===========================================================================

t.summary("0 API calls. Docker build and run only.");
process.exit(t.exitCode());

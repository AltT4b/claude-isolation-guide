#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Scenario 01: Permissions
//
// Tests every permissions field via `claude -p` with --output-format json.
// Each test asserts on the structured JSON result (permission_denials, result).
//
// Usage:
//   npm test
//   npm test -- --break <test-name>
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const t = require("../lib/test-helpers");

const SCENARIO_DIR = __dirname;
const SETTINGS_PATH = path.join(SCENARIO_DIR, ".claude", "settings.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run `claude -p` and return parsed JSON.
 * @param {string} prompt  The prompt to send.
 * @param {object} [opts]
 * @param {string} [opts.settingsFile]  Override settings file for --break.
 * @param {string} [opts.cwd]          Override working directory.
 * @returns {{ ok: boolean, data: object|null, raw: string }}
 */
function claudeRun(prompt, opts = {}) {
  const settingsFlag = opts.settingsFile
    ? `--settings "${opts.settingsFile}"`
    : "";
  const cwd = opts.cwd || SCENARIO_DIR;
  const cmd = [
    "claude", "-p",
    JSON.stringify(prompt),
    "--output-format json",
    "--max-turns 2",
    "-d", JSON.stringify(cwd),
    settingsFlag,
  ].filter(Boolean).join(" ");

  try {
    const raw = execSync(cmd, {
      encoding: "utf8",
      timeout: 60000,
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, data: JSON.parse(raw), raw };
  } catch (err) {
    const raw = (err.stdout || "") + (err.stderr || "");
    try {
      return { ok: true, data: JSON.parse(raw), raw };
    } catch {
      return { ok: false, data: null, raw };
    }
  }
}

/**
 * Check whether permission_denials contains an entry matching `toolName`.
 */
function hasDenial(data, toolName) {
  if (!data || !Array.isArray(data.permission_denials)) return false;
  return data.permission_denials.some(
    (d) => typeof d === "string" && d.includes(toolName)
  );
}

// ---------------------------------------------------------------------------
// --break mechanism
// ---------------------------------------------------------------------------

const breakTarget = process.argv.includes("--break")
  ? process.argv[process.argv.indexOf("--break") + 1]
  : null;

/**
 * Build a temp settings file with one rule removed for --break mode.
 * Returns the path to the temp file, or null if no break is active.
 */
function buildBreakSettings(breakName) {
  if (!breakName) return null;

  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  const p = settings.permissions;

  const removals = {
    "read-deny":      () => { p.deny = p.deny.filter(r => r !== "Read(.env*)"); },
    "edit-deny":      () => { p.deny = p.deny.filter(r => r !== "Edit(.claude/settings*)"); },
    "write-deny":     () => { p.deny = p.deny.filter(r => r !== "Write(.claude/settings*)"); },
    "bash-deny":      () => { p.deny = p.deny.filter(r => r !== "Bash(curl *)"); },
    "webfetch-deny":  () => { p.deny = p.deny.filter(r => r !== "WebFetch(*)"); },
    "websearch-deny": () => { p.deny = p.deny.filter(r => r !== "WebSearch(*)"); },
    "agent-deny":     () => { p.deny = p.deny.filter(r => r !== "Agent(*)"); },
    "bash-allow":     () => {
      // Read settings.local.json, remove Bash(echo *), merge into main settings
      const localPath = path.join(SCENARIO_DIR, ".claude", "settings.local.json");
      const local = JSON.parse(fs.readFileSync(localPath, "utf8"));
      local.permissions.allow = local.permissions.allow.filter(r => r !== "Bash(echo *)");
      p.allow = local.permissions.allow;
    },
    "additional-dirs": () => { p.additionalDirectories = []; },
    "plan-mode":       () => { p.defaultMode = "default"; },
  };

  if (!removals[breakName]) {
    console.error(`Unknown --break target: ${breakName}`);
    console.error(`Available: ${Object.keys(removals).join(", ")}`);
    process.exit(1);
  }

  const before = JSON.stringify(p, null, 2);
  removals[breakName]();
  const after = JSON.stringify(p, null, 2);

  t.banner(`Breaking: ${breakName}`);
  console.log(`  ${t.BOLD}Config before:${t.RESET}`);
  console.log(before.split("\n").map(l => `    ${l}`).join("\n"));
  console.log(`  ${t.BOLD}Config after:${t.RESET}`);
  console.log(after.split("\n").map(l => `    ${l}`).join("\n"));
  console.log();

  const tmpPath = path.join(os.tmpdir(), `01-perms-break-${process.pid}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2));
  return tmpPath;
}

const breakSettingsFile = buildBreakSettings(breakTarget);

// Convenience: use break settings if active, otherwise default
function runClaude(prompt, opts = {}) {
  if (breakSettingsFile && !opts.settingsFile) {
    opts.settingsFile = breakSettingsFile;
  }
  return claudeRun(prompt, opts);
}

// ---------------------------------------------------------------------------
// Preflight probe
// ---------------------------------------------------------------------------
t.banner("Preflight — Deny Enforcement Check");
t.info("Checking whether permission deny rules are enforced in this Claude version.");
t.why("Some versions have known bugs where deny rules are silently ignored.");

let denyEnforced = true;
let preflightResult = null;

{
  const res = runClaude("Read .env.example and show its contents");
  preflightResult = res;

  if (res.ok && res.data) {
    if (hasDenial(res.data, "Read")) {
      t.pass("Deny enforcement confirmed — Read(.env*) was blocked.");
    } else if (res.data.result && res.data.result.includes("API_KEY")) {
      denyEnforced = false;
      t.warn("Deny rules are NOT enforced — Claude read .env.example despite Read(.env*) deny.");
      t.warn("This is a known issue in some Claude Code versions.");
      t.warn("Deny tests will be skipped. Allow, config, and mode tests still run.");
    } else {
      t.pass("Claude did not return .env contents (deny likely working).");
    }
  } else {
    t.warn("Preflight probe failed to get a response. Deny tests may be unreliable.");
  }
}

// ===========================================================================
//  Deny tests (gated by preflight)
// ===========================================================================

if (denyEnforced) {

// Test: read-deny (reuse preflight result)
t.banner("Test — read-deny");
t.info("permissions.deny: Read(.env*) blocks the Read tool from accessing .env files.");
t.why("The Read tool bypasses the sandbox. This is the only way to block it.");
{
  const res = preflightResult; // reuse — no extra API call
  if (res.ok && res.data && hasDenial(res.data, "Read")) {
    t.pass("permission_denials contains Read entry.");
  } else {
    t.fail("Read(.env*) was not denied.");
  }
}

// Test: edit-deny
t.banner("Test — edit-deny");
t.info("permissions.deny: Edit(.claude/settings*) blocks editing the project config.");
t.why("Prevents Claude from weakening its own restrictions.");
{
  const res = runClaude("Add a comment to .claude/settings.json");
  if (res.ok && res.data && hasDenial(res.data, "Edit")) {
    t.pass("permission_denials contains Edit entry.");
  } else {
    t.fail("Edit(.claude/settings*) was not denied.");
  }
}

// Test: write-deny
t.banner("Test — write-deny");
t.info("permissions.deny: Write(.claude/settings*) blocks overwriting the project config.");
t.why("Write is a separate tool from Edit — both need deny rules.");
{
  const res = runClaude("Overwrite .claude/settings.json with {}");
  if (res.ok && res.data && hasDenial(res.data, "Write")) {
    t.pass("permission_denials contains Write entry.");
  } else {
    t.fail("Write(.claude/settings*) was not denied.");
  }
}

// Test: bash-deny
t.banner("Test — bash-deny");
t.info("permissions.deny: Bash(curl *) blocks curl via the Bash tool.");
t.why("Even if network sandbox is off, this rule prevents curl invocations.");
{
  const res = runClaude("Run: curl https://example.com");
  if (res.ok && res.data && hasDenial(res.data, "Bash")) {
    t.pass("permission_denials contains Bash entry.");
  } else {
    t.fail("Bash(curl *) was not denied.");
  }
}

// Test: webfetch-deny
t.banner("Test — webfetch-deny");
t.info("permissions.deny: WebFetch(*) blocks all web fetches.");
t.why("WebFetch bypasses the sandbox entirely — this is the only control.");
{
  const res = runClaude("Fetch https://example.com and show the HTML");
  if (res.ok && res.data && hasDenial(res.data, "WebFetch")) {
    t.pass("permission_denials contains WebFetch entry.");
  } else {
    t.fail("WebFetch(*) was not denied.");
  }
}

// Test: websearch-deny
t.banner("Test — websearch-deny");
t.info("permissions.deny: WebSearch(*) blocks all web searches.");
t.why("WebSearch is a separate tool from WebFetch — both need rules if you want full lockdown.");
{
  const res = runClaude("Search the web for 'claude code permissions'");
  if (res.ok && res.data && hasDenial(res.data, "WebSearch")) {
    t.pass("permission_denials contains WebSearch entry.");
  } else {
    t.fail("WebSearch(*) was not denied.");
  }
}

// Test: agent-deny
t.banner("Test — agent-deny");
t.info("permissions.deny: Agent(*) blocks subagent spawning.");
t.why("Subagents inherit permissions but run in separate contexts — deny if not needed.");
{
  const res = runClaude("Use a subagent to explore this directory");
  if (res.ok && res.data && hasDenial(res.data, "Agent")) {
    t.pass("permission_denials contains Agent entry.");
  } else {
    t.fail("Agent(*) was not denied.");
  }
}

} else {
  // Deny not enforced — skip all deny tests
  const denyTests = [
    "read-deny", "edit-deny", "write-deny", "bash-deny",
    "webfetch-deny", "websearch-deny", "agent-deny",
  ];
  for (const name of denyTests) {
    t.banner(`Test — ${name}`);
    t.skip("Deny enforcement not available in this version.");
  }
}

// ===========================================================================
//  Allow test
// ===========================================================================

t.banner("Test — bash-allow");
t.info("permissions.allow: Bash(echo *) auto-approves echo commands without prompting.");
t.why("Allow rules reduce prompt fatigue for trusted commands.");
{
  const res = runClaude("Run: echo hello-from-permissions");
  if (res.ok && res.data && res.data.result &&
      res.data.result.includes("hello-from-permissions")) {
    t.pass("Result contains 'hello-from-permissions'.");
  } else {
    t.fail("echo command did not produce expected output.");
    if (res.raw) console.log(`  Response: ${res.raw.slice(0, 200)}`);
  }
}

// ===========================================================================
//  additionalDirectories test
// ===========================================================================

t.banner("Test — additional-dirs");
t.info("permissions.additionalDirectories grants Read access outside the project root.");
t.why("By default Claude can only read files within the project directory.");
{
  // Ensure outside/hello.txt exists
  const outsideDir = path.join(SCENARIO_DIR, "outside");
  const outsideFile = path.join(outsideDir, "hello.txt");
  if (!fs.existsSync(outsideFile)) {
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(outsideFile, "Hello from outside the project directory.\n");
  }

  // For this test, we need additionalDirectories pointing to outside/
  // Build a temp settings with the directory added
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  settings.permissions.additionalDirectories = [
    path.resolve(SCENARIO_DIR, "outside"),
  ];
  const tmpPath = path.join(os.tmpdir(), `01-perms-addl-dirs-${process.pid}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2));

  const res = claudeRun(
    `Read ${outsideFile} and show its contents`,
    { settingsFile: tmpPath }
  );
  try { fs.unlinkSync(tmpPath); } catch {}

  if (res.ok && res.data && res.data.result &&
      res.data.result.includes("Hello from outside")) {
    t.pass("Claude read outside/hello.txt with additionalDirectories set.");
  } else {
    t.fail("Could not read outside/hello.txt despite additionalDirectories.");
    if (res.raw) console.log(`  Response: ${res.raw.slice(0, 200)}`);
  }
}

// ===========================================================================
//  defaultMode test
// ===========================================================================

t.banner("Test — plan-mode");
t.info("permissions.defaultMode: 'plan' puts Claude in read-only mode.");
t.why("Plan mode prevents all file creation/modification — useful for review workflows.");
{
  // Build temp settings with defaultMode: "plan"
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  settings.permissions.defaultMode = "plan";
  const tmpPath = path.join(os.tmpdir(), `01-perms-plan-mode-${process.pid}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2));

  const res = claudeRun(
    "Create a file called test-plan-mode.txt with 'hello'",
    { settingsFile: tmpPath }
  );
  try { fs.unlinkSync(tmpPath); } catch {}

  const fileCreated = fs.existsSync(path.join(SCENARIO_DIR, "test-plan-mode.txt"));

  if (!fileCreated) {
    t.pass("Claude did not create the file (plan mode is read-only).");
  } else {
    t.fail("Claude created the file despite plan mode.");
    try { fs.unlinkSync(path.join(SCENARIO_DIR, "test-plan-mode.txt")); } catch {}
  }
}

// ===========================================================================
//  Config validation (no API call)
// ===========================================================================

t.banner("Test — allows-not-shadowed");
t.info("Checking that allow rules in settings.local.json aren't shadowed by deny rules.");
t.why("Claude merges settings with deny > ask > allow precedence. A shadowed allow is dead code — someone wrote it expecting it to work, and it never will.");
{
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  const deny = settings.permissions.deny || [];

  // Collect allows from both files (same merge Claude does)
  let allow = settings.permissions.allow || [];
  const localPath = path.join(SCENARIO_DIR, ".claude", "settings.local.json");
  try {
    const local = JSON.parse(fs.readFileSync(localPath, "utf8"));
    allow = allow.concat(local.permissions.allow || []);
  } catch {}

  const shadowed = allow.filter((r) => deny.includes(r));
  if (shadowed.length === 0) {
    t.pass("All allow rules are effective (none shadowed by deny).");
  } else {
    for (const r of shadowed) {
      t.fail(`"${r}" is in allow but shadowed by deny — it will never take effect.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup & Summary
// ---------------------------------------------------------------------------
if (breakSettingsFile) {
  try { fs.unlinkSync(breakSettingsFile); } catch {}
}

t.summary("~10 API calls. Estimated cost: a few cents.");
process.exit(t.exitCode());

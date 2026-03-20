// ---------------------------------------------------------------------------
// srt-settings.js — Shared utility for building srt configuration.
//
// srt expects the same keys as settings.json but without the "sandbox"
// wrapper, and with relative filesystem paths resolved to absolute ones.
//
// Usage:
//   const { buildSrtSettings, sandboxExec } = require("../lib/srt-settings");
//   const srtSettings = buildSrtSettings(__dirname);
//   const result = sandboxExec(srtSettings, "curl https://example.com");
// ---------------------------------------------------------------------------

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Read .claude/settings.json from the given scenario directory and transform
 * sandbox settings into the flat format srt expects.
 *
 * @param {string} scenarioDir  Absolute path to the scenario directory
 *                              (typically __dirname from the caller).
 * @param {object} [opts]
 * @param {object} [opts.filesystemDefaults]  Fallback filesystem config if
 *                 settings.json has no sandbox.filesystem section. Useful for
 *                 scenarios that rely on excludedCommands with minimal config.
 */
function buildSrtSettings(scenarioDir, opts) {
  const settings = JSON.parse(
    fs.readFileSync(path.join(scenarioDir, ".claude", "settings.json"), "utf8")
  );
  const s = settings.sandbox;
  const cwd = scenarioDir;
  const home = os.homedir();

  const resolve = (p) =>
    p === "." ? cwd :
    p.startsWith("/") ? p :
    p.startsWith("~/") ? home + p.slice(1) :
    path.join(cwd, p);

  const out = {};

  // Network — srt requires both allowedDomains and deniedDomains
  if (s.network) {
    out.network = {
      deniedDomains: [],
      ...s.network,
    };
  }

  // Filesystem needs path resolution. srt requires both allowWrite and
  // denyWrite (plus denyRead if present). If absent from settings.json and
  // a default was provided, use the default so srt gets a valid config.
  const fsSection = s.filesystem || (opts && opts.filesystemDefaults) || null;
  if (fsSection) {
    const merged = { denyWrite: [], ...fsSection };
    out.filesystem = Object.fromEntries(
      Object.entries(merged).map(([k, v]) =>
        [k, Array.isArray(v) ? v.map(resolve) : v]
      )
    );
  }

  return out;
}

/**
 * Execute a command inside the srt sandbox and return { ok, output }.
 *
 * @param {object} srtSettings  The settings object from buildSrtSettings().
 * @param {string} command      Shell command to run inside the sandbox.
 */
function sandboxExec(srtSettings, command) {
  const settingsPath = path.join(os.tmpdir(), `srt-settings-${process.pid}.json`);
  fs.writeFileSync(settingsPath, JSON.stringify(srtSettings, null, 2));

  try {
    const output = execSync(`npx srt -s "${settingsPath}" "${command}"`, {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, output: output.trim() };
  } catch (err) {
    const output = (err.stdout || "") + (err.stderr || "");
    return { ok: false, output: output.trim() };
  } finally {
    try { fs.unlinkSync(settingsPath); } catch {}
  }
}

module.exports = { buildSrtSettings, sandboxExec };

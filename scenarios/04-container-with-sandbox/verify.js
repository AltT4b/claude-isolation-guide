#!/usr/bin/env node

// ---------------------------------------------------------------------------
// verify.js — Scenario 04: Container with Sandbox
//
// Verifies that the Claude CLI is installed and runs inside the hardened,
// sandboxed Docker container.
//
// Usage:
//   docker compose build
//   docker compose run --rm verify
// ---------------------------------------------------------------------------

const { execSync } = require("child_process");
const t = require("../lib/test-helpers");

t.banner("Claude CLI installed");
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

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

t.summary("0 API calls. Docker build and run only.");
process.exit(t.exitCode());

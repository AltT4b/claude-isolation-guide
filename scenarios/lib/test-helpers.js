// ---------------------------------------------------------------------------
// test-helpers.js — Shared output helpers for verify.js scripts.
//
// Usage:
//   const t = require("../lib/test-helpers");
//   t.banner("Test 1 — Something");
//   t.info("What we're checking.");
//   t.why("Why it matters.");
//   t.pass("It worked.");
//   t.summary();
//   process.exit(t.exitCode());
// ---------------------------------------------------------------------------

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function banner(title) {
  console.log();
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}  ${title}${RESET}`);
  console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
}

function info(msg) { console.log(`  ${BOLD}What:${RESET}  ${msg}`); }
function why(msg)  { console.log(`  ${BOLD}Why:${RESET}   ${msg}`); }
function cmd(msg)  { console.log(`  ${BOLD}Cmd:${RESET}   ${msg}`); }
function gap(msg)  { console.log(`  ${YELLOW}${BOLD}GAP:${RESET}   ${msg}`); }

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
  console.log(`  ${YELLOW}SKIP${RESET} — ${msg}`);
  skipCount++;
}

function summary(note) {
  banner("Summary");
  const total = passCount + failCount;
  console.log();
  console.log(`  ${GREEN}Passed:${RESET} ${passCount} / ${total}`);
  console.log(`  ${RED}Failed:${RESET} ${failCount} / ${total}`);
  if (skipCount > 0) {
    console.log(`  ${YELLOW}Skipped:${RESET} ${skipCount}`);
  }
  if (note) {
    console.log();
    console.log(`  ${BOLD}Note:${RESET} ${note}`);
  }
  console.log();
  if (failCount === 0) {
    console.log(`  ${GREEN}${BOLD}All checks passed.${RESET}`);
  } else {
    console.log(`  ${YELLOW}${BOLD}Some checks failed. Review the output above.${RESET}`);
  }
  console.log();
}

function exitCode() {
  return failCount > 0 ? 1 : 0;
}

module.exports = {
  banner, info, why, cmd, gap, pass, fail, warn, skip, summary, exitCode,
  RED, GREEN, YELLOW, BOLD, RESET,
};

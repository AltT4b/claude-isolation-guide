#!/usr/bin/env node

// ---------------------------------------------------------------------------
// format-result.js — Pretty-print claude -p JSON output
//
// Usage:
//   claude -p "..." --output-format json | node ../lib/format-result.js
//
// Extracts the fields a human cares about and prints them in a readable format.
// ---------------------------------------------------------------------------

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(input.trim());
  } catch {
    console.error("Could not parse JSON from stdin.");
    process.exit(1);
  }

  const status = data.is_error ? "FAIL" : "PASS";
  const icon = data.is_error ? "\u2717" : "\u2713";
  const cost = data.total_cost_usd != null
    ? `$${data.total_cost_usd.toFixed(4)}`
    : "n/a";
  const turns = data.num_turns ?? "?";
  const duration = data.duration_ms != null
    ? `${(data.duration_ms / 1000).toFixed(1)}s`
    : "n/a";

  console.log(`${icon} ${status}  (${turns} turn${turns === 1 ? "" : "s"}, ${duration}, ${cost})`);
  console.log("");
  console.log(data.result || "(no result)");
});

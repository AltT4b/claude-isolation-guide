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

  if (data.result) {
    console.log(data.result);
  } else if (Array.isArray(data.messages)) {
    // When result is empty, extract tool use details from the conversation.
    // This catches cases where Claude ran commands but didn't echo the output
    // in its final text response.
    const steps = extractToolSteps(data.messages);
    if (steps.length > 0) {
      for (const step of steps) {
        console.log(`$ ${step.command}`);
        if (step.output) console.log(step.output);
        if (step.is_error) console.log("(exit: non-zero)");
        console.log("");
      }
    } else {
      console.log("(no result)");
    }
  } else {
    console.log("(no result)");
  }
});

// ---------------------------------------------------------------------------
// Extract Bash tool use/result pairs from the messages array.
//
// Messages alternate assistant → user. An assistant message may contain
// tool_use blocks; the next user message contains matching tool_result blocks.
// ---------------------------------------------------------------------------
function extractToolSteps(messages) {
  const steps = [];
  // Map tool_use id → command for Bash invocations
  const pending = new Map();

  for (const msg of messages) {
    const content = msg.message?.content ?? msg.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === "tool_use" && block.name === "Bash") {
        const cmd = block.input?.command;
        if (cmd) pending.set(block.id, cmd);
      }

      if (block.type === "tool_result" && pending.has(block.tool_use_id)) {
        const command = pending.get(block.tool_use_id);
        const output = typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((c) => c.text ?? "").join("")
            : "";
        steps.push({ command, output: output || null, is_error: !!block.is_error });
        pending.delete(block.tool_use_id);
      }
    }
  }

  return steps;
}

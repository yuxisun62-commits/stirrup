#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = String.raw`C:\Users\ter_w\AppData\Local\Temp\n8n-workflows\workflows`;
const types = {};
let total = 0, withConns = 0, totalNodes = 0;

function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith(".json")) {
      try {
        const wf = JSON.parse(readFileSync(full, "utf-8"));
        total += 1;
        if (Object.keys(wf.connections || {}).length > 0) withConns += 1;
        for (const n of wf.nodes || []) {
          types[n.type] = (types[n.type] || 0) + 1;
          totalNodes += 1;
        }
      } catch { /* skip bad json */ }
    }
  }
}

walk(root);
const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
console.log(`workflows parsed: ${total} | with non-empty connections: ${withConns}`);
console.log(`total node instances: ${totalNodes} | distinct node types: ${sorted.length}`);
console.log("--- top 40 node types (instance count) ---");
sorted.slice(0, 40).forEach(([t, c]) => console.log(`${String(c).padStart(6)}  ${t}`));

// Bucket the top types by "kind" to guide mapping priorities
const core = [];
const integrations = [];
for (const [t, c] of sorted) {
  const bare = t.replace(/^n8n-nodes-base\./, "");
  if (/^(httpRequest|set|code|function|functionItem|if|switch|merge|splitInBatches|wait|executeWorkflow|webhook|scheduleTrigger|cron|manualTrigger|respondToWebhook|itemLists|noOp|stickyNote|dateTime|emailSend|error|stopAndError|errorTrigger)$/i.test(bare)) {
    core.push([bare, c]);
  } else {
    integrations.push([bare, c]);
  }
}
console.log("\n--- CORE primitives in top list ---");
core.slice(0, 25).forEach(([t, c]) => console.log(`${String(c).padStart(6)}  ${t}`));
console.log("\n--- INTEGRATIONS (vendor-specific) top 25 ---");
integrations.slice(0, 25).forEach(([t, c]) => console.log(`${String(c).padStart(6)}  ${t}`));

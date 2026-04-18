#!/usr/bin/env node
// Validates the n8n importer against a sample of real workflows from the
// Zie619/n8n-workflows repo. Reports: import success rate, schema-validation
// pass rate, most-common unmapped types.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importN8nWorkflow } from "../dist/import/n8n.js";
import { validateWorkflow } from "../dist/validation/WorkflowValidator.js";

const ROOT = String.raw`C:\Users\ter_w\AppData\Local\Temp\n8n-workflows\workflows`;
const SAMPLE_SIZE = Number(process.argv[2] ?? "200");

function sampleFiles(dir, limit) {
  const all = [];
  function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".json")) all.push(full);
    }
  }
  walk(dir);
  // Deterministic spread across the space
  const step = Math.max(1, Math.floor(all.length / limit));
  const out = [];
  for (let i = 0; i < all.length && out.length < limit; i += step) out.push(all[i]);
  return out;
}

const files = sampleFiles(ROOT, SAMPLE_SIZE);
console.log(`sampling ${files.length} files\n`);

let imported = 0, validated = 0, failed = 0;
const stubTotals = {};
const mappedTotals = {};
const failures = [];

for (const f of files) {
  try {
    const src = JSON.parse(readFileSync(f, "utf-8"));
    const { workflow, report } = importN8nWorkflow(src);
    imported += 1;
    for (const [t, c] of Object.entries(report.mapped)) mappedTotals[t] = (mappedTotals[t] ?? 0) + c;
    for (const [t, c] of Object.entries(report.stubbed)) stubTotals[t] = (stubTotals[t] ?? 0) + c;

    try {
      validateWorkflow(workflow);
      validated += 1;
    } catch (err) {
      failed += 1;
      if (failures.length < 5) failures.push({ file: f.slice(-60), reason: (err?.message ?? String(err)).slice(0, 200) });
    }
  } catch (err) {
    failed += 1;
    if (failures.length < 5) failures.push({ file: f.slice(-60), reason: `parse/import: ${(err?.message ?? String(err)).slice(0, 200)}` });
  }
}

console.log(`imported: ${imported}/${files.length}`);
console.log(`schema-validated: ${validated}/${imported}`);
console.log(`failed: ${failed}\n`);

const sortedStubs = Object.entries(stubTotals).sort((a, b) => b[1] - a[1]);
console.log(`--- top stubbed (unmapped) types, top 20 ---`);
sortedStubs.slice(0, 20).forEach(([t, c]) => console.log(`  ${String(c).padStart(6)}  ${t}`));

const sortedMapped = Object.entries(mappedTotals).sort((a, b) => b[1] - a[1]);
console.log(`\n--- top mapped types ---`);
sortedMapped.slice(0, 15).forEach(([t, c]) => console.log(`  ${String(c).padStart(6)}  ${t}`));

if (failures.length > 0) {
  console.log(`\n--- first ${failures.length} failures ---`);
  failures.forEach((f) => console.log(`  ${f.file}\n    → ${f.reason}`));
}

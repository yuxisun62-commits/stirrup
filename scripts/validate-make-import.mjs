#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importMakeBlueprint } from "../dist/import/make.js";
import { validateWorkflow } from "../dist/validation/WorkflowValidator.js";

const root = String.raw`C:\Users\ter_w\AppData\Local\Temp\make-samples`;
const files = readdirSync(root).filter((f) => f.endsWith(".json"));

let imported = 0, validated = 0, failed = 0;
const stubTotals = {}, mappedTotals = {};
const failures = [];

for (const f of files) {
  const full = join(root, f);
  try {
    const src = JSON.parse(readFileSync(full, "utf-8"));
    const { workflow, report } = importMakeBlueprint(src);
    imported += 1;
    for (const [t, c] of Object.entries(report.mapped)) mappedTotals[t] = (mappedTotals[t] ?? 0) + c;
    for (const [t, c] of Object.entries(report.stubbed)) stubTotals[t] = (stubTotals[t] ?? 0) + c;
    try {
      validateWorkflow(workflow);
      validated += 1;
    } catch (err) {
      failed += 1;
      failures.push({ file: f, reason: err.message });
    }
    console.log(`${f}:`);
    console.log(`  source: ${report.sourceName}`);
    console.log(`  nodes: ${report.nodeCount}, edges: ${report.edgeCount}`);
    console.log(`  mapped: ${Object.values(report.mapped).reduce((a, b) => a + b, 0)}, stubbed: ${Object.values(report.stubbed).reduce((a, b) => a + b, 0)}`);
    if (Object.keys(report.stubbed).length > 0) {
      console.log(`  stubbed types: ${Object.keys(report.stubbed).join(", ")}`);
    }
  } catch (err) {
    failed += 1;
    failures.push({ file: f, reason: `parse/import: ${err.message}` });
  }
  console.log("");
}

console.log(`imported: ${imported}/${files.length}, schema-validated: ${validated}/${imported}, failed: ${failed}`);
if (failures.length > 0) {
  console.log(`\nfailures:`);
  for (const f of failures) console.log(`  ${f.file} → ${f.reason}`);
}
console.log(`\ntop stubbed: ${Object.entries(stubTotals).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(", ")}`);
console.log(`top mapped: ${Object.entries(mappedTotals).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(", ")}`);

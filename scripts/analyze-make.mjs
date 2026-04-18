#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = String.raw`C:\Users\ter_w\AppData\Local\Temp\make-samples`;
const types = {};
let total = 0;

function walk(items) {
  for (const item of items || []) {
    if (!item || typeof item !== "object") continue;
    if (item.module) {
      types[item.module] = (types[item.module] || 0) + 1;
      total += 1;
    }
    if (Array.isArray(item.routes)) {
      for (const r of item.routes) walk(r.flow);
    }
  }
}

for (const f of readdirSync(root)) {
  try {
    const j = JSON.parse(readFileSync(join(root, f), "utf-8"));
    walk(j.flow || (j.module ? [j] : []));
  } catch (e) {
    console.error(f, e.message);
  }
}

console.log(`total modules: ${total}, files: ${readdirSync(root).length}`);
Object.entries(types)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 40)
  .forEach(([t, c]) => console.log(`${String(c).padStart(4)}  ${t}`));

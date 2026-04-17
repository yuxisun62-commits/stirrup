#!/usr/bin/env node
// Post-build cleanup for `tsc -p tsconfig.plugins.json`.
//
// That config has rootDir=. so it can resolve type-only imports from plugins/
// into src/. A side effect is that tsc also emits .js / .d.ts files for the
// src/ modules those plugins reference transitively, polluting the source
// tree. Those artifacts aren't shipped (only plugins/public/ is included in
// `files`), but they leak into git status and confuse contributors. Wipe
// them here so the tree stays clean after every build.

import { rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const KEEP_UNDER = ["plugins/public"];

function walk(dir, visit) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (full === "node_modules" || full === "dist" || full === ".git") continue;
      walk(full, visit);
    } else if (s.isFile()) {
      visit(full);
    }
  }
}

let removed = 0;
walk("src", (file) => {
  if (!file.endsWith(".js") && !file.endsWith(".d.ts") && !file.endsWith(".js.map") && !file.endsWith(".d.ts.map")) return;
  // Don't touch anything legitimately under a keep path
  if (KEEP_UNDER.some((k) => file.startsWith(k))) return;
  try {
    rmSync(file);
    removed += 1;
  } catch { /* ignore */ }
});

if (removed > 0) {
  console.log(`[clean-plugin-build] removed ${removed} stray artifact(s) under src/`);
}

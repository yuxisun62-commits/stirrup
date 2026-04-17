#!/usr/bin/env node
// Post-build cleanup for `tsc -p tsconfig.plugins.json`.
//
// That config has rootDir=. so it can resolve type-only imports from plugins/
// into src/. A side effect is that tsc also emits .js / .d.ts files for the
// src/ modules those plugins reference transitively, polluting the source
// tree. Those artifacts aren't shipped (only plugins/public/ is included in
// `files`), but they leak into git status and confuse contributors. Wipe
// them here so the tree stays clean after every build.

import { rmSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

function walk(dir, visit) {
  if (!existsSync(dir)) return;
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

// Stray-artifact heuristic: the plugin compile pass emits .js / .d.ts / map
// files right next to the .ts file it compiled from. That means a stray file
// always has a matching .ts sibling at the same path. Legitimate source-tree
// artifacts (the pre-built UI bundle at src/ui/dist/assets/*.js, for example)
// have no .ts sibling — we must NOT delete those, otherwise the served UI
// 404s and the browser falls back to the SPA index.html, producing the MIME
// error "expected a JavaScript module but the server responded with
// text/html". Been there, broke that.
function hasTsSibling(file) {
  const withoutExt = file.replace(/\.js$|\.d\.ts$|\.js\.map$|\.d\.ts\.map$/, "");
  return existsSync(withoutExt + ".ts");
}

let removed = 0;
walk("src", (file) => {
  if (!/\.(js|d\.ts|js\.map|d\.ts\.map)$/.test(file)) return;
  if (!hasTsSibling(file)) return;
  try {
    rmSync(file);
    removed += 1;
  } catch { /* ignore */ }
});

if (removed > 0) {
  console.log(`[clean-plugin-build] removed ${removed} stray artifact(s) under src/`);
}

/**
 * Stirrup Plugin: Git & Project Scaffolding
 * Node types: scaffold-files, git-init-push, git-clone, git-branch-push, codebase-read
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { resolve, dirname, join, relative, extname, sep as pathSep } from "node:path";
import { execFileSync } from "node:child_process";

// ── Security helpers ─────────────────────────────────────────────

/** Strip token from error messages to prevent leakage via event stream */
function sanitizeError(err: unknown, token?: string): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const safe = token ? msg.replaceAll(token, "***") : msg;
  return new Error(safe);
}

/** Verify resolved path stays within a base directory */
function assertContained(filePath: string, baseDir: string): void {
  const resolved = resolve(filePath);
  const base = resolve(baseDir);
  if (resolved !== base && !resolved.startsWith(base + pathSep) && !resolved.startsWith(base + "/")) {
    throw new Error(`Path traversal blocked: "${filePath}" escapes "${baseDir}"`);
  }
}

/** Validate URL is HTTPS only — blocks git://, file://, ssh:// SSRF vectors */
function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Blocked protocol "${parsed.protocol}" — only https: and http: allowed`);
  }
}

/** Sanitize a name derived from user input (repo names, branch names) */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^\.+/, "").slice(0, 100) || "unnamed";
}

export default function register(ctx: PluginContext) {

  // ── scaffold-files ───────────────────────────────────────────────

  ctx.registerNodeType("scaffold-files", async (config, execCtx) => {
    const { code, tests, integrationTests, docs, outputDir, repoName } = {
      ...execCtx.inputs,
      ...config,
    } as {
      code: string; tests?: string; integrationTests?: string;
      docs?: string; outputDir: string; repoName?: string;
    };

    if (!code) throw new Error("code input is required");
    if (!outputDir) throw new Error("outputDir config is required");

    const safeName = repoName ? sanitizeName(repoName) : undefined;
    const dir = safeName ? resolve(outputDir, safeName) : resolve(outputDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    function writeFile(relPath: string, content: string): void {
      const filePath = resolve(dir, relPath);
      assertContained(filePath, dir);
      const fileDir = dirname(filePath);
      if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
      writeFileSync(filePath, content + "\n", "utf-8");
    }

    function parseAndWrite(text: string): string[] {
      const written: string[] = [];
      const regex = /(?:\/\/|#)\s*===\s*(?:FILE|TEST FILE|PATCHED FILE|DOC):\s*(.+?)\s*===/gi;
      const positions: { path: string; start: number }[] = [];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        positions.push({ path: match[1].trim(), start: match.index + match[0].length });
      }

      for (let i = 0; i < positions.length; i++) {
        const end = i + 1 < positions.length
          ? text.lastIndexOf("\n", positions[i + 1].start - positions[i + 1].path.length - 10)
          : text.length;

        let content = text.slice(positions[i].start, end).trim();
        if (content.startsWith("```")) {
          const nl = content.indexOf("\n");
          content = content.slice(nl + 1);
          if (content.endsWith("```")) content = content.slice(0, -3).trimEnd();
        }

        writeFile(positions[i].path, content);
        written.push(positions[i].path);
      }
      return written;
    }

    function parseDocSections(text: string): string[] {
      const written: string[] = [];
      const regex = /===\s*(.+?\.\w+)\s*===/gi;
      const positions: { path: string; start: number }[] = [];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        positions.push({ path: match[1].trim(), start: match.index + match[0].length });
      }

      for (let i = 0; i < positions.length; i++) {
        const end = i + 1 < positions.length
          ? text.lastIndexOf("\n", positions[i + 1].start - positions[i + 1].path.length - 10)
          : text.length;
        const content = text.slice(positions[i].start, end).trim();
        if (!content) continue;

        writeFile(positions[i].path, content);
        written.push(positions[i].path);
      }
      return written;
    }

    const files: string[] = [];
    files.push(...parseAndWrite(code));
    if (tests) files.push(...parseAndWrite(tests));
    if (integrationTests) files.push(...parseAndWrite(integrationTests));
    if (docs) files.push(...parseDocSections(docs));

    return { outputDir: dir, filesWritten: files.length, files };
  });

  // ── git-init-push ────────────────────────────────────────────────

  ctx.registerNodeType("git-init-push", async (config, execCtx) => {
    // Prefer inputs over config for security-sensitive params
    const token = (execCtx.inputs.token as string) ?? (config.token as string);
    const dir = (execCtx.inputs.dir as string) ?? (config.dir as string);
    const remoteUrl = (execCtx.inputs.remoteUrl as string) ?? (config.remoteUrl as string);
    const branch = (execCtx.inputs.branch as string) ?? (config.branch as string) ?? "main";
    const commitMessage = (execCtx.inputs.commitMessage as string) ?? (config.commitMessage as string)
      ?? "Initial commit \u2014 generated by Stirrup Dark Factory";
    const force = (execCtx.inputs.force as boolean) ?? (config.force as boolean) ?? false;

    if (!dir) throw new Error("dir is required");
    if (!remoteUrl) throw new Error("remoteUrl is required");
    assertSafeUrl(remoteUrl);

    const targetDir = resolve(dir);
    if (!existsSync(targetDir)) throw new Error(`Directory does not exist: ${targetDir}`);

    let authUrl = remoteUrl;
    if (token && remoteUrl.startsWith("https://")) {
      authUrl = remoteUrl.replace("https://", `https://${token}@`);
    }

    function git(...args: string[]): string {
      try {
        return execFileSync("git", args, { cwd: targetDir, encoding: "utf-8", timeout: 30_000 }).trim();
      } catch (err) {
        throw sanitizeError(err, token);
      }
    }

    git("init", "-b", branch);
    git("add", "-A");
    git("commit", "-m", commitMessage);
    git("remote", "add", "origin", authUrl);
    // force=true overwrites any prior history on the remote branch.
    // Needed when the caller is reusing an existing repo (e.g. template
    // reruns with the same productName) since the default push will be
    // rejected as non-fast-forward.
    const pushArgs = force ? ["push", "-u", "--force", "origin", branch] : ["push", "-u", "origin", branch];
    git(...pushArgs);

    const fileList = git("ls-files").split("\n").filter(Boolean);

    return {
      pushed: true,
      branch,
      remote: remoteUrl, // Never expose authUrl
      filesCommitted: fileList.length,
      commitMessage,
    };
  });

  // ── git-clone ────────────────────────────────────────────────────

  ctx.registerNodeType("git-clone", async (config, execCtx) => {
    const repoUrl = (execCtx.inputs.repoUrl as string) ?? (config.repoUrl as string);
    const token = (execCtx.inputs.token as string) ?? (config.token as string);
    const outputDir = (execCtx.inputs.outputDir as string) ?? (config.outputDir as string) ?? "./cloned-repos";
    const depth = (execCtx.inputs.depth as number) ?? (config.depth as number);

    if (!repoUrl) throw new Error("repoUrl is required");
    assertSafeUrl(repoUrl);

    // Sanitize repo name from URL to prevent path traversal
    const rawName = repoUrl.replace(/\.git$/, "").split("/").pop() ?? "repo";
    const repoName = sanitizeName(rawName);
    const dir = resolve(outputDir, repoName);

    // Verify dir stays within outputDir
    assertContained(dir, resolve(outputDir));

    let authUrl = repoUrl;
    if (token && repoUrl.startsWith("https://")) {
      authUrl = repoUrl.replace("https://", `https://${token}@`);
    }

    // Remove existing clone if present (safe — verified within outputDir)
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }

    const args = ["clone"];
    if (depth) args.push("--depth", String(depth));
    args.push(authUrl, dir);

    try {
      execFileSync("git", args, { encoding: "utf-8", timeout: 60_000 });
    } catch (err) {
      throw sanitizeError(err, token);
    }

    return { clonedDir: dir, repoName };
  });

  // ── codebase-read ────────────────────────────────────────────────

  ctx.registerNodeType("codebase-read", async (config, execCtx) => {
    const dir = (execCtx.inputs.dir as string) ?? (config.dir as string);
    const maxFileSize = (config.maxFileSize as number) ?? 50_000;
    const maxTotalSize = (config.maxTotalSize as number) ?? 500_000;
    const extensions = config.extensions as string[] | undefined;

    if (!dir) throw new Error("dir is required");
    const rootDir = resolve(dir);
    if (!existsSync(rootDir)) throw new Error(`Directory does not exist: ${rootDir}`);

    const skipDirs = new Set([
      "node_modules", ".git", "dist", "build", ".next", "__pycache__",
      ".venv", "venv", ".tox", "coverage", ".nyc_output", ".cache",
    ]);
    // .env EXCLUDED by default — may contain secrets that would leak to LLM
    const defaultExts = new Set([
      ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
      ".json", ".yaml", ".yml", ".toml", ".md", ".txt", ".sql",
      ".html", ".css", ".scss", ".sh", ".dockerfile",
    ]);
    const allowedExts = extensions
      ? new Set(extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)))
      : defaultExts;

    const files: { path: string; content: string }[] = [];
    let totalSize = 0;

    function walk(dirPath: string) {
      if (totalSize >= maxTotalSize) return;
      let entries: string[];
      try { entries = readdirSync(dirPath); } catch { return; }

      for (const entry of entries) {
        if (skipDirs.has(entry)) continue;
        // Skip dotenv files regardless of extension setting
        if (entry === ".env" || entry.startsWith(".env.")) continue;
        const full = join(dirPath, entry);
        let st;
        try { st = statSync(full); } catch { continue; }

        if (st.isDirectory()) {
          walk(full);
        } else if (st.isFile()) {
          const ext = extname(entry).toLowerCase();
          const isAllowed = allowedExts.has(ext) ||
            (!ext && /^(Dockerfile|Makefile|Procfile|Gemfile)$/i.test(entry));
          if (!isAllowed) continue;
          if (st.size > maxFileSize) continue;
          if (totalSize + st.size > maxTotalSize) continue;

          try {
            const content = readFileSync(full, "utf-8");
            const relPath = relative(rootDir, full).replace(/\\/g, "/");
            files.push({ path: relPath, content });
            totalSize += st.size;
          } catch { /* skip unreadable */ }
        }
      }
    }

    walk(rootDir);

    const codebase = files
      .map((f) => `// === FILE: ${f.path} ===\n${f.content}`)
      .join("\n\n");

    return {
      codebase,
      fileCount: files.length,
      totalSizeKB: Math.round(totalSize / 1024),
      files: files.map((f) => f.path),
    };
  });

  // ── git-branch-push ──────────────────────────────────────────────

  ctx.registerNodeType("git-branch-push", async (config, execCtx) => {
    const dir = (execCtx.inputs.dir as string) ?? (config.dir as string);
    const branch = (execCtx.inputs.branch as string) ?? (config.branch as string);
    const commitMessage = (execCtx.inputs.commitMessage as string) ?? (config.commitMessage as string);
    const code = (execCtx.inputs.code as string) ?? (config.code as string);
    const token = (execCtx.inputs.token as string) ?? (config.token as string);

    if (!dir) throw new Error("dir is required");
    if (!branch) throw new Error("branch name is required");
    if (!code) throw new Error("code with file markers is required");

    const targetDir = resolve(dir);

    function git(...args: string[]): string {
      try {
        return execFileSync("git", args, { cwd: targetDir, encoding: "utf-8", timeout: 30_000 }).trim();
      } catch (err) {
        throw sanitizeError(err, token);
      }
    }

    // Embed token in remote URL if provided
    if (token) {
      try {
        const remoteUrl = git("remote", "get-url", "origin");
        if (remoteUrl.startsWith("https://") && !remoteUrl.includes("@")) {
          const authUrl = remoteUrl.replace("https://", `https://${token}@`);
          git("remote", "set-url", "origin", authUrl);
        }
      } catch { /* remote might not exist */ }
    }

    git("checkout", "-b", sanitizeName(branch));

    // Parse file markers and write changed files with path containment
    const regex = /(?:\/\/|#)\s*===\s*(?:FILE|TEST FILE|PATCHED FILE):\s*(.+?)\s*===/gi;
    const positions: { path: string; start: number }[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(code)) !== null) {
      positions.push({ path: match[1].trim(), start: match.index + match[0].length });
    }

    const written: string[] = [];
    for (let i = 0; i < positions.length; i++) {
      const end = i + 1 < positions.length
        ? code.lastIndexOf("\n", positions[i + 1].start - positions[i + 1].path.length - 10)
        : code.length;
      let content = code.slice(positions[i].start, end).trim();
      if (content.startsWith("```")) {
        const nl = content.indexOf("\n");
        content = content.slice(nl + 1);
        if (content.endsWith("```")) content = content.slice(0, -3).trimEnd();
      }

      const filePath = resolve(targetDir, positions[i].path);
      assertContained(filePath, targetDir);
      const fileDir = dirname(filePath);
      if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
      writeFileSync(filePath, content + "\n", "utf-8");
      written.push(positions[i].path);
    }

    if (written.length === 0) throw new Error("No file markers found in code input");

    git("add", "-A");
    const msg = commitMessage ?? "feat: brownfield improvements\n\nGenerated by Stirrup Dark Factory";
    git("commit", "-m", msg);
    git("push", "-u", "origin", sanitizeName(branch));

    return {
      branch: sanitizeName(branch),
      filesChanged: written.length,
      files: written,
      commitMessage: msg,
    };
  });
}

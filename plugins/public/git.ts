/**
 * Stirrup Plugin: Git & Project Scaffolding
 * Node types: scaffold-files, git-init-push, git-clone, git-branch-push, codebase-read
 *
 * scaffold-files: Parses "// === FILE: path ===" markers, writes files to disk
 * git-init-push: Init new repo, commit, push
 * git-clone: Clone an existing repo to a local directory
 * git-branch-push: Create branch, stage changes, commit, push on existing clone
 * codebase-read: Read all source files from a directory into a single string
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative, extname } from "node:path";
import { execFileSync } from "node:child_process";

export default function register(ctx: PluginContext) {
  /**
   * scaffold-files: Parse code with file markers and write to disk.
   *
   * Supports markers like:
   *   // === FILE: src/index.ts ===
   *   # === FILE: requirements.txt ===
   *   // === TEST FILE: tests/unit/user.test.ts ===
   *   === README.md ===
   */
  ctx.registerNodeType("scaffold-files", async (config, execCtx) => {
    const { code, tests, integrationTests, docs, outputDir, repoName } = {
      ...execCtx.inputs,
      ...config,
    } as {
      code: string;
      tests?: string;
      integrationTests?: string;
      docs?: string;
      outputDir: string;
      repoName?: string;
    };

    if (!code) throw new Error("code input is required");
    if (!outputDir) throw new Error("outputDir config is required");

    // If repoName provided, use it as subdirectory
    const dir = repoName ? resolve(outputDir, repoName) : resolve(outputDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    function parseAndWrite(text: string): string[] {
      const written: string[] = [];
      // Match: // === FILE: path === or # === FILE: path === or variations
      const regex = /(?:\/\/|#)\s*===\s*(?:FILE|TEST FILE|PATCHED FILE|DOC):\s*(.+?)\s*===/gi;
      const positions: { path: string; start: number }[] = [];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        positions.push({
          path: match[1].trim(),
          start: match.index + match[0].length,
        });
      }

      for (let i = 0; i < positions.length; i++) {
        const end =
          i + 1 < positions.length
            ? text.lastIndexOf("\n", positions[i + 1].start - positions[i + 1].path.length - 10)
            : text.length;

        let content = text.slice(positions[i].start, end).trim();
        if (content.startsWith("```")) {
          const firstNewline = content.indexOf("\n");
          content = content.slice(firstNewline + 1);
          if (content.endsWith("```")) content = content.slice(0, -3).trimEnd();
        }

        const filePath = join(dir, positions[i].path);
        const fileDir = dirname(filePath);
        if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
        writeFileSync(filePath, content + "\n", "utf-8");
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
        positions.push({
          path: match[1].trim(),
          start: match.index + match[0].length,
        });
      }

      for (let i = 0; i < positions.length; i++) {
        const end =
          i + 1 < positions.length
            ? text.lastIndexOf("\n", positions[i + 1].start - positions[i + 1].path.length - 10)
            : text.length;

        const content = text.slice(positions[i].start, end).trim();
        if (!content) continue;

        const filePath = join(dir, positions[i].path);
        const fileDir = dirname(filePath);
        if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
        writeFileSync(filePath, content + "\n", "utf-8");
        written.push(positions[i].path);
      }

      return written;
    }

    const files: string[] = [];
    files.push(...parseAndWrite(code));
    if (tests) files.push(...parseAndWrite(tests));
    if (integrationTests) files.push(...parseAndWrite(integrationTests));
    if (docs) files.push(...parseDocSections(docs));

    return {
      outputDir: dir,
      filesWritten: files.length,
      files,
    };
  });

  /**
   * git-init-push: Initialize a git repo, commit all files, and push.
   * Uses execFileSync (array args, no shell) to prevent injection.
   */
  ctx.registerNodeType("git-init-push", async (config, execCtx) => {
    const { dir, remoteUrl, token, branch, commitMessage } = {
      ...execCtx.inputs,
      ...config,
    } as {
      dir: string;
      remoteUrl: string;
      token?: string;
      branch?: string;
      commitMessage?: string;
    };

    if (!dir) throw new Error("dir is required");
    if (!remoteUrl) throw new Error("remoteUrl is required");

    const targetDir = resolve(dir);
    if (!existsSync(targetDir)) throw new Error(`Directory does not exist: ${targetDir}`);

    const branchName = branch ?? "main";
    const message = commitMessage ?? "Initial commit \u2014 generated by Stirrup Dark Factory";

    // Build authenticated URL (token embedded, never logged)
    let authUrl = remoteUrl;
    if (token && remoteUrl.startsWith("https://")) {
      authUrl = remoteUrl.replace("https://", `https://${token}@`);
    }

    // execFileSync with array args — no shell, no injection
    function git(...args: string[]): string {
      return execFileSync("git", args, {
        cwd: targetDir,
        encoding: "utf-8",
        timeout: 30_000,
      }).trim();
    }

    git("init", "-b", branchName);
    git("add", "-A");
    git("commit", "-m", message);
    git("remote", "add", "origin", authUrl);

    let pushOutput: string;
    try {
      pushOutput = git("push", "-u", "origin", branchName);
    } catch (err: unknown) {
      // git push writes progress to stderr even on success
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("error") || msg.includes("fatal")) throw err;
      pushOutput = msg;
    }

    const fileList = git("ls-files").split("\n").filter(Boolean);

    return {
      pushed: true,
      branch: branchName,
      remote: remoteUrl,
      filesCommitted: fileList.length,
      commitMessage: message,
    };
  });

  /**
   * git-clone: Clone a repo to a local directory.
   */
  ctx.registerNodeType("git-clone", async (config, execCtx) => {
    const { repoUrl, token, outputDir, depth } = {
      ...execCtx.inputs,
      ...config,
    } as {
      repoUrl: string;
      token?: string;
      outputDir?: string;
      depth?: number;
    };

    if (!repoUrl) throw new Error("repoUrl is required");

    // Extract repo name from URL for default dir
    const repoName = repoUrl.replace(/\.git$/, "").split("/").pop() ?? "repo";
    const dir = resolve(outputDir ?? "./cloned-repos", repoName);

    // Build authenticated URL
    let authUrl = repoUrl;
    if (token && repoUrl.startsWith("https://")) {
      authUrl = repoUrl.replace("https://", `https://${token}@`);
    }

    // Remove existing clone if present
    if (existsSync(dir)) {
      execFileSync("rm", ["-rf", dir], { encoding: "utf-8", timeout: 10_000 });
    }

    const args = ["clone"];
    if (depth) args.push("--depth", String(depth));
    args.push(authUrl, dir);

    execFileSync("git", args, { encoding: "utf-8", timeout: 60_000 });

    return {
      clonedDir: dir,
      repoName,
    };
  });

  /**
   * codebase-read: Read all source files into a formatted string.
   * Skips node_modules, .git, dist, build, binary files, etc.
   */
  ctx.registerNodeType("codebase-read", async (config, execCtx) => {
    const { dir, maxFileSize, maxTotalSize, extensions } = {
      ...execCtx.inputs,
      ...config,
    } as {
      dir: string;
      maxFileSize?: number;
      maxTotalSize?: number;
      extensions?: string[];
    };

    if (!dir) throw new Error("dir is required");
    const rootDir = resolve(dir);
    if (!existsSync(rootDir)) throw new Error(`Directory does not exist: ${rootDir}`);

    const maxFile = maxFileSize ?? 50_000; // 50KB per file
    const maxTotal = maxTotalSize ?? 500_000; // 500KB total
    const skipDirs = new Set([
      "node_modules", ".git", "dist", "build", ".next", "__pycache__",
      ".venv", "venv", ".tox", "coverage", ".nyc_output", ".cache",
    ]);
    const defaultExts = new Set([
      ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
      ".json", ".yaml", ".yml", ".toml", ".md", ".txt", ".sql",
      ".html", ".css", ".scss", ".env", ".sh", ".dockerfile",
    ]);
    const allowedExts = extensions
      ? new Set(extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)))
      : defaultExts;

    const files: { path: string; content: string }[] = [];
    let totalSize = 0;

    function walk(dirPath: string) {
      if (totalSize >= maxTotal) return;
      let entries: string[];
      try { entries = readdirSync(dirPath); } catch { return; }

      for (const entry of entries) {
        if (skipDirs.has(entry)) continue;
        const full = join(dirPath, entry);
        let st;
        try { st = statSync(full); } catch { continue; }

        if (st.isDirectory()) {
          walk(full);
        } else if (st.isFile()) {
          const ext = extname(entry).toLowerCase();
          // Also include files with no extension if named like Dockerfile, Makefile, etc.
          const isAllowed = allowedExts.has(ext) || (!ext && /^(Dockerfile|Makefile|Procfile|Gemfile)$/i.test(entry));
          if (!isAllowed) continue;
          if (st.size > maxFile) continue;
          if (totalSize + st.size > maxTotal) continue;

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

    // Format as // === FILE: path === blocks
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

  /**
   * git-branch-push: On an existing clone, create a branch, write changed
   * files from code markers, stage, commit, and push.
   */
  ctx.registerNodeType("git-branch-push", async (config, execCtx) => {
    const { dir, branch, commitMessage, code, token } = {
      ...execCtx.inputs,
      ...config,
    } as {
      dir: string;
      branch: string;
      commitMessage: string;
      code: string;
      token?: string;
    };

    if (!dir) throw new Error("dir is required");
    if (!branch) throw new Error("branch name is required");
    if (!code) throw new Error("code with file markers is required");

    const targetDir = resolve(dir);

    function git(...args: string[]): string {
      return execFileSync("git", args, {
        cwd: targetDir,
        encoding: "utf-8",
        timeout: 30_000,
      }).trim();
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

    // Create and checkout branch
    git("checkout", "-b", branch);

    // Parse file markers and write changed files
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

      const filePath = join(targetDir, positions[i].path);
      const fileDir = dirname(filePath);
      if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
      writeFileSync(filePath, content + "\n", "utf-8");
      written.push(positions[i].path);
    }

    if (written.length === 0) throw new Error("No file markers found in code input");

    // Stage, commit, push
    git("add", "-A");
    const msg = commitMessage ?? `feat: brownfield improvements\n\nGenerated by Stirrup Dark Factory`;
    git("commit", "-m", msg);

    try {
      git("push", "-u", "origin", branch);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("fatal")) throw err;
    }

    return {
      branch,
      filesChanged: written.length,
      files: written,
      commitMessage: msg,
    };
  });
}

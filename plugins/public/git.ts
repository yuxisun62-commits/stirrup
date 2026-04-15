/**
 * Stirrup Plugin: Git & Project Scaffolding
 * Node types: scaffold-files, git-init-push
 *
 * scaffold-files: Parses code with "// === FILE: path ===" markers and
 *   writes each file to a target directory. Creates directories as needed.
 *
 * git-init-push: Initializes a git repo, commits all files, adds a remote,
 *   and pushes. Uses execFileSync (no shell — injection-safe).
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
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
}

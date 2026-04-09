/**
 * Stirrup Plugin: File System
 * Node types: fs-read, fs-write, fs-list, fs-delete
 * Tools: fs-read-file, fs-list-dir
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, statSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname, basename } from "node:path";

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("fs-read", async (config, execCtx) => {
    const { path, encoding } = { ...execCtx.inputs, ...config } as {
      path: string; encoding?: BufferEncoding;
    };
    const fullPath = resolve(path);
    if (!existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
    const content = readFileSync(fullPath, encoding ?? "utf-8");
    const stats = statSync(fullPath);
    return {
      content,
      path: fullPath,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      extension: extname(fullPath),
    };
  });

  ctx.registerNodeType("fs-write", async (config, execCtx) => {
    const { path, content, encoding, createDirs } = { ...execCtx.inputs, ...config } as {
      path: string; content: string; encoding?: BufferEncoding; createDirs?: boolean;
    };
    const fullPath = resolve(path);
    if (createDirs !== false) mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, encoding ?? "utf-8");
    return { path: fullPath, size: Buffer.byteLength(content), written: true };
  });

  ctx.registerNodeType("fs-list", async (config, execCtx) => {
    const { path, pattern, recursive } = { ...execCtx.inputs, ...config } as {
      path: string; pattern?: string; recursive?: boolean;
    };
    const fullPath = resolve(path);
    if (!existsSync(fullPath)) throw new Error(`Directory not found: ${fullPath}`);

    const listDir = (dir: string): Array<{ name: string; path: string; isFile: boolean; size: number }> => {
      const entries = readdirSync(dir, { withFileTypes: true });
      const results: Array<{ name: string; path: string; isFile: boolean; size: number }> = [];
      for (const entry of entries) {
        const entryPath = resolve(dir, entry.name);
        if (entry.isFile()) {
          if (pattern && !entry.name.match(new RegExp(pattern))) continue;
          results.push({ name: entry.name, path: entryPath, isFile: true, size: statSync(entryPath).size });
        } else if (entry.isDirectory() && recursive) {
          results.push(...listDir(entryPath));
        }
      }
      return results;
    };

    const files = listDir(fullPath);
    return { files, count: files.length };
  });

  ctx.registerNodeType("fs-delete", async (config, execCtx) => {
    const { path } = { ...execCtx.inputs, ...config } as { path: string };
    const fullPath = resolve(path);
    if (!existsSync(fullPath)) return { deleted: false, reason: "not found" };
    unlinkSync(fullPath);
    return { deleted: true, path: fullPath };
  });

  ctx.registerTool({
    name: "fs-read-file",
    description: "Read the contents of a file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "File path to read" } },
      required: ["path"],
    },
    handler: async (input) => {
      const fullPath = resolve(input.path as string);
      return { content: readFileSync(fullPath, "utf-8"), path: fullPath };
    },
  });

  ctx.registerTool({
    name: "fs-list-dir",
    description: "List files in a directory",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, pattern: { type: "string" } },
      required: ["path"],
    },
    handler: async (input) => {
      const dir = resolve(input.path as string);
      const entries = readdirSync(dir, { withFileTypes: true });
      return {
        files: entries.filter((e) => e.isFile()).map((e) => e.name),
        directories: entries.filter((e) => e.isDirectory()).map((e) => e.name),
      };
    },
  });
}

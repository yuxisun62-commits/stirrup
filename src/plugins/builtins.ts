import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { NodeRegistry } from "../nodes/NodeRegistry.js";
import type { ToolManager } from "../ai/ToolManager.js";
import type { PluginContext, PluginInfo } from "./PluginManifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BuiltinPluginDef {
  name: string;
  description: string;
  category: "integration" | "utility" | "database" | "cloud";
  peerDep?: string;
  installHint?: string;
}

export const BUILTIN_PLUGINS: BuiltinPluginDef[] = [
  { name: "github", description: "GitHub PRs, issues, comments, file listing, code search", category: "integration" },
  { name: "slack", description: "Send messages, blocks, upload files, list channels", category: "integration" },
  { name: "webhook", description: "Outbound webhooks with HMAC signing, retry, and batch send", category: "integration" },
  { name: "filesystem", description: "Read, write, list, and delete files", category: "utility" },
  { name: "git", description: "Scaffold files from code markers, git init/commit/push to remote", category: "utility" },
  { name: "csv-json", description: "Parse/generate CSV, transform and merge JSON data", category: "utility" },
  { name: "http-auth", description: "OAuth tokens, API key requests, JWT decode, Basic auth", category: "integration" },
  { name: "scheduler", description: "Delay, rate-limit, batch, and debounce utilities", category: "utility" },
  { name: "logger", description: "Log, metrics, assertions, and timers", category: "utility" },
  { name: "launchmatic", description: "Launchmatic deployment platform — deploy, databases, domains, browser testing, AI", category: "cloud" },
  { name: "typefully", description: "Typefully — schedule X/Twitter threads and LinkedIn posts, with AI-friendly draft API", category: "integration" },
  { name: "buffer", description: "Buffer — schedule posts to LinkedIn, Facebook, Instagram, Threads, and more", category: "integration" },
  { name: "replicate", description: "Replicate — run any hosted model: Flux/SDXL for images, Whisper for audio, Llama for text", category: "integration" },
  { name: "linkedin", description: "LinkedIn — post to personal or org feed, fetch post stats, list recent shares", category: "integration" },
  { name: "postgres", description: "PostgreSQL queries, inserts, and transactions", category: "database", peerDep: "pg", installHint: "npm install pg" },
  { name: "redis", description: "Redis get, set, publish, and list operations", category: "database", peerDep: "ioredis", installHint: "npm install ioredis" },
  { name: "email", description: "Send emails via SMTP", category: "integration", peerDep: "nodemailer", installHint: "npm install nodemailer" },
  { name: "s3", description: "AWS S3 get, put, list, and delete objects", category: "cloud", peerDep: "@aws-sdk/client-s3", installHint: "npm install @aws-sdk/client-s3" },
  // ── Communication batch (0.7.4) ─────────────────────────────────────
  { name: "gmail", description: "Send and search Gmail messages via the Google API", category: "integration" },
  { name: "discord", description: "Discord bot: send/edit/delete messages, reactions, list history", category: "integration" },
  { name: "telegram", description: "Telegram bot: send messages, photos, edit, delete, webhooks", category: "integration" },
  { name: "sendgrid", description: "SendGrid transactional email: send, templates, contacts", category: "integration" },
  { name: "twilio", description: "Twilio SMS, WhatsApp, voice calls, and Verify 2FA codes", category: "integration" },
];

function resolvePluginPath(name: string): string | null {
  // Prefer .js over .ts: the published package ships both, but Node < 22.6
  // cannot import .ts natively, so the compiled .js is the only path that
  // works on every supported runtime. .ts remains as a fallback so local
  // dev in this repo still works when `npm run build` hasn't been run yet.
  const candidates = [
    resolve(__dirname, `../../plugins/public/${name}.js`),
    resolve(__dirname, `../../plugins/public/${name}.ts`),
    resolve(__dirname, `../../../plugins/public/${name}.js`),
    resolve(__dirname, `../../../plugins/public/${name}.ts`),
    resolve(process.cwd(), `plugins/public/${name}.js`),
    resolve(process.cwd(), `plugins/public/${name}.ts`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function loadBuiltinPlugin(
  name: string,
  registry: NodeRegistry,
  toolManager: ToolManager
): Promise<PluginInfo | null> {
  const def = BUILTIN_PLUGINS.find((p) => p.name === name);
  if (!def) return null;

  if (def.peerDep) {
    try { await import(def.peerDep); } catch {
      throw new Error(`Plugin "${name}" requires: ${def.installHint}`);
    }
  }

  const pluginPath = resolvePluginPath(name);
  if (!pluginPath) throw new Error(`Plugin file not found for "${name}"`);

  const nodeTypes: string[] = [];
  const tools: string[] = [];
  const ctx: PluginContext = {
    registerNodeType: (type, handler) => { registry.register(type, handler); nodeTypes.push(type); },
    registerTool: (tool) => { toolManager.register(tool); tools.push(tool.name); },
  };

  const mod = await import(pathToFileURL(pluginPath).href);
  if (typeof mod.default !== "function") throw new Error(`Plugin "${name}" has no default export`);
  mod.default(ctx);

  return { name: def.name, version: "built-in", source: `stirrup/${def.name}`, nodeTypes, tools };
}

export async function loadBuiltinPlugins(
  registry: NodeRegistry,
  toolManager: ToolManager,
  options: { verbose?: boolean } = {}
): Promise<{ loaded: PluginInfo[]; available: BuiltinPluginDef[] }> {
  const loaded: PluginInfo[] = [];
  const available: BuiltinPluginDef[] = [];

  for (const def of BUILTIN_PLUGINS) {
    if (def.peerDep) {
      try { await import(def.peerDep); } catch {
        available.push(def);
        if (options.verbose) console.log(`  [plugin] ${def.name}: available (requires ${def.installHint})`);
        continue;
      }
    }

    try {
      const info = await loadBuiltinPlugin(def.name, registry, toolManager);
      if (info) {
        loaded.push(info);
        if (options.verbose) console.log(`  [plugin] ${def.name}: loaded (${info.nodeTypes.length} types, ${info.tools.length} tools)`);
      }
    } catch (err) {
      if (options.verbose) console.log(`  [plugin] ${def.name}: skipped — ${(err as Error).message}`);
      available.push(def);
    }
  }

  return { loaded, available };
}

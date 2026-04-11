/**
 * Stirrup Plugin: Buffer (buffer.com)
 *
 * Schedule posts to LinkedIn, Facebook, Instagram, Threads, and the
 * platforms Typefully doesn't cover. Use alongside the typefully plugin
 * for X/Twitter — Buffer's threading on X is weaker than Typefully's,
 * but its multi-platform reach is far broader.
 *
 * Node types:
 *   buffer-list-profiles  — list connected social channels (call this once to
 *                            discover profile IDs, then hardcode in workflows)
 *   buffer-schedule       — queue or schedule a post to one or more profiles
 *   buffer-queue-status   — pending posts in a profile's queue
 *
 * Tools (for agent-tool-use):
 *   buffer-schedule-post  — same as the node, exposed for agent use
 *
 * Auth: Bearer token from https://publish.buffer.com/account/apps
 *   - Pass via `accessToken` in node config, or
 *   - Set BUFFER_ACCESS_TOKEN env var
 *
 * API base: https://api.bufferapp.com/1
 *
 * Notes on Buffer's API:
 *   - The classic v1 REST API (this plugin) is on a long-term deprecation track
 *     but still works as of 2026. Buffer's newer GraphQL API is internal-only.
 *   - For maximum future-proofing, prefer the typefully plugin for X/Twitter
 *     and LinkedIn, and use this plugin only for the channels Typefully lacks.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

const API_BASE = "https://api.bufferapp.com/1";

interface BufferProfile {
  id: string;
  service: string;
  service_username?: string;
  formatted_username?: string;
  default?: boolean;
  schedules?: Array<{ days: string[]; times: string[] }>;
}

interface BufferUpdate {
  id: string;
  profile_id: string;
  status: string;
  text: string;
  scheduled_at?: number;
  created_at?: number;
  due_at?: number;
}

function bufferApi(token: string) {
  return async (
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const url = new URL(`${API_BASE}${path}`);
    let init: RequestInit;

    if (method === "GET") {
      url.searchParams.set("access_token", token);
      init = { method: "GET" };
    } else {
      // Buffer's classic API expects form-encoded POST bodies, not JSON.
      const form = new URLSearchParams();
      form.set("access_token", token);
      if (body) {
        for (const [k, v] of Object.entries(body)) {
          if (v === undefined || v === null) continue;
          if (Array.isArray(v)) {
            // Buffer wants `key[]=a&key[]=b` for arrays
            for (const item of v) form.append(`${k}[]`, String(item));
          } else if (typeof v === "object") {
            form.set(k, JSON.stringify(v));
          } else {
            form.set(k, String(v));
          }
        }
      }
      init = {
        method,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      };
    }

    const res = await fetch(url.toString(), init);
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Buffer API ${res.status}: ${errBody.slice(0, 300)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  };
}

function getToken(config: Record<string, unknown>): string {
  const token =
    (config.accessToken as string) ??
    (config.token as string) ??
    process.env.BUFFER_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "Buffer access token required: set BUFFER_ACCESS_TOKEN env var or pass `accessToken` in node config. Get one at https://publish.buffer.com/account/apps"
    );
  }
  return token;
}

export default function register(ctx: PluginContext) {
  // ─────────────────────── buffer-list-profiles ───────────────────────
  /**
   * List all connected Buffer profiles. Call this once to discover the
   * profile IDs you want to post to, then hardcode them in your workflow.
   */
  ctx.registerNodeType("buffer-list-profiles", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as { accessToken?: string };
    const api = bufferApi(getToken(merged));
    const result = (await api("GET", "/profiles.json")) as unknown as BufferProfile[];
    return {
      profiles: result.map((p) => ({
        id: p.id,
        service: p.service,
        username: p.service_username ?? p.formatted_username,
        isDefault: p.default ?? false,
      })),
      count: result.length,
    };
  });

  // ─────────────────────── buffer-schedule ───────────────────────
  /**
   * Queue or schedule a post to one or more profiles.
   *
   * Inputs/config:
   *   accessToken      — Buffer access token (or set BUFFER_ACCESS_TOKEN)
   *   profileIds       — string[] of Buffer profile IDs (from buffer-list-profiles)
   *   text             — string. The post body.
   *   scheduledAt      — ISO 8601 datetime string (optional; omit to add to queue)
   *   shorten          — boolean. Auto-shorten URLs in the text.
   *   now              — boolean. Post immediately (overrides scheduledAt).
   *   top              — boolean. Add to top of the queue.
   *   media            — { link?, description?, picture?, photo? } (optional image/link card)
   *
   * Outputs:
   *   updates          — Array of created update objects (one per profile)
   *   bufferCount      — Total updates created
   */
  ctx.registerNodeType("buffer-schedule", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as {
      accessToken?: string;
      profileIds: string[] | string;
      text: string;
      scheduledAt?: string;
      shorten?: boolean;
      now?: boolean;
      top?: boolean;
      media?: Record<string, unknown>;
    };

    if (!merged.text) throw new Error("buffer-schedule: `text` is required");
    const profileIds = Array.isArray(merged.profileIds)
      ? merged.profileIds
      : typeof merged.profileIds === "string"
      ? merged.profileIds.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    if (profileIds.length === 0) {
      throw new Error("buffer-schedule: `profileIds` is required (array or comma-separated string)");
    }

    const api = bufferApi(getToken(merged));
    const body: Record<string, unknown> = {
      profile_ids: profileIds,
      text: merged.text,
    };
    if (merged.scheduledAt) {
      // Buffer wants Unix epoch seconds, not ISO strings
      body.scheduled_at = Math.floor(new Date(merged.scheduledAt).getTime() / 1000);
    }
    if (merged.shorten) body.shorten = true;
    if (merged.now) body.now = true;
    if (merged.top) body.top = true;
    if (merged.media) body.media = merged.media;

    const result = await api("POST", "/updates/create.json", body);
    const updates = (result.updates as BufferUpdate[]) ?? [];

    return {
      updates: updates.map((u) => ({
        id: u.id,
        profileId: u.profile_id,
        status: u.status,
        scheduledAt: u.scheduled_at ? new Date(u.scheduled_at * 1000).toISOString() : null,
        dueAt: u.due_at ? new Date(u.due_at * 1000).toISOString() : null,
      })),
      bufferCount: (result.buffer_count as number) ?? updates.length,
    };
  });

  // ─────────────────────── buffer-queue-status ───────────────────────
  /**
   * Get pending updates for a profile. Use to gate "skip if already 5 things
   * queued today" logic in workflows.
   */
  ctx.registerNodeType("buffer-queue-status", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as { accessToken?: string; profileId: string };
    if (!merged.profileId) throw new Error("buffer-queue-status: `profileId` is required");
    const api = bufferApi(getToken(merged));
    const result = await api("GET", `/profiles/${merged.profileId}/updates/pending.json`);
    const updates = (result.updates as BufferUpdate[]) ?? [];
    return {
      pending: updates.length,
      updates: updates.map((u) => ({
        id: u.id,
        text: u.text,
        scheduledAt: u.scheduled_at ? new Date(u.scheduled_at * 1000).toISOString() : null,
      })),
    };
  });

  // ─────────────────────── Tool: buffer-schedule-post ───────────────────────
  ctx.registerTool({
    name: "buffer-schedule-post",
    description:
      "Schedule a post to one or more Buffer profiles (LinkedIn, Facebook, Instagram, Threads). Returns the created update IDs and scheduled times.",
    inputSchema: {
      type: "object",
      properties: {
        profileIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of Buffer profile IDs to post to.",
        },
        text: { type: "string", description: "Post body." },
        scheduledAt: {
          type: "string",
          description: "ISO 8601 datetime. Omit to add to queue at the next scheduled slot.",
        },
        now: { type: "boolean", description: "Post immediately." },
      },
      required: ["profileIds", "text"],
    },
    handler: async (input) => {
      const token = process.env.BUFFER_ACCESS_TOKEN;
      if (!token) throw new Error("BUFFER_ACCESS_TOKEN not set");
      const api = bufferApi(token);
      const body: Record<string, unknown> = {
        profile_ids: input.profileIds,
        text: input.text,
      };
      if (input.scheduledAt) {
        body.scheduled_at = Math.floor(new Date(input.scheduledAt as string).getTime() / 1000);
      }
      if (input.now) body.now = true;
      return await api("POST", "/updates/create.json", body);
    },
  });
}

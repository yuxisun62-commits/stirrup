/**
 * Stirrup Plugin: Typefully (typefully.com)
 *
 * Schedule and publish to X (Twitter) and LinkedIn via Typefully's REST API.
 * Designed for human-in-the-loop AI workflows: generate drafts with Claude,
 * save them to Typefully, optionally schedule them, optionally auto-share.
 *
 * Node types:
 *   typefully-create-draft   — create a draft (with optional schedule + auto-share)
 *   typefully-list-drafts    — list scheduled or recently published drafts
 *   typefully-get-notifications — fetch unread notifications (replies, etc.)
 *
 * Tools (for agent-tool-use nodes):
 *   typefully-create-draft   — same as the node, exposed for agent use
 *
 * Auth: API key from https://typefully.com/settings/integrations
 *   - Pass via `apiKey` in node config, or
 *   - Set TYPEFULLY_API_KEY env var
 *
 * API base: https://api.typefully.com/v1
 *
 * Why Typefully:
 *   - Cleanest API in the social-scheduling space (REST, bearer token, no OAuth dance)
 *   - Native "draft" concept means AI can generate and a human can approve
 *   - Single endpoint accepts both X threads and LinkedIn posts
 *   - Auto-detects threads from `\n\n\n\n` (4 newlines) separators
 *
 * Limitations vs. Buffer:
 *   - X (Twitter) and LinkedIn only — no Facebook, Instagram, TikTok
 *   - Use the buffer plugin alongside this one for those channels
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../safeFetch.js";

const API_BASE = "https://api.typefully.com/v1";

interface TypefullyDraft {
  id?: string | number;
  share_url?: string;
  scheduled_date?: string | null;
  status?: string;
}

function tfApi(apiKey: string) {
  return async (
    method: string,
    path: string,
    body?: unknown
  ): Promise<Record<string, unknown>> => {
    const res = await safeFetch(`${API_BASE}${path}`, {
      method,
      headers: {
        // Typefully uses an X-API-KEY header, NOT Authorization. Verified by
        // probing the live endpoint: requests with `Authorization: Bearer ...`
        // return "No API key provided" — the header is ignored entirely.
        // Both `X-API-KEY: <key>` and `X-API-KEY: Bearer <key>` are accepted,
        // but the bare form is canonical for X-API-KEY headers.
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Typefully API ${res.status}: ${errBody.slice(0, 300)}`);
    }
    if (res.status === 204) return { ok: true };
    return (await res.json()) as Record<string, unknown>;
  };
}

function getApiKey(config: Record<string, unknown>): string {
  const key = (config.apiKey as string) ?? (config.token as string) ?? process.env.TYPEFULLY_API_KEY;
  if (!key) {
    throw new Error(
      "Typefully API key required: set TYPEFULLY_API_KEY env var or pass `apiKey` in node config. Get one at https://typefully.com/settings/integrations"
    );
  }
  return key;
}

export default function register(ctx: PluginContext) {
  // ─────────────────────── typefully-create-draft ───────────────────────
  /**
   * Create a draft. The `content` field accepts a single tweet/post or a thread
   * (separate tweets with 4 newlines). Optionally schedule it or auto-share.
   *
   * Inputs/config:
   *   apiKey         — API key (or set TYPEFULLY_API_KEY)
   *   content        — string. For X threads use 4 newlines between tweets.
   *   threadify      — boolean. If true, Typefully auto-splits long content into a thread.
   *   share          — boolean. If true, returns a shareable preview URL.
   *   scheduleDate   — ISO 8601 date string OR "next-free-slot".
   *   autoRetweetEnabled — boolean. Auto-retweet after N hours (X only).
   *   autoPlugEnabled    — boolean. Auto-add a follow-up tweet linking to your latest.
   *
   * Outputs:
   *   draftId, shareUrl, scheduledDate, status
   */
  ctx.registerNodeType("typefully-create-draft", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as {
      apiKey?: string;
      content: string;
      threadify?: boolean;
      share?: boolean;
      scheduleDate?: string;
      autoRetweetEnabled?: boolean;
      autoPlugEnabled?: boolean;
    };
    if (!merged.content) throw new Error("typefully-create-draft: `content` is required");

    const api = tfApi(getApiKey(merged));
    const body: Record<string, unknown> = { content: merged.content };
    if (merged.threadify) body.threadify = true;
    if (merged.share) body.share = true;
    if (merged.scheduleDate) body["schedule-date"] = merged.scheduleDate;
    if (merged.autoRetweetEnabled) body["auto_retweet_enabled"] = true;
    if (merged.autoPlugEnabled) body["auto_plug_enabled"] = true;

    const draft = (await api("POST", "/drafts/", body)) as TypefullyDraft;
    return {
      draftId: draft.id,
      shareUrl: draft.share_url ?? null,
      scheduledDate: draft.scheduled_date ?? null,
      status: draft.status ?? "draft",
    };
  });

  // ─────────────────────── typefully-list-drafts ───────────────────────
  /**
   * List recently scheduled or published drafts.
   * filter: 'scheduled' | 'published' (defaults to 'scheduled')
   */
  ctx.registerNodeType("typefully-list-drafts", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as { apiKey?: string; filter?: string };
    const api = tfApi(getApiKey(merged));
    const filter = merged.filter ?? "scheduled";
    const path = filter === "published" ? "/drafts/recently-published/" : "/drafts/recently-scheduled/";
    const result = await api("GET", path);
    return { drafts: result, filter };
  });

  // ─────────────────────── typefully-get-notifications ───────────────────────
  /**
   * Fetch unread notifications (replies, mentions, engagement on scheduled posts).
   * Useful for "did anyone reply to my AI-generated post?" follow-up workflows.
   */
  ctx.registerNodeType("typefully-get-notifications", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as { apiKey?: string; markAsRead?: boolean };
    const api = tfApi(getApiKey(merged));
    const result = await api("GET", "/notifications/");
    if (merged.markAsRead) {
      await api("POST", "/notifications/mark-all-read/").catch(() => undefined);
    }
    return { notifications: result };
  });

  // ─────────────────────── Tool: typefully-create-draft ───────────────────────
  ctx.registerTool({
    name: "typefully-create-draft",
    description:
      "Create a draft post on Typefully (X/Twitter or LinkedIn). Use 4 newlines between tweets to create a thread. Can optionally schedule for a specific time or 'next-free-slot'.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Post content. For X threads, separate tweets with 4 newlines.",
        },
        threadify: {
          type: "boolean",
          description: "Auto-split long content into a thread.",
        },
        scheduleDate: {
          type: "string",
          description: "ISO 8601 datetime, or the literal string 'next-free-slot'.",
        },
        share: {
          type: "boolean",
          description: "Return a preview URL for sharing the draft before publishing.",
        },
      },
      required: ["content"],
    },
    handler: async (input) => {
      const apiKey = process.env.TYPEFULLY_API_KEY;
      if (!apiKey) throw new Error("TYPEFULLY_API_KEY not set");
      const api = tfApi(apiKey);
      const body: Record<string, unknown> = { content: input.content as string };
      if (input.threadify) body.threadify = true;
      if (input.share) body.share = true;
      if (input.scheduleDate) body["schedule-date"] = input.scheduleDate;
      const draft = (await api("POST", "/drafts/", body)) as TypefullyDraft;
      return {
        draftId: draft.id,
        shareUrl: draft.share_url ?? null,
        scheduledDate: draft.scheduled_date ?? null,
      };
    },
  });
}

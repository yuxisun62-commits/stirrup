/**
 * Stirrup Plugin: Discord
 * Node types: discord-send, discord-edit, discord-delete, discord-react,
 *             discord-list-messages
 * Tools: discord-send
 *
 * Auth: Bot token (service: "discord"). Create a bot at
 * discord.com/developers/applications, grab the token, paste it into the
 * Connections panel. The bot must be invited to the target server with
 * at least "Send Messages" + "Read Message History" permissions.
 *
 * We use the v10 REST API directly. For simple one-shot webhook posting
 * (no bot, just a webhook URL) use the existing webhook-send node.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../../src/plugins/safeFetch.js";

const API = "https://discord.com/api/v10";

function botHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "Stirrup (https://github.com/PrincipalForce/stirrup, 1.0)",
  };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    ...init,
    headers: { ...botHeaders(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Discord API ${res.status}: ${await res.text()}`);
  // 204 No Content on delete
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("discord-send", async (config, execCtx) => {
    const { token, channelId, content, embeds, tts, allowedMentions } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; channelId: string; content?: string;
      embeds?: Array<Record<string, unknown>>; tts?: boolean;
      allowedMentions?: Record<string, unknown>;
    };
    if (!content && !embeds) throw new Error("discord-send requires content or embeds");
    const msg = await call<{ id: string; channel_id: string; timestamp: string }>(
      token,
      `/channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content: content ?? "",
          embeds,
          tts: tts ?? false,
          allowed_mentions: allowedMentions,
        }),
      },
    );
    return { messageId: msg.id, channelId: msg.channel_id, timestamp: msg.timestamp };
  });

  ctx.registerNodeType("discord-edit", async (config, execCtx) => {
    const { token, channelId, messageId, content, embeds } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; channelId: string; messageId: string;
      content?: string; embeds?: Array<Record<string, unknown>>;
    };
    const msg = await call<{ id: string }>(
      token,
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "PATCH", body: JSON.stringify({ content, embeds }) },
    );
    return { messageId: msg.id, edited: true };
  });

  ctx.registerNodeType("discord-delete", async (config, execCtx) => {
    const { token, channelId, messageId } = { ...execCtx.inputs, ...config } as {
      token: string; channelId: string; messageId: string;
    };
    await call<void>(
      token,
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE" },
    );
    return { deleted: true };
  });

  ctx.registerNodeType("discord-react", async (config, execCtx) => {
    const { token, channelId, messageId, emoji } = { ...execCtx.inputs, ...config } as {
      token: string; channelId: string; messageId: string; emoji: string;
    };
    // Custom emojis arrive as "name:id"; unicode emojis go through URL-encoded.
    const encoded = emoji.includes(":") ? emoji : encodeURIComponent(emoji);
    await call<void>(
      token,
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encoded}/@me`,
      { method: "PUT" },
    );
    return { reacted: true };
  });

  ctx.registerNodeType("discord-list-messages", async (config, execCtx) => {
    const { token, channelId, limit, before, after } = { ...execCtx.inputs, ...config } as {
      token: string; channelId: string; limit?: number; before?: string; after?: string;
    };
    const params = new URLSearchParams();
    params.set("limit", String(Math.min(limit ?? 50, 100)));
    if (before) params.set("before", before);
    if (after) params.set("after", after);
    const msgs = await call<Array<Record<string, unknown>>>(
      token,
      `/channels/${encodeURIComponent(channelId)}/messages?${params.toString()}`,
    );
    return { messages: msgs, count: msgs.length };
  });

  ctx.registerTool({
    name: "discord-send",
    description: "Send a message to a Discord channel via a bot",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel ID" },
        content: { type: "string" },
      },
      required: ["channelId", "content"],
    },
    handler: async (input) => {
      const token = process.env.DISCORD_BOT_TOKEN;
      if (!token) throw new Error("DISCORD_BOT_TOKEN not set");
      const { channelId, content } = input as { channelId: string; content: string };
      const msg = await call<{ id: string }>(
        token,
        `/channels/${encodeURIComponent(channelId)}/messages`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      return { messageId: msg.id };
    },
  });
}

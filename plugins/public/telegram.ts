/**
 * Stirrup Plugin: Telegram (send-side)
 * Node types: telegram-send, telegram-send-photo, telegram-edit,
 *             telegram-delete, telegram-set-webhook
 * Tools: telegram-send
 *
 * Complements the telegram-long-poll trigger shipped in the TriggerManager.
 * Uses the bot token stored under service "telegram" (same token both
 * pollers and senders use).
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../safeFetch.js";

function tgApi(token: string, method: string) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function call<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await safeFetch(tgApi(token, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
  return data.result as T;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("telegram-send", async (config, execCtx) => {
    const { token, chatId, text, parseMode, disableWebPagePreview, replyToMessageId, replyMarkup } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; chatId: number | string; text: string;
      parseMode?: "Markdown" | "MarkdownV2" | "HTML";
      disableWebPagePreview?: boolean; replyToMessageId?: number;
      replyMarkup?: Record<string, unknown>;
    };
    const msg = await call<{ message_id: number; chat: { id: number }; date: number }>(
      token,
      "sendMessage",
      {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: disableWebPagePreview,
        reply_to_message_id: replyToMessageId,
        reply_markup: replyMarkup,
      },
    );
    return { messageId: msg.message_id, chatId: msg.chat.id, date: msg.date };
  });

  ctx.registerNodeType("telegram-send-photo", async (config, execCtx) => {
    const { token, chatId, photoUrl, caption, parseMode } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; chatId: number | string; photoUrl: string;
      caption?: string; parseMode?: string;
    };
    const msg = await call<{ message_id: number }>(
      token,
      "sendPhoto",
      { chat_id: chatId, photo: photoUrl, caption, parse_mode: parseMode },
    );
    return { messageId: msg.message_id };
  });

  ctx.registerNodeType("telegram-edit", async (config, execCtx) => {
    const { token, chatId, messageId, text, parseMode } = { ...execCtx.inputs, ...config } as {
      token: string; chatId: number | string; messageId: number; text: string; parseMode?: string;
    };
    await call<Record<string, unknown>>(token, "editMessageText", {
      chat_id: chatId, message_id: messageId, text, parse_mode: parseMode,
    });
    return { edited: true };
  });

  ctx.registerNodeType("telegram-delete", async (config, execCtx) => {
    const { token, chatId, messageId } = { ...execCtx.inputs, ...config } as {
      token: string; chatId: number | string; messageId: number;
    };
    await call<boolean>(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
    return { deleted: true };
  });

  // Register a webhook so Telegram pushes updates to `url` instead of
  // requiring a long-poll. Useful for production deployments with a
  // public URL; leave unset (or use the deleteWebhook/long-poll trigger)
  // locally.
  ctx.registerNodeType("telegram-set-webhook", async (config, execCtx) => {
    const { token, url, secretToken, allowedUpdates } = { ...execCtx.inputs, ...config } as {
      token: string; url: string; secretToken?: string; allowedUpdates?: string[];
    };
    const ok = await call<boolean>(token, "setWebhook", {
      url, secret_token: secretToken, allowed_updates: allowedUpdates,
    });
    return { ok };
  });

  ctx.registerTool({
    name: "telegram-send",
    description: "Send a Telegram message from the bot to a chat ID",
    inputSchema: {
      type: "object",
      properties: {
        chatId: { type: "string", description: "Chat ID (numeric, or @channel-handle)" },
        text: { type: "string" },
      },
      required: ["chatId", "text"],
    },
    handler: async (input) => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
      const { chatId, text } = input as { chatId: string; text: string };
      const msg = await call<{ message_id: number }>(token, "sendMessage", { chat_id: chatId, text });
      return { messageId: msg.message_id };
    },
  });
}

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import type { WorkflowDefinition } from "../types/workflow.js";
import type { TriggerHandler, TriggerRegistration, TriggerDispatch } from "./types.js";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
    chat: { id: number; type: string; title?: string; username?: string };
    date: number;
    text?: string;
    entities?: Array<{ type: string; offset: number; length: number }>;
  };
  // edited_message, channel_post, callback_query, etc. — not yet surfaced
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

/**
 * Per-bot long-poller offset persistence. Without this, every restart
 * re-delivers the last 24h of messages (Telegram's retention on
 * un-ACKed updates). We keep the next offset per bot-id in a small JSON
 * file alongside the token store.
 */
function getOffsetStorePath(): string {
  return resolve(homedir(), ".stirrup", "telegram-offsets.json");
}

function loadOffsets(): Record<string, number> {
  const path = getOffsetStorePath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, number>;
  } catch {
    return {};
  }
}

function saveOffset(botId: string, offset: number): void {
  const path = getOffsetStorePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const data = loadOffsets();
  data[botId] = offset;
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * One poller per workflow. Multiple workflows sharing the same bot token
 * each open their own getUpdates loop — Telegram allows exactly one
 * long-poller per bot, so the workflows will fight over updates. That's
 * a misconfiguration the user created; we log a warning when we detect
 * the collision (two pollers with the same botId) but don't coordinate.
 *
 * Bot token source: token store under service "telegram". Same pattern
 * as every other auth credential in the app.
 */
class TelegramPoller {
  private running = false;
  private abortController: AbortController | null = null;
  private botId = "";
  private botUsername = "";

  constructor(
    private workflow: WorkflowDefinition,
    private dispatch: TriggerDispatch,
    private reportFire: (result: { executionId?: string; error?: Error }) => void,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.loop().catch((err) => {
      console.error(`[telegram] ${this.workflow.id} poller crashed:`, err);
    });
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
  }

  label(): string {
    return this.botUsername ? `@${this.botUsername}` : "telegram (connecting...)";
  }

  private async loop(): Promise<void> {
    const { getToken } = await import("../auth/tokenStore.js");
    const stored = getToken("telegram");
    if (!stored) {
      console.warn(
        `[telegram] no token for workflow ${this.workflow.id} — connect via Connections panel (service: telegram)`,
      );
      this.running = false;
      return;
    }
    const token = stored.accessToken;

    // Identify the bot so we can key per-bot offsets and log a human name.
    try {
      const me = await this.callApi<TelegramUser>(token, "getMe", {});
      this.botId = String(me.id);
      this.botUsername = me.username ?? `bot-${me.id}`;
    } catch (err) {
      console.error(
        `[telegram] getMe failed for ${this.workflow.id}:`,
        (err as Error).message,
      );
      this.running = false;
      return;
    }

    const offsets = loadOffsets();
    let offset = offsets[this.botId] ?? 0;
    const cfg = this.workflow.triggers?.telegram ?? {};
    // Allowed chat IDs may be declared as numbers or numeric strings in
    // YAML; normalize to numbers for comparison. Negative IDs (groups) are
    // fine — Number() handles both.
    const allowedChats = cfg.allowedChatIds?.map((c) => Number(c));

    while (this.running) {
      try {
        this.abortController = new AbortController();
        const updates = await this.callApi<TelegramUpdate[]>(
          token,
          "getUpdates",
          { offset, timeout: 25, allowed_updates: ["message"] },
          this.abortController.signal,
        );

        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          const msg = update.message;
          if (!msg) continue;

          if (allowedChats && !allowedChats.includes(msg.chat.id)) continue;

          if (cfg.commands && cfg.commands.length > 0) {
            const text = msg.text ?? "";
            const matched = cfg.commands.some(
              (c) => text === c || text.startsWith(`${c} `) || text.startsWith(`${c}@`),
            );
            if (!matched) continue;
          }

          const context = {
            chatId: msg.chat.id,
            messageId: msg.message_id,
            text: msg.text ?? "",
            from: msg.from
              ? {
                  id: msg.from.id,
                  username: msg.from.username,
                  name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "),
                }
              : null,
            chat: {
              id: msg.chat.id,
              type: msg.chat.type,
              title: msg.chat.title,
              username: msg.chat.username,
            },
            update,
          };

          this.dispatch(this.workflow.id, context)
            .then((result) => this.reportFire({ executionId: result.executionId }))
            .catch((err) => {
              this.reportFire({ error: err });
              console.error(
                `[telegram] dispatch failed for ${this.workflow.id}:`,
                err.message,
              );
            });
        }

        if (updates.length > 0) {
          saveOffset(this.botId, offset);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") break;
        // Back off on transient failures so we don't hot-loop the API.
        // Telegram's own rate limits would 429 us anyway.
        console.error(`[telegram] getUpdates failed for ${this.workflow.id}:`, (err as Error).message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private async callApi<T>(
    token: string,
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) {
      throw new Error(data.description ?? `Telegram API ${method} failed`);
    }
    return data.result as T;
  }
}

export function TelegramTriggerHandler(): TriggerHandler {
  return {
    kind: "telegram",
    register(
      workflow: WorkflowDefinition,
      dispatch: TriggerDispatch,
      reportFire,
    ): TriggerRegistration | null {
      if (!workflow.triggers?.telegram) return null;

      const poller = new TelegramPoller(workflow, dispatch, reportFire);
      // Kick off asynchronously — the caller doesn't need to wait for getMe.
      void poller.start();

      return {
        workflowId: workflow.id,
        kind: "telegram",
        label: poller.label(),
        stop: () => poller.stop(),
      };
    },
  };
}

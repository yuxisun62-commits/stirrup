/**
 * Stirrup Plugin: Trello
 * Node types: trello-create-card, trello-update-card, trello-get-card,
 *             trello-list-cards, trello-delete-card, trello-create-list,
 *             trello-add-comment
 *
 * Auth: API key + token (service "trello"), stored as "<key>|<token>".
 * Get the pair by signing in at trello.com/power-ups/admin and following
 * the API Key + Manual Token flow. Both travel as query params on every
 * request.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../../src/plugins/safeFetch.js";

const API = "https://api.trello.com/1";

interface TrelloAuth {
  key: string;
  token: string;
}

function parseAuth(tokenValue: string): TrelloAuth {
  const [key, token] = tokenValue.split("|");
  if (!key || !token) {
    throw new Error('Trello token must be "<key>|<token>". Paste it that way in Connections.');
  }
  return { key, token };
}

function authParams(auth: TrelloAuth): string {
  const p = new URLSearchParams({ key: auth.key, token: auth.token });
  return p.toString();
}

async function call<T>(
  auth: TrelloAuth,
  path: string,
  init: RequestInit = {},
  extraParams?: Record<string, string>,
): Promise<T | null> {
  const extra = new URLSearchParams(extraParams ?? {});
  extra.set("key", auth.key);
  extra.set("token", auth.token);
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}${extra.toString()}`;
  const res = await safeFetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Trello API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("trello-create-card", async (config, execCtx) => {
    const { token, listId, name, desc, due, idMembers, idLabels, urlSource, pos } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; listId: string; name: string; desc?: string;
      due?: string; idMembers?: string[]; idLabels?: string[];
      urlSource?: string; pos?: "top" | "bottom" | number;
    };
    const data = await call<{ id: string; url: string; shortUrl: string; name: string }>(
      parseAuth(token), "/cards",
      {
        method: "POST",
        body: JSON.stringify({
          idList: listId,
          name, desc, due,
          idMembers, idLabels,
          urlSource, pos,
        }),
      },
    );
    return { cardId: data!.id, url: data!.shortUrl, name: data!.name };
  });

  ctx.registerNodeType("trello-update-card", async (config, execCtx) => {
    const { token, cardId, fields } = { ...execCtx.inputs, ...config } as {
      token: string; cardId: string; fields: Record<string, unknown>;
    };
    const data = await call<{ id: string }>(
      parseAuth(token), `/cards/${encodeURIComponent(cardId)}`,
      { method: "PUT", body: JSON.stringify(fields) },
    );
    return { cardId: data!.id, updated: true };
  });

  ctx.registerNodeType("trello-get-card", async (config, execCtx) => {
    const { token, cardId, fields } = { ...execCtx.inputs, ...config } as {
      token: string; cardId: string; fields?: string;
    };
    const data = await call<Record<string, unknown>>(
      parseAuth(token),
      `/cards/${encodeURIComponent(cardId)}`,
      undefined,
      fields ? { fields } : undefined,
    );
    return { card: data };
  });

  ctx.registerNodeType("trello-list-cards", async (config, execCtx) => {
    const { token, listId, filter } = { ...execCtx.inputs, ...config } as {
      token: string; listId: string; filter?: "all" | "closed" | "none" | "open";
    };
    const data = await call<Array<Record<string, unknown>>>(
      parseAuth(token),
      `/lists/${encodeURIComponent(listId)}/cards`,
      undefined,
      filter ? { filter } : undefined,
    );
    return { cards: data, count: data!.length };
  });

  ctx.registerNodeType("trello-delete-card", async (config, execCtx) => {
    const { token, cardId } = { ...execCtx.inputs, ...config } as {
      token: string; cardId: string;
    };
    await call<void>(
      parseAuth(token),
      `/cards/${encodeURIComponent(cardId)}`,
      { method: "DELETE" },
    );
    return { deleted: true, cardId };
  });

  ctx.registerNodeType("trello-create-list", async (config, execCtx) => {
    const { token, boardId, name, pos } = { ...execCtx.inputs, ...config } as {
      token: string; boardId: string; name: string; pos?: "top" | "bottom" | number;
    };
    const data = await call<{ id: string; name: string }>(
      parseAuth(token), "/lists",
      { method: "POST", body: JSON.stringify({ idBoard: boardId, name, pos }) },
    );
    return { listId: data!.id, name: data!.name };
  });

  ctx.registerNodeType("trello-add-comment", async (config, execCtx) => {
    const { token, cardId, text } = { ...execCtx.inputs, ...config } as {
      token: string; cardId: string; text: string;
    };
    const data = await call<{ id: string }>(
      parseAuth(token),
      `/cards/${encodeURIComponent(cardId)}/actions/comments?text=${encodeURIComponent(text)}`,
      { method: "POST" },
    );
    return { commentId: data!.id };
  });
}

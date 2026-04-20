/**
 * Stirrup Plugin: Notion
 * Node types: notion-create-page, notion-update-page, notion-query-database,
 *             notion-get-page, notion-append-block, notion-search
 *
 * Auth: Internal Integration token (service: "notion"). Create one at
 * notion.so/my-integrations, then share the target page/database with
 * the integration from Notion's UI. The SDK would be friendlier but
 * the REST API keeps the dependency footprint at zero.
 *
 * Notion API version pinned in the header — their API evolves and
 * unversioned calls can break silently.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../../src/plugins/safeFetch.js";

const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * Convert a flat title string into Notion's rich_text array shape.
 * Most simple "create a page with a title" calls don't need formatting;
 * the user can always pass raw rich_text via `titleRichText` to override.
 */
function titleToRichText(title: string): Array<Record<string, unknown>> {
  return [{ type: "text", text: { content: title } }];
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("notion-create-page", async (config, execCtx) => {
    const { token, parentDatabaseId, parentPageId, title, titleProperty, properties, children } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string;
      parentDatabaseId?: string;
      parentPageId?: string;
      title?: string;
      titleProperty?: string;
      properties?: Record<string, unknown>;
      children?: Array<Record<string, unknown>>;
    };
    if (!parentDatabaseId && !parentPageId) {
      throw new Error("notion-create-page requires parentDatabaseId or parentPageId");
    }

    const parent = parentDatabaseId
      ? { database_id: parentDatabaseId }
      : { page_id: parentPageId };

    // Notion pages in a DB need a title property whose name matches the
    // DB's title column. Default to "Name" — the most common convention.
    const finalProperties: Record<string, unknown> = { ...(properties ?? {}) };
    if (title && !finalProperties[titleProperty ?? "Name"]) {
      finalProperties[titleProperty ?? "Name"] = { title: titleToRichText(title) };
    }

    const data = await call<{ id: string; url: string }>(
      token,
      "/pages",
      {
        method: "POST",
        body: JSON.stringify({ parent, properties: finalProperties, children }),
      },
    );
    return { pageId: data.id, url: data.url };
  });

  ctx.registerNodeType("notion-update-page", async (config, execCtx) => {
    const { token, pageId, properties, archived } = { ...execCtx.inputs, ...config } as {
      token: string; pageId: string;
      properties?: Record<string, unknown>; archived?: boolean;
    };
    const data = await call<{ id: string }>(
      token,
      `/pages/${encodeURIComponent(pageId)}`,
      { method: "PATCH", body: JSON.stringify({ properties, archived }) },
    );
    return { pageId: data.id, updated: true };
  });

  ctx.registerNodeType("notion-get-page", async (config, execCtx) => {
    const { token, pageId } = { ...execCtx.inputs, ...config } as {
      token: string; pageId: string;
    };
    const page = await call<Record<string, unknown>>(
      token,
      `/pages/${encodeURIComponent(pageId)}`,
    );
    return { page };
  });

  ctx.registerNodeType("notion-query-database", async (config, execCtx) => {
    const { token, databaseId, filter, sorts, pageSize, startCursor } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; databaseId: string;
      filter?: Record<string, unknown>; sorts?: Array<Record<string, unknown>>;
      pageSize?: number; startCursor?: string;
    };
    const data = await call<{
      results: Array<Record<string, unknown>>;
      has_more: boolean;
      next_cursor: string | null;
    }>(
      token,
      `/databases/${encodeURIComponent(databaseId)}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter, sorts,
          page_size: pageSize ?? 100,
          start_cursor: startCursor,
        }),
      },
    );
    return {
      pages: data.results,
      hasMore: data.has_more,
      nextCursor: data.next_cursor,
      count: data.results.length,
    };
  });

  ctx.registerNodeType("notion-append-block", async (config, execCtx) => {
    const { token, blockId, children } = { ...execCtx.inputs, ...config } as {
      token: string; blockId: string; children: Array<Record<string, unknown>>;
    };
    const data = await call<{ results: Array<Record<string, unknown>> }>(
      token,
      `/blocks/${encodeURIComponent(blockId)}/children`,
      { method: "PATCH", body: JSON.stringify({ children }) },
    );
    return { blocks: data.results, count: data.results.length };
  });

  ctx.registerNodeType("notion-search", async (config, execCtx) => {
    const { token, query, filterObject, sort, pageSize } = { ...execCtx.inputs, ...config } as {
      token: string; query?: string; filterObject?: Record<string, unknown>;
      sort?: Record<string, unknown>; pageSize?: number;
    };
    const data = await call<{ results: Array<Record<string, unknown>>; has_more: boolean }>(
      token,
      "/search",
      {
        method: "POST",
        body: JSON.stringify({
          query, filter: filterObject, sort,
          page_size: pageSize ?? 20,
        }),
      },
    );
    return { results: data.results, hasMore: data.has_more };
  });
}

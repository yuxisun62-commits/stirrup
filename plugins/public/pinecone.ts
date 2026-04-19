/**
 * Stirrup Plugin: Pinecone (vector DB)
 * Node types: pinecone-upsert, pinecone-query, pinecone-fetch,
 *             pinecone-delete, pinecone-describe-index
 *
 * Pinecone's serverless tier uses per-index hostnames (e.g.
 * `<index-name>-<project-hash>.svc.<region>.pinecone.io`). The plugin
 * requires a per-node `indexHost` config field — typically stored as a
 * context variable on the workflow. API key comes from the token store
 * (service "pinecone") as a plain `pcsk_...` key.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

function apiHeaders(token: string): Record<string, string> {
  return {
    "Api-Key": token,
    "Content-Type": "application/json",
    "X-Pinecone-API-Version": "2024-10",
  };
}

async function call<T>(
  token: string,
  host: string,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const url = `https://${host.replace(/^https?:\/\//, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...apiHeaders(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Pinecone API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("pinecone-upsert", async (config, execCtx) => {
    const { token, indexHost, vectors, namespace } = { ...execCtx.inputs, ...config } as {
      token: string; indexHost: string;
      vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>;
      namespace?: string;
    };
    const data = await call<{ upsertedCount: number }>(
      token, indexHost, "/vectors/upsert",
      { method: "POST", body: JSON.stringify({ vectors, namespace: namespace ?? "" }) },
    );
    return { upserted: data!.upsertedCount, count: vectors.length };
  });

  ctx.registerNodeType("pinecone-query", async (config, execCtx) => {
    const { token, indexHost, vector, topK, includeMetadata, includeValues, filter, namespace } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; indexHost: string;
      vector: number[]; topK?: number;
      includeMetadata?: boolean; includeValues?: boolean;
      filter?: Record<string, unknown>; namespace?: string;
    };
    const data = await call<{
      matches: Array<{
        id: string; score: number;
        values?: number[]; metadata?: Record<string, unknown>;
      }>;
      namespace: string;
    }>(
      token, indexHost, "/query",
      {
        method: "POST",
        body: JSON.stringify({
          vector,
          topK: topK ?? 10,
          includeMetadata: includeMetadata ?? true,
          includeValues: includeValues ?? false,
          filter,
          namespace: namespace ?? "",
        }),
      },
    );
    return { matches: data!.matches, namespace: data!.namespace, count: data!.matches.length };
  });

  ctx.registerNodeType("pinecone-fetch", async (config, execCtx) => {
    const { token, indexHost, ids, namespace } = { ...execCtx.inputs, ...config } as {
      token: string; indexHost: string; ids: string[]; namespace?: string;
    };
    const params = new URLSearchParams();
    for (const id of ids) params.append("ids", id);
    if (namespace) params.set("namespace", namespace);
    const data = await call<{ vectors: Record<string, { id: string; values: number[]; metadata?: Record<string, unknown> }> }>(
      token, indexHost, `/vectors/fetch?${params.toString()}`,
    );
    return {
      vectors: Object.values(data!.vectors),
      count: Object.keys(data!.vectors).length,
    };
  });

  ctx.registerNodeType("pinecone-delete", async (config, execCtx) => {
    const { token, indexHost, ids, deleteAll, filter, namespace } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; indexHost: string;
      ids?: string[]; deleteAll?: boolean;
      filter?: Record<string, unknown>; namespace?: string;
    };
    if (!ids && !deleteAll && !filter) {
      throw new Error("pinecone-delete needs one of: ids, deleteAll, filter");
    }
    await call<void>(
      token, indexHost, "/vectors/delete",
      {
        method: "POST",
        body: JSON.stringify({
          ids, deleteAll, filter,
          namespace: namespace ?? "",
        }),
      },
    );
    return { deleted: true };
  });

  // Index metadata — useful at workflow start to check dimension /
  // metric so an upsert doesn't fail on a mismatched vector shape.
  ctx.registerNodeType("pinecone-describe-index", async (config, execCtx) => {
    const { token, indexHost } = { ...execCtx.inputs, ...config } as {
      token: string; indexHost: string;
    };
    const data = await call<{ dimension: number; indexFullness: number; totalVectorCount: number; namespaces?: Record<string, unknown> }>(
      token, indexHost, "/describe_index_stats",
      { method: "POST", body: "{}" },
    );
    return data!;
  });
}

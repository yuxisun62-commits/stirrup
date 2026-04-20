/**
 * Stirrup Plugin: Supabase
 * Node types: supabase-select, supabase-insert, supabase-update,
 *             supabase-upsert, supabase-delete, supabase-rpc,
 *             supabase-auth-signup, supabase-auth-signin
 *
 * Supabase exposes PostgREST for the database and GoTrue for auth,
 * both under the same project URL. We talk to them directly over
 * fetch so no peer dep is needed.
 *
 * Auth: service_role key or anon key, plus project URL. Stored as
 * "<projectUrl>|<apiKey>" under service "supabase" — split at runtime.
 * Per-node `projectUrl` and `apiKey` config fields also work if
 * the user prefers per-workflow creds.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../../src/plugins/safeFetch.js";

interface SupabaseAuth {
  projectUrl: string;
  apiKey: string;
}

function resolveAuth(
  config: Record<string, unknown>,
  execCtx: { inputs: Record<string, unknown> },
): SupabaseAuth {
  const token = (config.token ?? execCtx.inputs.token) as string | undefined;
  const configProjectUrl = (config.projectUrl ?? execCtx.inputs.projectUrl) as string | undefined;
  const configApiKey = (config.apiKey ?? execCtx.inputs.apiKey) as string | undefined;

  if (configProjectUrl && configApiKey) {
    return { projectUrl: configProjectUrl, apiKey: configApiKey };
  }
  if (token && token.includes("|")) {
    const [projectUrl, apiKey] = token.split("|");
    return { projectUrl, apiKey };
  }
  throw new Error(
    "supabase plugin needs projectUrl + apiKey (or combined '<url>|<key>' token)",
  );
}

function restHeaders(apiKey: string): Record<string, string> {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function postgrest<T>(
  auth: SupabaseAuth,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${auth.projectUrl.replace(/\/$/, "")}/rest/v1${path}`;
  const res = await safeFetch(url, {
    ...init,
    headers: { ...restHeaders(auth.apiKey), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Supabase PostgREST ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : []) as T;
}

/**
 * Build a PostgREST filter string from a plain object. Keys use the
 * column name + operator in PostgREST's "column=op.value" form. We
 * default to `eq` for simple scalar equality; richer filters pass the
 * operator string directly, e.g. `{age: "gte.21"}`.
 */
function buildFilters(filters: Record<string, unknown> | undefined): URLSearchParams {
  const params = new URLSearchParams();
  if (!filters) return params;
  for (const [key, value] of Object.entries(filters)) {
    const asString = String(value ?? "");
    if (/^[a-z]+\./.test(asString)) {
      params.append(key, asString); // already prefixed with operator
    } else {
      params.append(key, `eq.${asString}`);
    }
  }
  return params;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("supabase-select", async (config, execCtx) => {
    const auth = resolveAuth(config, execCtx);
    const { table, filters, select, limit, order } = { ...execCtx.inputs, ...config } as {
      table: string; filters?: Record<string, unknown>; select?: string;
      limit?: number; order?: string;
    };
    const params = buildFilters(filters);
    params.set("select", select ?? "*");
    if (limit) params.set("limit", String(limit));
    if (order) params.set("order", order);
    const rows = await postgrest<Array<Record<string, unknown>>>(
      auth, `/${encodeURIComponent(table)}?${params.toString()}`,
    );
    return { rows, count: rows.length };
  });

  ctx.registerNodeType("supabase-insert", async (config, execCtx) => {
    const auth = resolveAuth(config, execCtx);
    const { table, records, returning } = { ...execCtx.inputs, ...config } as {
      table: string;
      records: Record<string, unknown> | Array<Record<string, unknown>>;
      returning?: "minimal" | "representation";
    };
    const rows = await postgrest<Array<Record<string, unknown>>>(
      auth,
      `/${encodeURIComponent(table)}`,
      {
        method: "POST",
        body: JSON.stringify(records),
        headers: { Prefer: `return=${returning ?? "representation"}` },
      },
    );
    return {
      rows,
      inserted: Array.isArray(rows) ? rows.length : rows ? 1 : 0,
    };
  });

  ctx.registerNodeType("supabase-update", async (config, execCtx) => {
    const auth = resolveAuth(config, execCtx);
    const { table, filters, updates } = { ...execCtx.inputs, ...config } as {
      table: string; filters: Record<string, unknown>; updates: Record<string, unknown>;
    };
    const params = buildFilters(filters);
    const rows = await postgrest<Array<Record<string, unknown>>>(
      auth,
      `/${encodeURIComponent(table)}?${params.toString()}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
        headers: { Prefer: "return=representation" },
      },
    );
    return { rows, updated: rows.length };
  });

  ctx.registerNodeType("supabase-upsert", async (config, execCtx) => {
    const auth = resolveAuth(config, execCtx);
    const { table, records, onConflict } = { ...execCtx.inputs, ...config } as {
      table: string;
      records: Record<string, unknown> | Array<Record<string, unknown>>;
      onConflict?: string;
    };
    const params = new URLSearchParams();
    if (onConflict) params.set("on_conflict", onConflict);
    const rows = await postgrest<Array<Record<string, unknown>>>(
      auth,
      `/${encodeURIComponent(table)}?${params.toString()}`,
      {
        method: "POST",
        body: JSON.stringify(records),
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
      },
    );
    return { rows, upserted: rows.length };
  });

  ctx.registerNodeType("supabase-delete", async (config, execCtx) => {
    const auth = resolveAuth(config, execCtx);
    const { table, filters } = { ...execCtx.inputs, ...config } as {
      table: string; filters: Record<string, unknown>;
    };
    const params = buildFilters(filters);
    if (params.toString() === "") {
      throw new Error("supabase-delete requires filters (refusing to delete whole table)");
    }
    const rows = await postgrest<Array<Record<string, unknown>>>(
      auth,
      `/${encodeURIComponent(table)}?${params.toString()}`,
      {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      },
    );
    return { rows, deleted: rows.length };
  });

  // Call a Postgres function (RPC). The function body runs in SQL,
  // respects row-level security, and returns whatever the function returns.
  ctx.registerNodeType("supabase-rpc", async (config, execCtx) => {
    const auth = resolveAuth(config, execCtx);
    const { functionName, args } = { ...execCtx.inputs, ...config } as {
      functionName: string; args?: Record<string, unknown>;
    };
    const result = await postgrest<unknown>(
      auth,
      `/rpc/${encodeURIComponent(functionName)}`,
      { method: "POST", body: JSON.stringify(args ?? {}) },
    );
    return { result };
  });

  ctx.registerNodeType("supabase-auth-signup", async (config, execCtx) => {
    const auth = resolveAuth(config, execCtx);
    const { email, password, data } = { ...execCtx.inputs, ...config } as {
      email: string; password: string; data?: Record<string, unknown>;
    };
    const res = await safeFetch(`${auth.projectUrl.replace(/\/$/, "")}/auth/v1/signup`, {
      method: "POST",
      headers: restHeaders(auth.apiKey),
      body: JSON.stringify({ email, password, data }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Supabase signup ${res.status}: ${body.msg ?? body.error_description}`);
    return {
      userId: (body.user as any)?.id ?? body.id,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
    };
  });

  ctx.registerNodeType("supabase-auth-signin", async (config, execCtx) => {
    const auth = resolveAuth(config, execCtx);
    const { email, password } = { ...execCtx.inputs, ...config } as {
      email: string; password: string;
    };
    const res = await safeFetch(
      `${auth.projectUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: restHeaders(auth.apiKey),
        body: JSON.stringify({ email, password }),
      },
    );
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Supabase signin ${res.status}: ${body.error_description ?? body.msg}`);
    return {
      userId: (body.user as any)?.id,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
    };
  });
}

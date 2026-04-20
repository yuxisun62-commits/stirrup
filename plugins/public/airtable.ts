/**
 * Stirrup Plugin: Airtable
 * Node types: airtable-list, airtable-get, airtable-create, airtable-update,
 *             airtable-delete, airtable-upsert
 *
 * Auth: Personal Access Token (service: "airtable"). Create at
 * airtable.com/create/tokens with the scopes you need: data.records:read,
 * data.records:write, schema.bases:read.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../../src/plugins/safeFetch.js";

const API = "https://api.airtable.com/v0";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Airtable API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function tableUrl(baseId: string, tableId: string): string {
  // Table names can contain spaces and unicode; always encode.
  return `/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}`;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("airtable-list", async (config, execCtx) => {
    const { token, baseId, tableId, view, filterByFormula, maxRecords, pageSize, offset, fields } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; baseId: string; tableId: string;
      view?: string; filterByFormula?: string;
      maxRecords?: number; pageSize?: number; offset?: string;
      fields?: string[];
    };
    const params = new URLSearchParams();
    if (view) params.set("view", view);
    if (filterByFormula) params.set("filterByFormula", filterByFormula);
    if (maxRecords) params.set("maxRecords", String(maxRecords));
    if (pageSize) params.set("pageSize", String(pageSize));
    if (offset) params.set("offset", offset);
    if (fields) for (const f of fields) params.append("fields[]", f);

    const data = await call<{
      records: Array<{ id: string; fields: Record<string, unknown>; createdTime: string }>;
      offset?: string;
    }>(token, `${tableUrl(baseId, tableId)}?${params.toString()}`);
    return {
      records: data.records,
      nextOffset: data.offset,
      count: data.records.length,
    };
  });

  ctx.registerNodeType("airtable-get", async (config, execCtx) => {
    const { token, baseId, tableId, recordId } = { ...execCtx.inputs, ...config } as {
      token: string; baseId: string; tableId: string; recordId: string;
    };
    const record = await call<{ id: string; fields: Record<string, unknown>; createdTime: string }>(
      token,
      `${tableUrl(baseId, tableId)}/${encodeURIComponent(recordId)}`,
    );
    return record;
  });

  ctx.registerNodeType("airtable-create", async (config, execCtx) => {
    const { token, baseId, tableId, records, typecast } = { ...execCtx.inputs, ...config } as {
      token: string; baseId: string; tableId: string;
      records: Array<Record<string, unknown>> | Record<string, unknown>;
      typecast?: boolean;
    };
    // Accept either a single record (as `fields`) or an array. Airtable
    // caps at 10 per request — we don't auto-batch; users with more
    // should loop upstream or use an iterate node.
    const list = Array.isArray(records)
      ? records.map((fields) => ({ fields }))
      : [{ fields: records }];
    if (list.length > 10) {
      throw new Error("Airtable create supports max 10 records per call; split upstream");
    }
    const data = await call<{ records: Array<{ id: string; fields: Record<string, unknown> }> }>(
      token,
      tableUrl(baseId, tableId),
      { method: "POST", body: JSON.stringify({ records: list, typecast }) },
    );
    return { records: data.records, count: data.records.length };
  });

  ctx.registerNodeType("airtable-update", async (config, execCtx) => {
    const { token, baseId, tableId, recordId, fields, typecast } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; baseId: string; tableId: string;
      recordId: string; fields: Record<string, unknown>; typecast?: boolean;
    };
    const record = await call<{ id: string; fields: Record<string, unknown> }>(
      token,
      `${tableUrl(baseId, tableId)}/${encodeURIComponent(recordId)}`,
      { method: "PATCH", body: JSON.stringify({ fields, typecast }) },
    );
    return record;
  });

  ctx.registerNodeType("airtable-delete", async (config, execCtx) => {
    const { token, baseId, tableId, recordId } = { ...execCtx.inputs, ...config } as {
      token: string; baseId: string; tableId: string; recordId: string;
    };
    const data = await call<{ deleted: boolean; id: string }>(
      token,
      `${tableUrl(baseId, tableId)}/${encodeURIComponent(recordId)}`,
      { method: "DELETE" },
    );
    return data;
  });

  // Airtable's "upsert" mode on bulk PATCH — uses `performUpsert.fieldsToMergeOn`
  // to match records by one or more fields. If nothing matches, creates.
  ctx.registerNodeType("airtable-upsert", async (config, execCtx) => {
    const { token, baseId, tableId, records, fieldsToMergeOn, typecast } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; baseId: string; tableId: string;
      records: Array<Record<string, unknown>>;
      fieldsToMergeOn: string[]; typecast?: boolean;
    };
    if (!fieldsToMergeOn || fieldsToMergeOn.length === 0) {
      throw new Error("airtable-upsert requires fieldsToMergeOn");
    }
    const data = await call<{
      records: Array<{ id: string; fields: Record<string, unknown> }>;
      createdRecords?: string[];
      updatedRecords?: string[];
    }>(
      token,
      tableUrl(baseId, tableId),
      {
        method: "PATCH",
        body: JSON.stringify({
          performUpsert: { fieldsToMergeOn },
          records: records.map((fields) => ({ fields })),
          typecast,
        }),
      },
    );
    return {
      records: data.records,
      created: data.createdRecords ?? [],
      updated: data.updatedRecords ?? [],
    };
  });
}

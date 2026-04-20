/**
 * Stirrup Plugin: Google Sheets
 * Node types: sheets-read, sheets-append, sheets-update, sheets-clear,
 *             sheets-create
 *
 * Auth: Google OAuth2 access token (service: "google" or "sheets"), with
 * scope https://www.googleapis.com/auth/spreadsheets.
 *
 * Range format: A1 notation, e.g. "Sheet1!A1:D10". All reads/writes
 * return the same `values: string[][]` shape Sheets itself uses — every
 * cell is a string. Use a downstream transform if you need typed values.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../../src/plugins/safeFetch.js";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("sheets-read", async (config, execCtx) => {
    const { token, spreadsheetId, range, valueRenderOption } = { ...execCtx.inputs, ...config } as {
      token: string; spreadsheetId: string; range: string;
      valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
    };
    const params = new URLSearchParams();
    if (valueRenderOption) params.set("valueRenderOption", valueRenderOption);
    const data = await call<{ range: string; values?: string[][] }>(
      token,
      `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${params.toString()}`,
    );
    return { range: data.range, values: data.values ?? [], rowCount: data.values?.length ?? 0 };
  });

  ctx.registerNodeType("sheets-append", async (config, execCtx) => {
    const { token, spreadsheetId, range, values, valueInputOption, insertDataOption } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; spreadsheetId: string; range: string; values: unknown[][];
      valueInputOption?: "USER_ENTERED" | "RAW";
      insertDataOption?: "INSERT_ROWS" | "OVERWRITE";
    };
    const params = new URLSearchParams({
      valueInputOption: valueInputOption ?? "USER_ENTERED",
      insertDataOption: insertDataOption ?? "INSERT_ROWS",
    });
    const data = await call<{
      updates: { updatedRange: string; updatedRows: number; updatedColumns: number };
    }>(
      token,
      `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?${params.toString()}`,
      { method: "POST", body: JSON.stringify({ values }) },
    );
    return {
      updatedRange: data.updates.updatedRange,
      updatedRows: data.updates.updatedRows,
      updatedColumns: data.updates.updatedColumns,
    };
  });

  ctx.registerNodeType("sheets-update", async (config, execCtx) => {
    const { token, spreadsheetId, range, values, valueInputOption } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; spreadsheetId: string; range: string; values: unknown[][];
      valueInputOption?: "USER_ENTERED" | "RAW";
    };
    const params = new URLSearchParams({ valueInputOption: valueInputOption ?? "USER_ENTERED" });
    const data = await call<{ updatedRange: string; updatedRows: number; updatedCells: number }>(
      token,
      `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${params.toString()}`,
      { method: "PUT", body: JSON.stringify({ values }) },
    );
    return {
      updatedRange: data.updatedRange,
      updatedRows: data.updatedRows,
      updatedCells: data.updatedCells,
    };
  });

  ctx.registerNodeType("sheets-clear", async (config, execCtx) => {
    const { token, spreadsheetId, range } = { ...execCtx.inputs, ...config } as {
      token: string; spreadsheetId: string; range: string;
    };
    await call<Record<string, unknown>>(
      token,
      `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
      { method: "POST", body: "{}" },
    );
    return { cleared: true, range };
  });

  ctx.registerNodeType("sheets-create", async (config, execCtx) => {
    const { token, title, sheetTitles } = { ...execCtx.inputs, ...config } as {
      token: string; title: string; sheetTitles?: string[];
    };
    const body: Record<string, unknown> = { properties: { title } };
    if (sheetTitles && sheetTitles.length > 0) {
      body.sheets = sheetTitles.map((t) => ({ properties: { title: t } }));
    }
    const data = await call<{ spreadsheetId: string; spreadsheetUrl: string }>(
      token,
      ``,
      { method: "POST", body: JSON.stringify(body) },
    );
    return { spreadsheetId: data.spreadsheetId, spreadsheetUrl: data.spreadsheetUrl };
  });
}

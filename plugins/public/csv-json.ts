/**
 * Stirrup Plugin: CSV/JSON Transform
 * Node types: csv-parse, csv-generate, json-transform, json-merge
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("csv-parse", async (config, execCtx) => {
    const { content, delimiter, hasHeaders, columns } = { ...execCtx.inputs, ...config } as {
      content: string; delimiter?: string; hasHeaders?: boolean; columns?: string[];
    };
    const sep = delimiter ?? ",";
    const lines = content.trim().split("\n").map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));

    const useHeaders = hasHeaders !== false;
    const headers = useHeaders ? (lines.shift() ?? columns ?? []) : (columns ?? lines[0]?.map((_, i) => `col${i}`) ?? []);

    const rows = lines.map((line) => {
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        const val = line[i] ?? "";
        row[h] = isNaN(Number(val)) || val === "" ? val : Number(val);
      });
      return row;
    });

    return { rows, headers, rowCount: rows.length };
  });

  ctx.registerNodeType("csv-generate", async (config, execCtx) => {
    const { rows, columns, delimiter, includeHeaders } = { ...execCtx.inputs, ...config } as {
      rows: Record<string, unknown>[]; columns?: string[]; delimiter?: string; includeHeaders?: boolean;
    };
    if (!rows?.length) return { csv: "", rowCount: 0 };

    const sep = delimiter ?? ",";
    const cols = columns ?? Object.keys(rows[0]);
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return s.includes(sep) || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines: string[] = [];
    if (includeHeaders !== false) lines.push(cols.map(escape).join(sep));
    for (const row of rows) {
      lines.push(cols.map((c) => escape(row[c])).join(sep));
    }

    return { csv: lines.join("\n"), rowCount: rows.length };
  });

  ctx.registerNodeType("json-transform", async (config, execCtx) => {
    const { data, operations } = { ...execCtx.inputs, ...config } as {
      data: unknown; operations: Array<{ op: string; field?: string; value?: unknown; fn?: string }>;
    };

    let result: unknown = JSON.parse(JSON.stringify(data));

    for (const op of operations ?? []) {
      const arr = Array.isArray(result) ? result : [result];
      switch (op.op) {
        case "filter":
          result = arr.filter((item: any) => item[op.field!] === op.value);
          break;
        case "sort":
          result = arr.sort((a: any, b: any) => a[op.field!] > b[op.field!] ? 1 : -1);
          break;
        case "pluck":
          result = arr.map((item: any) => item[op.field!]);
          break;
        case "group":
          result = arr.reduce((acc: any, item: any) => {
            const key = item[op.field!];
            (acc[key] = acc[key] ?? []).push(item);
            return acc;
          }, {});
          break;
        case "unique":
          result = [...new Set(arr.map((item: any) => op.field ? item[op.field] : item))];
          break;
        case "limit":
          result = arr.slice(0, op.value as number);
          break;
      }
    }

    return { result, count: Array.isArray(result) ? result.length : 1 };
  });

  ctx.registerNodeType("json-merge", async (config, execCtx) => {
    const { sources, strategy } = { ...execCtx.inputs, ...config } as {
      sources: Record<string, unknown>[]; strategy?: "shallow" | "deep" | "concat";
    };

    if (strategy === "concat" && sources.every(Array.isArray)) {
      return { result: (sources as unknown as unknown[][]).flat() };
    }

    let merged: Record<string, unknown> = {};
    for (const source of sources) {
      if (strategy === "deep") {
        merged = deepMerge(merged, source);
      } else {
        merged = { ...merged, ...source };
      }
    }
    return { result: merged };
  });
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object") {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

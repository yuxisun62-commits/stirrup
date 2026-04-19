/**
 * Make.com (Integromat) expression evaluator.
 *
 * Make's templating differs from n8n's — module references by integer id
 * (`{{1.email}}`), semicolon-separated function args (`{{substring(1.t; 0; 10)}}`),
 * `and`/`or`/`not` word operators, and helpers like `ifempty`, `formatDate`.
 * We rewrite each `{{ }}` body to valid JS and eval in a vm sandbox seeded
 * with the module-output map and helper functions.
 */

import { runInSandbox } from "../nodes/sandbox.js";

export interface MakeExpressionContext {
  modules: Record<string, unknown>;
  execution: { id: string };
}

interface TemplateSegment {
  kind: "literal" | "expression";
  value: string;
}

export function parseMakeTemplate(raw: string): {
  segments: TemplateSegment[];
  pureExpression: boolean;
} {
  const text = raw;
  const segments: TemplateSegment[] = [];
  let i = 0;
  let literalStart = 0;

  while (i < text.length) {
    if (text[i] === "{" && text[i + 1] === "{") {
      if (i > literalStart) {
        segments.push({ kind: "literal", value: text.slice(literalStart, i) });
      }
      let j = i + 2;
      let depth = 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{" && text[j + 1] === "{") {
          depth++;
          j += 2;
        } else if (text[j] === "}" && text[j + 1] === "}") {
          depth--;
          if (depth === 0) break;
          j += 2;
        } else {
          j++;
        }
      }
      if (depth !== 0) {
        segments.push({ kind: "literal", value: text.slice(i) });
        return { segments, pureExpression: false };
      }
      segments.push({ kind: "expression", value: text.slice(i + 2, j).trim() });
      i = j + 2;
      literalStart = i;
    } else {
      i++;
    }
  }
  if (literalStart < text.length) {
    segments.push({ kind: "literal", value: text.slice(literalStart) });
  }

  const pureExpression =
    segments.length === 1 && segments[0].kind === "expression";
  return { segments, pureExpression };
}

export function hasMakeExpressions(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.includes("{{") && value.includes("}}");
}

function rewriteToJs(expr: string): string {
  let s = expr;

  // Module references: `N.foo.bar` → `module[N].foo.bar`. Preserves the
  // character preceding the number (so we don't merge `foo.1.bar` into
  // a module ref accidentally — the leading dot would keep the `1` inside
  // a property access chain, not a standalone reference).
  s = s.replace(
    /(^|[^A-Za-z0-9_$.])(\d+)(\.[A-Za-z_$][A-Za-z0-9_$.\[\]]*)/g,
    (_, pre, num, path) => `${pre}module[${num}]${path}`,
  );

  // Semicolons are Make's arg separator; JS uses comma. Safe conversion
  // because a single expression context has no reason to contain `;`.
  s = s.replace(/;/g, ",");

  // Word operators → JS operators.
  s = s.replace(/\band\b/g, "&&");
  s = s.replace(/\bor\b/g, "||");
  s = s.replace(/\bnot\b/g, "!");
  s = s.replace(/\bemptystring\b/g, '""');
  s = s.replace(/\bempty\b/g, "null");

  // `if(...)` is a reserved-word collision — JS parses it as an `if`
  // statement, not a function call. Rewrite to a safe alias that the
  // sandbox exposes. Only rewrites the CALL form (`if(`) so plain
  // identifier occurrences (unlikely in Make expressions) are untouched.
  s = s.replace(/\bif\s*\(/g, "ifCond(");

  return s;
}

export function evaluateMakeTemplate(
  raw: string,
  context: MakeExpressionContext,
  onError?: (expr: string, err: Error) => void,
): unknown {
  if (!hasMakeExpressions(raw)) return raw;
  const { segments, pureExpression } = parseMakeTemplate(raw);

  if (pureExpression) {
    return evalOne(segments[0].value, context, onError);
  }

  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "literal") {
      parts.push(seg.value);
    } else {
      const v = evalOne(seg.value, context, onError);
      parts.push(v === null || v === undefined ? "" : String(v));
    }
  }
  return parts.join("");
}

function evalOne(
  expr: string,
  context: MakeExpressionContext,
  onError?: (expr: string, err: Error) => void,
): unknown {
  const js = rewriteToJs(expr);
  try {
    return runInSandbox(`(${js})`, buildSandbox(context), { timeout: 2000 });
  } catch (err) {
    onError?.(expr, err as Error);
    return "";
  }
}

function buildSandbox(context: MakeExpressionContext): Record<string, unknown> {
  return {
    module: context.modules,
    now: new Date(),
    timestamp: Date.now(),
    executionId: context.execution.id,

    lower: (s: unknown) => String(s ?? "").toLowerCase(),
    upper: (s: unknown) => String(s ?? "").toUpperCase(),
    trim: (s: unknown) => String(s ?? "").trim(),
    length: (v: unknown) =>
      Array.isArray(v) ? v.length : typeof v === "string" ? v.length : 0,
    substring: (s: unknown, start: number, end?: number) =>
      String(s ?? "").substring(start, end),
    replace: (s: unknown, find: string, repl: string) =>
      String(s ?? "").split(find).join(repl),
    concat: (...parts: unknown[]) => parts.map((p) => String(p ?? "")).join(""),
    contains: (s: unknown, needle: unknown) =>
      String(s ?? "").includes(String(needle ?? "")),
    startsWith: (s: unknown, needle: unknown) =>
      String(s ?? "").startsWith(String(needle ?? "")),
    endsWith: (s: unknown, needle: unknown) =>
      String(s ?? "").endsWith(String(needle ?? "")),
    split: (s: unknown, sep: unknown) => String(s ?? "").split(String(sep ?? "")),
    ifCond: (cond: unknown, a: unknown, b: unknown) => (cond ? a : b),
    ifempty: (v: unknown, fallback: unknown) =>
      v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) ? fallback : v,
    parseNumber: (s: unknown) => Number(s),
    parseBoolean: (s: unknown) =>
      String(s ?? "").toLowerCase() === "true" || s === 1 || s === true,
    formatDate: (d: unknown, _fmt?: string) => {
      const date = d instanceof Date ? d : new Date(d as string | number);
      return date.toISOString();
    },
    parseDate: (s: unknown) => new Date(s as string),
    first: (arr: unknown) => (Array.isArray(arr) ? arr[0] : undefined),
    last: (arr: unknown) => (Array.isArray(arr) ? arr[arr.length - 1] : undefined),
    get: (obj: unknown, path: string) => {
      let cur: unknown = obj;
      for (const part of String(path).split(".")) {
        if (cur == null) return undefined;
        cur = (cur as Record<string, unknown>)[part];
      }
      return cur;
    },
    max: (...xs: number[]) => Math.max(...xs),
    min: (...xs: number[]) => Math.min(...xs),
    sum: (...xs: number[]) => xs.reduce((a, b) => a + b, 0),
    round: (x: number) => Math.round(x),
    floor: (x: number) => Math.floor(x),
    ceil: (x: number) => Math.ceil(x),
  };
}

export function evaluateMakeConfig(
  config: unknown,
  context: MakeExpressionContext,
  onError?: (expr: string, err: Error) => void,
): unknown {
  if (typeof config === "string") {
    return evaluateMakeTemplate(config, context, onError);
  }
  if (Array.isArray(config)) {
    return config.map((item) => evaluateMakeConfig(item, context, onError));
  }
  if (config && typeof config === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      out[k] = evaluateMakeConfig(v, context, onError);
    }
    return out;
  }
  return config;
}

/**
 * Scan a value for every `{{N.field}}` reference and return the set of
 * distinct numeric module ids. The importer uses this to emit
 * `__makeModule_<id>` input mappings so upstream outputs resolve to the
 * right shape at eval time.
 */
export function collectMakeModuleReferences(config: unknown): number[] {
  const found = new Set<number>();
  const scan = (val: unknown): void => {
    if (typeof val === "string" && hasMakeExpressions(val)) {
      const re = /\{\{([^}]*)\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(val)) !== null) {
        const inner = m[1];
        const refs = inner.matchAll(/(^|[^A-Za-z0-9_$.])(\d+)(?=\.)/g);
        for (const id of refs) {
          found.add(Number(id[2]));
        }
      }
    } else if (Array.isArray(val)) {
      val.forEach(scan);
    } else if (val && typeof val === "object") {
      Object.values(val).forEach(scan);
    }
  };
  scan(config);
  return [...found].sort((a, b) => a - b);
}

export function configHasMakeExpressions(config: unknown): boolean {
  if (typeof config === "string") return hasMakeExpressions(config);
  if (Array.isArray(config)) return config.some(configHasMakeExpressions);
  if (config && typeof config === "object") {
    return Object.values(config).some(configHasMakeExpressions);
  }
  return false;
}

export function evaluateMakeRawJs(
  expression: string,
  context: MakeExpressionContext,
): unknown {
  return runInSandbox(`(${rewriteToJs(expression)})`, buildSandbox(context), { timeout: 2000 });
}

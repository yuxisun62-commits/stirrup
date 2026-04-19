/**
 * Make.com filter / router condition translator.
 *
 * Make's filter shape has OR-of-AND semantics: outer array is conditions,
 * each inner array is an AND-group of individual rows. Operators come as
 * `<type>:<op>` (e.g. text:equal, number:greater) or bare words.
 */

import { collectMakeModuleReferences, hasMakeExpressions } from "./makeExpression.js";

export interface CompiledMakeCondition {
  expression: string;
  referencedModules: number[];
  warnings: string[];
}

export function compileMakeCondition(filter: unknown): CompiledMakeCondition {
  const warnings: string[] = [];
  const refs = new Set<number>();
  const f = (filter ?? {}) as { conditions?: unknown[] };
  const groups = Array.isArray(f.conditions) ? f.conditions : [];
  if (groups.length === 0) {
    return { expression: "true", referencedModules: [], warnings: [] };
  }

  const orParts: string[] = [];
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) continue;
    const andParts: string[] = [];
    for (const row of group) {
      const r = row as { a?: unknown; o?: string; b?: unknown };
      const left = formatSide(r.a, refs);
      const right = formatSide(r.b, refs);
      andParts.push(renderOp(String(r.o ?? "text:equal"), left, right, warnings));
    }
    if (andParts.length > 0) {
      orParts.push(andParts.length === 1 ? andParts[0] : `(${andParts.join(" && ")})`);
    }
  }

  const expression = orParts.length === 0 ? "true" : orParts.join(" || ");
  return {
    expression,
    referencedModules: [...refs].sort((a, b) => a - b),
    warnings,
  };
}

function formatSide(value: unknown, refs: Set<number>): string {
  if (value === undefined || value === null) return '""';
  if (typeof value !== "string") return JSON.stringify(value);
  if (!hasMakeExpressions(value)) return JSON.stringify(value);

  for (const id of collectMakeModuleReferences({ _: value })) refs.add(id);

  const pure = /^\s*\{\{([\s\S]+?)\}\}\s*$/.exec(value);
  if (pure) return `(${rewriteInline(pure[1])})`;

  const parts: string[] = [];
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf("{{", i);
    if (start === -1) {
      parts.push(`\`${escapeBacktick(value.slice(i))}\``);
      break;
    }
    if (start > i) parts.push(`\`${escapeBacktick(value.slice(i, start))}\``);
    const end = value.indexOf("}}", start);
    if (end === -1) {
      parts.push(`\`${escapeBacktick(value.slice(start))}\``);
      break;
    }
    parts.push(`String(${rewriteInline(value.slice(start + 2, end))})`);
    i = end + 2;
  }
  return `(${parts.join(" + ")})`;
}

function rewriteInline(expr: string): string {
  let s = expr;
  s = s.replace(
    /(^|[^A-Za-z0-9_$.])(\d+)(\.[A-Za-z_$][A-Za-z0-9_$.\[\]]*)/g,
    (_, pre, num, path) => `${pre}module[${num}]${path}`,
  );
  s = s.replace(/;/g, ",");
  s = s.replace(/\band\b/g, "&&");
  s = s.replace(/\bor\b/g, "||");
  s = s.replace(/\bnot\b/g, "!");
  s = s.replace(/\bif\s*\(/g, "ifCond(");
  return s.trim();
}

function escapeBacktick(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function renderOp(op: string, left: string, right: string, warnings: string[]): string {
  const [typeRaw, nameRaw] = op.includes(":") ? op.split(":") : ["", op];
  const type = typeRaw.toLowerCase();
  const name = nameRaw.toLowerCase();

  switch (name) {
    case "equal":
    case "equals":
      return type === "number"
        ? `(Number(${left}) === Number(${right}))`
        : `(String(${left}) === String(${right}))`;
    case "notequal":
      return type === "number"
        ? `(Number(${left}) !== Number(${right}))`
        : `(String(${left}) !== String(${right}))`;
    case "greater":
      return `(Number(${left}) > Number(${right}))`;
    case "greaterorequal":
      return `(Number(${left}) >= Number(${right}))`;
    case "less":
      return `(Number(${left}) < Number(${right}))`;
    case "lessorequal":
      return `(Number(${left}) <= Number(${right}))`;
    case "contain":
    case "contains":
      return `(String(${left}).includes(String(${right})))`;
    case "notcontain":
    case "notcontains":
      return `(!String(${left}).includes(String(${right})))`;
    case "startwith":
    case "startswith":
      return `(String(${left}).startsWith(String(${right})))`;
    case "endwith":
    case "endswith":
      return `(String(${left}).endsWith(String(${right})))`;
    case "exist":
    case "exists":
      return `(${left} !== undefined && ${left} !== null)`;
    case "notexist":
    case "notexists":
      return `(${left} === undefined || ${left} === null)`;
    case "empty":
      return `(${left} === undefined || ${left} === null || ${left} === "" || (Array.isArray(${left}) && ${left}.length === 0))`;
    case "notempty":
      return `(!(${left} === undefined || ${left} === null || ${left} === "" || (Array.isArray(${left}) && ${left}.length === 0)))`;
    case "match":
      return `(new RegExp(String(${right})).test(String(${left})))`;
    case "notmatch":
      return `(!new RegExp(String(${right})).test(String(${left})))`;
    case "true":
      return `(Boolean(${left}) === true)`;
    case "false":
      return `(Boolean(${left}) === false)`;
  }

  warnings.push(`Unknown Make filter operator ${op}; defaulting to strict equality`);
  return `(${left} === ${right})`;
}

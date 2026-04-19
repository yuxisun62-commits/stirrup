/**
 * Translate n8n If / Filter / Switch condition structures into JS boolean
 * expressions that Stirrup's ConditionNode can evaluate.
 *
 * n8n has two parameter shapes in the wild: legacy (v1) keys conditions
 * by type (boolean/number/string/dateTime arrays); modern (v2+) uses a
 * unified conditions list with a nested `operator` object. We support both.
 */

import { collectNodeReferences, hasExpressions } from "./n8nExpression.js";

export interface CompiledCondition {
  expression: string;
  referencedNodes: string[];
  warnings: string[];
}

export function compileN8nCondition(parameters: unknown): CompiledCondition {
  const warnings: string[] = [];
  const p = (parameters ?? {}) as Record<string, unknown>;

  const modernRoot = p.conditions as { conditions?: unknown[]; combinator?: string } | undefined;
  if (
    modernRoot &&
    Array.isArray(modernRoot.conditions) &&
    modernRoot.conditions.length > 0 &&
    typeof (modernRoot.conditions[0] as Record<string, unknown>)?.operator === "object"
  ) {
    return compileModern(modernRoot as { conditions: unknown[]; combinator?: string }, warnings);
  }

  const legacyRoot = p.conditions as
    | { boolean?: unknown[]; number?: unknown[]; string?: unknown[]; dateTime?: unknown[] }
    | undefined;
  if (legacyRoot && typeof legacyRoot === "object") {
    return compileLegacy(legacyRoot, (p.combineOperation as string) ?? "all", warnings);
  }

  return {
    expression: "true",
    referencedNodes: [],
    warnings: ["No recognizable condition structure; defaulting to true"],
  };
}

function compileModern(
  root: { conditions: unknown[]; combinator?: string },
  warnings: string[],
): CompiledCondition {
  const parts: string[] = [];
  const nodeRefs = new Set<string>();

  for (const c of root.conditions) {
    const cond = c as {
      leftValue?: unknown;
      rightValue?: unknown;
      operator?: { type?: string; operation?: string };
    };
    const op = cond.operator?.operation ?? "equal";
    const type = cond.operator?.type ?? "string";
    const left = formatValue(cond.leftValue);
    const right = formatValue(cond.rightValue);
    trackRefs(cond.leftValue, nodeRefs);
    trackRefs(cond.rightValue, nodeRefs);
    parts.push(renderOperator(type, op, left, right, warnings));
  }

  const joiner = (root.combinator ?? "and").toLowerCase() === "or" ? " || " : " && ";
  return {
    expression: parts.length > 0 ? `(${parts.join(joiner)})` : "true",
    referencedNodes: [...nodeRefs],
    warnings,
  };
}

function compileLegacy(
  root: { boolean?: unknown[]; number?: unknown[]; string?: unknown[]; dateTime?: unknown[] },
  combineOp: string,
  warnings: string[],
): CompiledCondition {
  const parts: string[] = [];
  const nodeRefs = new Set<string>();

  for (const [type, arr] of Object.entries(root)) {
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      const cond = c as { value1?: unknown; value2?: unknown; operation?: string };
      const left = formatValue(cond.value1);
      const right = formatValue(cond.value2);
      trackRefs(cond.value1, nodeRefs);
      trackRefs(cond.value2, nodeRefs);
      parts.push(renderOperator(type, cond.operation ?? "equal", left, right, warnings));
    }
  }

  const joiner = combineOp === "any" ? " || " : " && ";
  return {
    expression: parts.length > 0 ? `(${parts.join(joiner)})` : "true",
    referencedNodes: [...nodeRefs],
    warnings,
  };
}

function renderOperator(
  type: string,
  op: string,
  left: string,
  right: string,
  warnings: string[],
): string {
  const t = type.toLowerCase();
  const o = op.toLowerCase();

  switch (o) {
    case "isempty":
      return `($isEmpty(${left}))`;
    case "isnotempty":
      return `($isNotEmpty(${left}))`;
    case "istrue":
      return `(${left} === true)`;
    case "isfalse":
      return `(${left} === false)`;
  }

  if (t === "string") {
    switch (o) {
      case "equals":
      case "equal":
        return `(String(${left}) === String(${right}))`;
      case "notequals":
      case "notequal":
        return `(String(${left}) !== String(${right}))`;
      case "contains":
        return `(String(${left}).includes(String(${right})))`;
      case "notcontains":
        return `(!String(${left}).includes(String(${right})))`;
      case "startswith":
        return `(String(${left}).startsWith(String(${right})))`;
      case "endswith":
        return `(String(${left}).endsWith(String(${right})))`;
      case "regex":
        return `(new RegExp(String(${right})).test(String(${left})))`;
      case "notregex":
        return `(!new RegExp(String(${right})).test(String(${left})))`;
    }
  }

  if (t === "number") {
    switch (o) {
      case "equal":
      case "equals":
        return `(Number(${left}) === Number(${right}))`;
      case "notequal":
      case "notequals":
        return `(Number(${left}) !== Number(${right}))`;
      case "smaller":
        return `(Number(${left}) < Number(${right}))`;
      case "smallerequal":
        return `(Number(${left}) <= Number(${right}))`;
      case "larger":
        return `(Number(${left}) > Number(${right}))`;
      case "largerequal":
        return `(Number(${left}) >= Number(${right}))`;
    }
  }

  if (t === "boolean") {
    switch (o) {
      case "equal":
      case "equals":
        return `(Boolean(${left}) === Boolean(${right}))`;
      case "notequal":
      case "notequals":
        return `(Boolean(${left}) !== Boolean(${right}))`;
      case "true":
        return `(Boolean(${left}) === true)`;
      case "false":
        return `(Boolean(${left}) === false)`;
    }
  }

  if (t === "datetime") {
    switch (o) {
      case "after":
        return `(new Date(${left}).getTime() > new Date(${right}).getTime())`;
      case "before":
        return `(new Date(${left}).getTime() < new Date(${right}).getTime())`;
      case "equal":
      case "equals":
        return `(new Date(${left}).getTime() === new Date(${right}).getTime())`;
    }
  }

  if (t === "array") {
    switch (o) {
      case "contains":
        return `(Array.isArray(${left}) && ${left}.includes(${right}))`;
      case "notcontains":
        return `(Array.isArray(${left}) && !${left}.includes(${right}))`;
      case "lengthequal":
      case "lengthequals":
        return `(Array.isArray(${left}) && ${left}.length === Number(${right}))`;
      case "lengthnotequal":
        return `(Array.isArray(${left}) && ${left}.length !== Number(${right}))`;
      case "lengthsmaller":
        return `(Array.isArray(${left}) && ${left}.length < Number(${right}))`;
      case "lengthlarger":
        return `(Array.isArray(${left}) && ${left}.length > Number(${right}))`;
    }
  }

  warnings.push(`Unknown operator ${type}.${op}; defaulting to strict equality`);
  return `(${left} === ${right})`;
}

/**
 * Render a value reference for embedding inside the compiled condition.
 * If it's a string carrying `{{ }}` expressions, convert to native JS that
 * references $json / $node / etc. directly (same names the n8n eval sandbox
 * exposes at runtime). Non-expression values become JSON literals.
 */
function formatValue(val: unknown): string {
  if (typeof val === "string" && hasExpressions(val)) {
    let body = val.startsWith("=") ? val.slice(1) : val;
    const pure = /^\s*\{\{([\s\S]+?)\}\}\s*$/.exec(body);
    if (pure) return `(${pure[1].trim()})`;
    const parts: string[] = [];
    let i = 0;
    while (i < body.length) {
      const start = body.indexOf("{{", i);
      if (start === -1) {
        parts.push(`\`${escapeBacktick(body.slice(i))}\``);
        break;
      }
      if (start > i) parts.push(`\`${escapeBacktick(body.slice(i, start))}\``);
      const end = body.indexOf("}}", start);
      if (end === -1) {
        parts.push(`\`${escapeBacktick(body.slice(start))}\``);
        break;
      }
      parts.push(`String(${body.slice(start + 2, end).trim()})`);
      i = end + 2;
    }
    return `(${parts.join(" + ")})`;
  }
  return JSON.stringify(val);
}

function escapeBacktick(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function trackRefs(val: unknown, refs: Set<string>): void {
  if (typeof val === "string") {
    collectNodeReferences({ _: val }).forEach((r) => refs.add(r));
  }
}

/**
 * Switch: compile the n8n rule list into a JS expression that returns the
 * branch name. `branch0`, `branch1`, ... for each matching rule (short-
 * circuit on first match), else `fallback`.
 */
export interface CompiledSwitch {
  expression: string;
  /** Names of branches referenced in order, plus "fallback" at the end */
  branches: string[];
  referencedNodes: string[];
  warnings: string[];
}

export function compileN8nSwitch(parameters: unknown): CompiledSwitch {
  const warnings: string[] = [];
  const p = (parameters ?? {}) as Record<string, unknown>;
  const dataType = String(p.dataType ?? "string");
  const leftRaw = p.value1;

  const rulesRoot = p.rules as { rules?: unknown[] } | undefined;
  const rules = Array.isArray(rulesRoot?.rules) ? (rulesRoot!.rules as unknown[]) : [];
  const nodeRefs = new Set<string>();

  const branches: string[] = [];
  const clauses: string[] = [];

  trackRefs(leftRaw, nodeRefs);
  const left = formatValue(leftRaw);

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i] as { value2?: unknown; operation?: string; output?: number };
    const right = formatValue(r.value2);
    trackRefs(r.value2, nodeRefs);
    const cond = renderOperator(dataType, r.operation ?? "equal", left, right, warnings);
    const name = `branch${typeof r.output === "number" ? r.output : i}`;
    branches.push(name);
    clauses.push(`if (${cond}) return ${JSON.stringify(name)};`);
  }
  branches.push("fallback");

  // We need a function body that returns a branch name. Wrap in an IIFE so
  // the overall expression evaluates cleanly inside the sandbox.
  const expression = `(function(){ ${clauses.join(" ")} return "fallback"; })()`;

  return {
    expression,
    branches,
    referencedNodes: [...nodeRefs],
    warnings,
  };
}

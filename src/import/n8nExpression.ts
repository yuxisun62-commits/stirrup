/**
 * n8n expression evaluator.
 *
 * n8n parameter values can embed `{{ <js> }}` templates. A leading `=`
 * on a string means "the entire value is one expression" and the result
 * keeps its native type; otherwise the string is a template — each
 * `{{ }}` is evaluated, coerced to string, and concatenated with the
 * surrounding literal text.
 *
 * Context exposed to expressions: $json, $node, $parameter, $workflow,
 * $execution, $now, $today, $if, $isEmpty, $isNotEmpty.
 */

import { runInSandbox } from "../nodes/sandbox.js";

export const SUPPORTED_GLOBALS = [
  "$json", "$node", "$parameter", "$workflow", "$execution",
  "$now", "$today", "$if", "$isEmpty", "$isNotEmpty",
] as const;

export interface ExpressionContext {
  json: unknown;
  nodeOutputs: Record<string, unknown>;
  parameter: Record<string, unknown>;
  workflow: { id: string; name: string };
  execution: { id: string };
}

interface TemplateSegment {
  kind: "literal" | "expression";
  value: string;
}

export function parseTemplate(raw: string): {
  segments: TemplateSegment[];
  pureExpression: boolean;
} {
  let text = raw;
  let pureExpression = false;
  if (text.startsWith("=")) {
    pureExpression = true;
    text = text.slice(1);
  }

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
        return { segments, pureExpression };
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
  return { segments, pureExpression };
}

export function hasExpressions(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.startsWith("=")) return true;
  return value.includes("{{") && value.includes("}}");
}

export function evaluateTemplate(
  raw: string,
  context: ExpressionContext,
  onError?: (expr: string, err: Error) => void,
): unknown {
  if (!hasExpressions(raw)) return raw;

  const { segments, pureExpression } = parseTemplate(raw);

  if (pureExpression && segments.length === 1 && segments[0].kind === "expression") {
    return evalSingleExpression(segments[0].value, context, onError);
  }

  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "literal") {
      parts.push(seg.value);
    } else {
      const value = evalSingleExpression(seg.value, context, onError);
      parts.push(value === undefined || value === null ? "" : String(value));
    }
  }
  return parts.join("");
}

function evalSingleExpression(
  expr: string,
  context: ExpressionContext,
  onError?: (expr: string, err: Error) => void,
): unknown {
  const sandbox = buildSandbox(context);
  try {
    return runInSandbox(`(${expr})`, sandbox, { timeout: 2000 });
  } catch (err) {
    onError?.(expr, err as Error);
    return "";
  }
}

function buildSandbox(context: ExpressionContext): Record<string, unknown> {
  const nodeAccessor: Record<string, { json: unknown }> = {};
  for (const [name, outputs] of Object.entries(context.nodeOutputs)) {
    nodeAccessor[name] = { json: outputs };
  }

  const isEmpty = (v: unknown) =>
    v === null || v === undefined || v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && v !== null && Object.keys(v).length === 0);

  // IMPORTANT: do NOT expose the main-realm Object/Array/etc. here. The vm
  // context already has its own realm-intrinsic copies, and our sandbox
  // helper hardens Object.prototype inside the context. Passing main-realm
  // Object would leak that hardening into the parent process's Object.
  return {
    $json: context.json,
    $node: nodeAccessor,
    $parameter: context.parameter,
    $workflow: context.workflow,
    $execution: context.execution,
    $now: new Date(),
    $today: new Date(new Date().toDateString()),
    $if: (cond: unknown, a: unknown, b: unknown) => (cond ? a : b),
    $isEmpty: isEmpty,
    $isNotEmpty: (v: unknown) => !isEmpty(v),
  };
}

export function evaluateConfig(
  config: unknown,
  context: ExpressionContext,
  onError?: (expr: string, err: Error) => void,
): unknown {
  if (typeof config === "string") {
    return evaluateTemplate(config, context, onError);
  }
  if (Array.isArray(config)) {
    return config.map((item) => evaluateConfig(item, context, onError));
  }
  if (config && typeof config === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      out[k] = evaluateConfig(v, context, onError);
    }
    return out;
  }
  return config;
}

export function collectNodeReferences(config: unknown): string[] {
  const found = new Set<string>();
  const scan = (val: unknown): void => {
    if (typeof val === "string" && hasExpressions(val)) {
      const re = /\$node\s*\[\s*["']([^"']+)["']\s*\]/g;
      let m;
      while ((m = re.exec(val)) !== null) {
        found.add(m[1]);
      }
    } else if (Array.isArray(val)) {
      val.forEach(scan);
    } else if (val && typeof val === "object") {
      Object.values(val).forEach(scan);
    }
  };
  scan(config);
  return [...found];
}

export function configHasExpressions(config: unknown): boolean {
  if (typeof config === "string") return hasExpressions(config);
  if (Array.isArray(config)) return config.some(configHasExpressions);
  if (config && typeof config === "object") {
    return Object.values(config).some(configHasExpressions);
  }
  return false;
}

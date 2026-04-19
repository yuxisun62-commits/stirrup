import { describe, it, expect } from "vitest";
import {
  compileN8nCondition,
  compileN8nSwitch,
} from "../../src/import/n8nConditions.js";
import { evaluateRawJs } from "../../src/import/n8nExpression.js";

const emptyContext = {
  json: {},
  nodeOutputs: {},
  parameter: {},
  workflow: { id: "", name: "" },
  execution: { id: "" },
};

function evalCompiled(expression: string, json: unknown, nodeOutputs: Record<string, unknown> = {}): unknown {
  return evaluateRawJs(expression, { ...emptyContext, json, nodeOutputs });
}

describe("compileN8nCondition — legacy (v1) format", () => {
  it("compiles a single number condition", () => {
    const { expression } = compileN8nCondition({
      conditions: {
        number: [
          { value1: "={{ $json.count }}", value2: 10, operation: "larger" },
        ],
      },
      combineOperation: "all",
    });
    expect(evalCompiled(expression, { count: 20 })).toBe(true);
    expect(evalCompiled(expression, { count: 5 })).toBe(false);
  });

  it("combines multiple conditions with AND (all)", () => {
    const { expression } = compileN8nCondition({
      conditions: {
        string: [{ value1: "={{ $json.status }}", value2: "ok", operation: "equal" }],
        number: [{ value1: "={{ $json.count }}", value2: 5, operation: "smaller" }],
      },
      combineOperation: "all",
    });
    expect(evalCompiled(expression, { status: "ok", count: 3 })).toBe(true);
    expect(evalCompiled(expression, { status: "ok", count: 10 })).toBe(false);
    expect(evalCompiled(expression, { status: "bad", count: 3 })).toBe(false);
  });

  it("combines with OR (any)", () => {
    const { expression } = compileN8nCondition({
      conditions: {
        string: [{ value1: "={{ $json.tag }}", value2: "a", operation: "equal" }],
        number: [{ value1: "={{ $json.n }}", value2: 100, operation: "larger" }],
      },
      combineOperation: "any",
    });
    expect(evalCompiled(expression, { tag: "a", n: 1 })).toBe(true);
    expect(evalCompiled(expression, { tag: "x", n: 200 })).toBe(true);
    expect(evalCompiled(expression, { tag: "x", n: 1 })).toBe(false);
  });

  it("supports string operators (contains, startsWith, regex)", () => {
    const contains = compileN8nCondition({
      conditions: {
        string: [{ value1: "={{ $json.s }}", value2: "bc", operation: "contains" }],
      },
    }).expression;
    expect(evalCompiled(contains, { s: "abcdef" })).toBe(true);

    const starts = compileN8nCondition({
      conditions: {
        string: [{ value1: "={{ $json.s }}", value2: "hello", operation: "startsWith" }],
      },
    }).expression;
    expect(evalCompiled(starts, { s: "hello world" })).toBe(true);

    const rx = compileN8nCondition({
      conditions: {
        string: [{ value1: "={{ $json.email }}", value2: "^\\w+@\\w+\\.", operation: "regex" }],
      },
    }).expression;
    expect(evalCompiled(rx, { email: "a@b.com" })).toBe(true);
    expect(evalCompiled(rx, { email: "nope" })).toBe(false);
  });
});

describe("compileN8nCondition — modern (v2) format", () => {
  it("compiles unified condition entries with operator.type/operation", () => {
    const { expression } = compileN8nCondition({
      conditions: {
        conditions: [
          {
            leftValue: "={{ $json.role }}",
            rightValue: "admin",
            operator: { type: "string", operation: "equals" },
          },
          {
            leftValue: "={{ $json.active }}",
            rightValue: true,
            operator: { type: "boolean", operation: "equal" },
          },
        ],
        combinator: "and",
      },
    });
    expect(evalCompiled(expression, { role: "admin", active: true })).toBe(true);
    expect(evalCompiled(expression, { role: "user", active: true })).toBe(false);
  });

  it("supports unary isEmpty / isNotEmpty", () => {
    const { expression } = compileN8nCondition({
      conditions: {
        conditions: [
          {
            leftValue: "={{ $json.tags }}",
            operator: { type: "array", operation: "isEmpty" },
          },
        ],
      },
    });
    expect(evalCompiled(expression, { tags: [] })).toBe(true);
    expect(evalCompiled(expression, { tags: ["a"] })).toBe(false);
  });
});

describe("compileN8nSwitch", () => {
  it("returns branchN of the first matching rule", () => {
    const { expression, branches } = compileN8nSwitch({
      dataType: "string",
      value1: "={{ $json.type }}",
      rules: {
        rules: [
          { value2: "alpha", operation: "equal", output: 0 },
          { value2: "beta", operation: "equal", output: 1 },
        ],
      },
    });
    expect(branches).toEqual(["branch0", "branch1", "fallback"]);
    expect(evalCompiled(expression, { type: "alpha" })).toBe("branch0");
    expect(evalCompiled(expression, { type: "beta" })).toBe("branch1");
    expect(evalCompiled(expression, { type: "gamma" })).toBe("fallback");
  });

  it("falls back to first-match ordering when output indexes absent", () => {
    const { expression, branches } = compileN8nSwitch({
      dataType: "string",
      value1: "={{ $json.x }}",
      rules: {
        rules: [
          { value2: "foo", operation: "contains" },
          { value2: "bar", operation: "contains" },
        ],
      },
    });
    expect(branches).toEqual(["branch0", "branch1", "fallback"]);
    expect(evalCompiled(expression, { x: "some foo thing" })).toBe("branch0");
    expect(evalCompiled(expression, { x: "bar only" })).toBe("branch1");
  });
});

import { describe, it, expect } from "vitest";
import { compileMakeCondition } from "../../src/import/makeConditions.js";
import { evaluateMakeRawJs } from "../../src/import/makeExpression.js";

function evalCompiled(expression: string, modules: Record<string, unknown>): unknown {
  return evaluateMakeRawJs(expression, { modules, execution: { id: "e" } });
}

describe("compileMakeCondition", () => {
  it("single text:equal row compiles to a working check", () => {
    const { expression, referencedModules } = compileMakeCondition({
      conditions: [[{ a: "{{1.status}}", o: "text:equal", b: "active" }]],
    });
    expect(referencedModules).toEqual([1]);
    expect(evalCompiled(expression, { 1: { status: "active" } })).toBe(true);
    expect(evalCompiled(expression, { 1: { status: "paused" } })).toBe(false);
  });

  it("AND within a group, OR across groups", () => {
    const { expression } = compileMakeCondition({
      conditions: [
        [
          { a: "{{1.status}}", o: "text:equal", b: "active" },
          { a: "{{1.count}}", o: "number:greater", b: 5 },
        ],
        [{ a: "{{1.admin}}", o: "text:equal", b: "yes" }],
      ],
    });
    // (status=active AND count>5) OR (admin=yes)
    expect(evalCompiled(expression, { 1: { status: "active", count: 10, admin: "no" } })).toBe(true);
    expect(evalCompiled(expression, { 1: { status: "paused", count: 10, admin: "yes" } })).toBe(true);
    expect(evalCompiled(expression, { 1: { status: "paused", count: 10, admin: "no" } })).toBe(false);
  });

  it("number + regex + notempty operators", () => {
    const num = compileMakeCondition({
      conditions: [[{ a: "{{1.count}}", o: "number:less", b: "10" }]],
    }).expression;
    expect(evalCompiled(num, { 1: { count: 5 } })).toBe(true);

    const rx = compileMakeCondition({
      conditions: [[{ a: "{{1.text}}", o: "text:match", b: "^hello" }]],
    }).expression;
    expect(evalCompiled(rx, { 1: { text: "hello world" } })).toBe(true);
    expect(evalCompiled(rx, { 1: { text: "goodbye" } })).toBe(false);

    const ne = compileMakeCondition({
      conditions: [[{ a: "{{1.list}}", o: "array:notempty" }]],
    }).expression;
    expect(evalCompiled(ne, { 1: { list: [1] } })).toBe(true);
    expect(evalCompiled(ne, { 1: { list: [] } })).toBe(false);
  });

  it("unary exists / notexists operators", () => {
    const ex = compileMakeCondition({
      conditions: [[{ a: "{{1.maybe}}", o: "exists" }]],
    }).expression;
    expect(evalCompiled(ex, { 1: { maybe: "hi" } })).toBe(true);
    expect(evalCompiled(ex, { 1: {} })).toBe(false);
  });

  it("empty conditions default to true", () => {
    const { expression } = compileMakeCondition({});
    expect(expression).toBe("true");
  });

  it("unknown operator warns and falls back to strict equality", () => {
    const { expression, warnings } = compileMakeCondition({
      conditions: [[{ a: "{{1.x}}", o: "something:exotic", b: "y" }]],
    });
    expect(warnings[0]).toMatch(/something:exotic/);
    // eval should still produce a boolean
    expect(typeof evalCompiled(expression, { 1: { x: "y" } })).toBe("boolean");
  });
});

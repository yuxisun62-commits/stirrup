import { describe, it, expect } from "vitest";
import { ContextManager, getByPath, setByPath } from "../../src/engine/ContextManager.js";

describe("getByPath", () => {
  it("gets a top-level value", () => {
    expect(getByPath({ foo: "bar" }, "foo")).toBe("bar");
  });

  it("gets a nested value", () => {
    expect(getByPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("returns undefined for missing path", () => {
    expect(getByPath({ a: 1 }, "b")).toBeUndefined();
  });

  it("returns undefined for null intermediate", () => {
    expect(getByPath({ a: null }, "a.b")).toBeUndefined();
  });
});

describe("setByPath", () => {
  it("sets a top-level value", () => {
    const obj: Record<string, unknown> = {};
    setByPath(obj, "foo", "bar");
    expect(obj.foo).toBe("bar");
  });

  it("sets a nested value creating intermediaries", () => {
    const obj: Record<string, unknown> = {};
    setByPath(obj, "a.b.c", 42);
    expect((obj.a as any).b.c).toBe(42);
  });
});

describe("ContextManager", () => {
  it("resolves inputs from context", () => {
    const cm = new ContextManager({ greeting: "hello" }, {});
    const inputs = cm.resolveInputs([{ from: "context.greeting", to: "msg" }]);
    expect(inputs.msg).toBe("hello");
  });

  it("resolves inputs from completed node outputs", () => {
    const steps = {
      "node-1": {
        nodeId: "node-1",
        status: "completed" as const,
        outputs: { result: "data" },
        startedAt: "",
        attempts: 1,
      },
    };
    const cm = new ContextManager({}, steps);
    const inputs = cm.resolveInputs([
      { from: "nodes.node-1.outputs.result", to: "data" },
    ]);
    expect(inputs.data).toBe("data");
  });

  it("returns undefined for non-completed node outputs", () => {
    const steps = {
      "node-1": {
        nodeId: "node-1",
        status: "running" as const,
        outputs: { result: "data" },
        startedAt: "",
        attempts: 0,
      },
    };
    const cm = new ContextManager({}, steps);
    const inputs = cm.resolveInputs([
      { from: "nodes.node-1.outputs.result", to: "data" },
    ]);
    expect(inputs.data).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { createIterateHandler } from "../../src/nodes/IterateNode.js";
import { NodeRegistry } from "../../src/nodes/NodeRegistry.js";
import { transformHandler } from "../../src/nodes/TransformNode.js";
import type { NodeExecutionContext } from "../../src/types/execution.js";

function makeCtx(inputs: Record<string, unknown>): NodeExecutionContext {
  return {
    inputs,
    context: {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };
}

describe("IterateNode", () => {
  it("runs a child handler once per item in parallel", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", transformHandler);
    const iterate = createIterateHandler(registry);

    const result = await iterate(
      {
        childType: "transform",
        childConfig: { expression: "({ doubled: inputs.item * 2 })" },
      },
      makeCtx({ items: [1, 2, 3, 4, 5] }),
    );

    expect((result as any).count).toBe(5);
    expect((result as any).successCount).toBe(5);
    expect((result as any).failureCount).toBe(0);
    expect((result as any).results).toEqual([
      { doubled: 2 },
      { doubled: 4 },
      { doubled: 6 },
      { doubled: 8 },
      { doubled: 10 },
    ]);
  });

  it("passes index to each iteration", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", transformHandler);
    const iterate = createIterateHandler(registry);

    const result = await iterate(
      {
        childType: "transform",
        childConfig: { expression: "({ idx: inputs.index, val: inputs.item })" },
      },
      makeCtx({ items: ["a", "b", "c"] }),
    );

    expect((result as any).results).toEqual([
      { idx: 0, val: "a" },
      { idx: 1, val: "b" },
      { idx: 2, val: "c" },
    ]);
  });

  it("in sequential mode, each iteration sees priorResults", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", transformHandler);
    const iterate = createIterateHandler(registry);

    const result = await iterate(
      {
        childType: "transform",
        mode: "sequential",
        childConfig: {
          expression: "({ priorCount: (inputs.priorResults || []).length, item: inputs.item })",
        },
      },
      makeCtx({ items: ["x", "y", "z"] }),
    );

    const results = (result as any).results;
    expect(results[0].priorCount).toBe(0);
    expect(results[1].priorCount).toBe(1);
    expect(results[2].priorCount).toBe(2);
  });

  it("continues past iteration failures when continueOnIterationError is true (default)", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", transformHandler);
    const iterate = createIterateHandler(registry);

    const result = await iterate(
      {
        childType: "transform",
        // Throws when item === 2
        childConfig: {
          expression: "inputs.item === 2 ? (() => { throw new Error('bad item') })() : ({ ok: inputs.item })",
        },
      },
      makeCtx({ items: [1, 2, 3] }),
    );

    expect((result as any).count).toBe(3);
    expect((result as any).successCount).toBe(2);
    expect((result as any).failureCount).toBe(1);
    const results = (result as any).results;
    expect(results[0]).toEqual({ ok: 1 });
    expect(results[1].error).toContain("bad item");
    expect(results[2]).toEqual({ ok: 3 });
  });

  it("throws on first iteration failure when continueOnIterationError is false", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", transformHandler);
    const iterate = createIterateHandler(registry);

    await expect(
      iterate(
        {
          childType: "transform",
          continueOnIterationError: false,
          mode: "sequential",
          childConfig: {
            expression: "(() => { throw new Error('bang') })()",
          },
        },
        makeCtx({ items: [1, 2, 3] }),
      ),
    ).rejects.toThrow(/iteration 0 failed.*bang/);
  });

  it("rejects non-array items input", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", transformHandler);
    const iterate = createIterateHandler(registry);

    await expect(
      iterate(
        { childType: "transform", childConfig: {} },
        makeCtx({ items: "not an array" }),
      ),
    ).rejects.toThrow(/must be an array/);
  });

  it("rejects unknown childType", async () => {
    const registry = new NodeRegistry();
    const iterate = createIterateHandler(registry);

    await expect(
      iterate(
        { childType: "nonexistent", childConfig: {} },
        makeCtx({ items: [1] }),
      ),
    ).rejects.toThrow(/not a registered node type/);
  });
});

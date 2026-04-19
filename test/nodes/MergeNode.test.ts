import { describe, it, expect } from "vitest";
import { mergeHandler } from "../../src/nodes/MergeNode.js";
import type { NodeExecutionContext } from "../../src/types/execution.js";

function ctx(inputs: Record<string, unknown>): NodeExecutionContext {
  return {
    inputs,
    context: {},
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

describe("MergeNode", () => {
  it("append mode concatenates every source", async () => {
    const result = await mergeHandler(
      { mode: "append" },
      ctx({
        __n8nMerge_0: [{ a: 1 }, { a: 2 }],
        __n8nMerge_1: [{ b: 1 }],
      }),
    );
    expect(result.count).toBe(3);
    expect(result.items).toEqual([{ a: 1 }, { a: 2 }, { b: 1 }]);
  });

  it("combine mode pairwise merges — shortest source wins", async () => {
    const result = await mergeHandler(
      { mode: "combine" },
      ctx({
        __n8nMerge_0: [{ name: "a" }, { name: "b" }, { name: "c" }],
        __n8nMerge_1: [{ age: 10 }, { age: 20 }],
      }),
    );
    expect(result.items).toEqual([
      { name: "a", age: 10 },
      { name: "b", age: 20 },
    ]);
  });

  it("mergeByKey joins on a shared field, left outer", async () => {
    const result = await mergeHandler(
      { mode: "mergeByKey", mergeByKey: "id" },
      ctx({
        __n8nMerge_0: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
        __n8nMerge_1: [{ id: 1, email: "a@x.com" }],
      }),
    );
    expect(result.items).toEqual([
      { id: 1, name: "Alice", email: "a@x.com" },
      { id: 2, name: "Bob" },
    ]);
  });

  it("multiplex produces cartesian product", async () => {
    const result = await mergeHandler(
      { mode: "multiplex" },
      ctx({
        __n8nMerge_0: [{ a: 1 }, { a: 2 }],
        __n8nMerge_1: [{ b: "x" }, { b: "y" }],
      }),
    );
    expect(result.count).toBe(4);
    expect(result.items).toEqual([
      { a: 1, b: "x" },
      { a: 1, b: "y" },
      { a: 2, b: "x" },
      { a: 2, b: "y" },
    ]);
  });

  it("chooseBranch returns the first non-empty source", async () => {
    const result = await mergeHandler(
      { mode: "chooseBranch" },
      ctx({
        __n8nMerge_0: [],
        __n8nMerge_1: [{ pick: "me" }],
        __n8nMerge_2: [{ pick: "not-me" }],
      }),
    );
    expect(result.items).toEqual([{ pick: "me" }]);
  });

  it("unwraps {items: [...]} wrappers from upstream per-item nodes", async () => {
    const result = await mergeHandler(
      { mode: "append" },
      ctx({
        __n8nMerge_0: { items: [{ x: 1 }, { x: 2 }], count: 2 },
        __n8nMerge_1: [{ y: 1 }],
      }),
    );
    expect(result.items).toEqual([{ x: 1 }, { x: 2 }, { y: 1 }]);
  });

  it("empty input map returns empty items", async () => {
    const result = await mergeHandler({ mode: "append" }, ctx({}));
    expect(result.items).toEqual([]);
    expect(result.count).toBe(0);
  });

  it("throws for mergeByKey without a key", async () => {
    await expect(
      mergeHandler({ mode: "mergeByKey" }, ctx({ __n8nMerge_0: [{ id: 1 }] })),
    ).rejects.toThrow(/mergeByKey/);
  });

  it("ignores inputs that aren't merge-shaped", async () => {
    const result = await mergeHandler(
      { mode: "append" },
      ctx({
        __n8nMerge_0: [{ a: 1 }],
        __n8nJson: { unrelated: true },
        somethingElse: [1, 2, 3],
      }),
    );
    expect(result.items).toEqual([{ a: 1 }]);
  });
});

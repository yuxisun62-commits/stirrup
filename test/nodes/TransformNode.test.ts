import { describe, it, expect } from "vitest";
import { transformHandler } from "../../src/nodes/TransformNode.js";

const noop = { info: () => {}, warn: () => {}, error: () => {} };

describe("TransformNode", () => {
  it("evaluates an expression with inputs", async () => {
    const result = await transformHandler(
      { expression: "({ sum: inputs.a + inputs.b })" },
      { inputs: { a: 3, b: 4 }, context: {}, logger: noop }
    );
    expect(result.sum).toBe(7);
  });

  it("accesses context values", async () => {
    const result = await transformHandler(
      { expression: "({ greeting: context.name + '!' })" },
      { inputs: {}, context: { name: "World" }, logger: noop }
    );
    expect(result.greeting).toBe("World!");
  });

  it("wraps non-object return in result", async () => {
    const result = await transformHandler(
      { expression: "42" },
      { inputs: {}, context: {}, logger: noop }
    );
    expect(result.result).toBe(42);
  });
});

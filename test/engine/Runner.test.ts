import { describe, it, expect } from "vitest";
import { Runner } from "../../src/engine/Runner.js";
import { NodeRegistry } from "../../src/nodes/NodeRegistry.js";
import type { WorkflowNode } from "../../src/types/workflow.js";
import type { NodeExecutionContext } from "../../src/types/execution.js";

const noop = { info: () => {}, warn: () => {}, error: () => {} };

describe("Runner", () => {
  it("executes a node successfully", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", async () => ({ result: 42 }));

    const runner = new Runner(registry);
    const node: WorkflowNode = {
      id: "test",
      type: "transform",
      name: "Test",
      inputs: [],
      outputs: ["result"],
      config: {},
    };

    const ctx: NodeExecutionContext = { inputs: {}, context: {}, logger: noop };
    const result = await runner.run(node, ctx);

    expect(result.status).toBe("completed");
    expect(result.outputs.result).toBe(42);
    expect(result.attempts).toBe(1);
  });

  it("retries on failure", async () => {
    const registry = new NodeRegistry();
    let callCount = 0;
    registry.register("transform", async () => {
      callCount++;
      if (callCount < 3) throw new Error("fail");
      return { result: "ok" };
    });

    const runner = new Runner(registry, {
      maxAttempts: 3,
      backoffMs: 10,
      backoffMultiplier: 1,
    });

    const node: WorkflowNode = {
      id: "test",
      type: "transform",
      name: "Test",
      inputs: [],
      outputs: ["result"],
      config: {},
    };

    const ctx: NodeExecutionContext = { inputs: {}, context: {}, logger: noop };
    const result = await runner.run(node, ctx);

    expect(result.status).toBe("completed");
    expect(result.attempts).toBe(3);
    expect(callCount).toBe(3);
  });

  it("fails after exhausting retries", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", async () => {
      throw new Error("always fails");
    });

    const runner = new Runner(registry, {
      maxAttempts: 2,
      backoffMs: 10,
      backoffMultiplier: 1,
    });

    const node: WorkflowNode = {
      id: "test",
      type: "transform",
      name: "Test",
      inputs: [],
      outputs: ["result"],
      config: {},
    };

    const ctx: NodeExecutionContext = { inputs: {}, context: {}, logger: noop };
    const result = await runner.run(node, ctx);

    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe("always fails");
  });
});

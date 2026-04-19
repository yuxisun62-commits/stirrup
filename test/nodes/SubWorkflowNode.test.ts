import { describe, it, expect } from "vitest";
import { WorkflowEngine } from "../../src/engine/Engine.js";
import { transformHandler } from "../../src/nodes/TransformNode.js";
import { makeSubWorkflowHandler } from "../../src/nodes/SubWorkflowNode.js";
import type { ExecutionState } from "../../src/types/execution.js";
import type { WorkflowDefinition } from "../../src/types/workflow.js";

class MemoryStore {
  private states = new Map<string, ExecutionState>();
  async save(s: ExecutionState) { this.states.set(s.executionId, s); }
  async load(id: string) { return this.states.get(id) ?? null; }
  async list() { return [...this.states.values()]; }
}

function makeEngine() {
  const engine = new WorkflowEngine({ stateStore: new MemoryStore() as any });
  engine.getRegistry().register("transform", transformHandler);
  engine.getRegistry().register("sub-workflow" as any, makeSubWorkflowHandler(engine));
  return engine;
}

describe("SubWorkflow node", () => {
  it("runs a child workflow and returns its final context + steps", async () => {
    const engine = makeEngine();

    // Child workflow: one transform that writes to context via its outputs.
    const child: WorkflowDefinition = {
      id: "child",
      name: "child",
      version: "1",
      params: [{ name: "multiplier", type: "number" }],
      nodes: [
        {
          id: "calc",
          type: "transform",
          name: "Calc",
          inputs: [{ from: "context.multiplier", to: "multiplier" }],
          outputs: ["doubled"],
          config: { expression: "({doubled: inputs.multiplier * 2})" },
        },
      ],
      edges: [],
    };
    engine.registerWorkflow(child);

    const parent: WorkflowDefinition = {
      id: "parent",
      name: "parent",
      version: "1",
      nodes: [
        {
          id: "call",
          type: "sub-workflow",
          name: "Call child",
          inputs: [],
          outputs: [],
          config: { workflowId: "child", inputs: { multiplier: 7 } },
        },
      ],
      edges: [],
    };
    engine.registerWorkflow(parent);

    const state = await engine.execute(parent.id, {});
    expect(state.status).toBe("completed");

    const call = state.steps.call.outputs as {
      executionId: string;
      status: string;
      context: Record<string, unknown>;
      steps: Record<string, unknown>;
    };
    expect(call.status).toBe("completed");
    expect(call.context.multiplier).toBe(7);
    expect((call.steps.calc as any).outputs.doubled).toBe(14);
  });

  it("throws on recursion past MAX_SUB_WORKFLOW_DEPTH", async () => {
    const engine = makeEngine();

    // Self-referential — parent calls itself, incrementing depth each time
    // until the guard fires. We don't actually recurse stack-infinitely.
    const recursive: WorkflowDefinition = {
      id: "recursive",
      name: "recursive",
      version: "1",
      nodes: [
        {
          id: "call",
          type: "sub-workflow",
          name: "Self",
          inputs: [],
          outputs: [],
          config: { workflowId: "recursive" },
        },
      ],
      edges: [],
    };
    engine.registerWorkflow(recursive);

    const state = await engine.execute(recursive.id, {});
    expect(state.status).toBe("failed");
    expect(state.steps.call.error?.message).toMatch(/depth exceeded|nesting/i);
  });

  it("propagates child-failure messages into the parent step", async () => {
    const engine = makeEngine();

    engine.getRegistry().register("fail", async (config) => {
      throw new Error((config as any).message ?? "failed");
    });
    // Update NodeType to include fail — but since we registered it the engine doesn't care

    const child: WorkflowDefinition = {
      id: "child-fail",
      name: "child-fail",
      version: "1",
      nodes: [
        {
          id: "boom",
          type: "fail" as any,
          name: "Boom",
          inputs: [],
          outputs: [],
          config: { message: "intentional" },
        },
      ],
      edges: [],
    };
    engine.registerWorkflow(child);

    const parent: WorkflowDefinition = {
      id: "parent-fail",
      name: "parent-fail",
      version: "1",
      nodes: [
        {
          id: "call",
          type: "sub-workflow",
          name: "Call child",
          inputs: [],
          outputs: [],
          config: { workflowId: "child-fail" },
        },
      ],
      edges: [],
    };
    engine.registerWorkflow(parent);

    const state = await engine.execute(parent.id, {});
    expect(state.status).toBe("failed");
    expect(state.steps.call.error?.message).toMatch(/child-fail.*intentional/i);
  });

  it("rejects missing workflowId", async () => {
    const engine = makeEngine();
    engine.registerWorkflow({
      id: "bad",
      name: "bad",
      version: "1",
      nodes: [
        {
          id: "call",
          type: "sub-workflow",
          name: "Call",
          inputs: [],
          outputs: [],
          config: {},
        },
      ],
      edges: [],
    });
    const state = await engine.execute("bad", {});
    expect(state.status).toBe("failed");
    expect(state.steps.call.error?.message).toMatch(/workflowId/i);
  });
});

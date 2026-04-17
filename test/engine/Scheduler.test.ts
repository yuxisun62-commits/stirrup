import { describe, it, expect } from "vitest";
import { Scheduler } from "../../src/engine/Scheduler.js";
import { Runner } from "../../src/engine/Runner.js";
import { NodeRegistry } from "../../src/nodes/NodeRegistry.js";
import { transformHandler } from "../../src/nodes/TransformNode.js";
import { conditionHandler } from "../../src/nodes/ConditionNode.js";
import type { WorkflowDefinition } from "../../src/types/workflow.js";
import type { ExecutionState } from "../../src/types/execution.js";
import type { EngineEvent } from "../../src/types/events.js";

function makeState(workflowId: string): ExecutionState {
  return {
    executionId: "test-exec",
    workflowId,
    status: "pending",
    context: {},
    steps: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeSchedulerOptions(registry: NodeRegistry) {
  const events: EngineEvent[] = [];
  const runner = new Runner(registry);
  return {
    runner,
    emit: (e: EngineEvent) => events.push(e),
    persist: async () => {},
    events,
  };
}

describe("Scheduler", () => {
  it("executes a linear workflow", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", transformHandler);

    const workflow: WorkflowDefinition = {
      id: "linear",
      name: "Linear",
      version: "1",
      nodes: [
        {
          id: "a",
          type: "transform",
          name: "A",
          inputs: [],
          outputs: ["value"],
          config: { expression: "({ value: 1 })" },
        },
        {
          id: "b",
          type: "transform",
          name: "B",
          inputs: [{ from: "nodes.a.outputs.value", to: "x" }],
          outputs: ["value"],
          config: { expression: "({ value: inputs.x + 1 })" },
        },
      ],
      edges: [{ from: "a", to: "b" }],
    };

    const opts = makeSchedulerOptions(registry);
    const scheduler = new Scheduler(workflow, makeState("linear"), opts);
    const result = await scheduler.execute();

    expect(result.status).toBe("completed");
    expect(result.steps["a"].outputs.value).toBe(1);
    expect(result.steps["b"].outputs.value).toBe(2);
  });

  it("executes parallel nodes", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", transformHandler);

    const workflow: WorkflowDefinition = {
      id: "parallel",
      name: "Parallel",
      version: "1",
      nodes: [
        {
          id: "start",
          type: "transform",
          name: "Start",
          inputs: [],
          outputs: ["v"],
          config: { expression: "({ v: 10 })" },
        },
        {
          id: "branch-a",
          type: "transform",
          name: "Branch A",
          inputs: [{ from: "nodes.start.outputs.v", to: "x" }],
          outputs: ["v"],
          config: { expression: "({ v: inputs.x * 2 })" },
        },
        {
          id: "branch-b",
          type: "transform",
          name: "Branch B",
          inputs: [{ from: "nodes.start.outputs.v", to: "x" }],
          outputs: ["v"],
          config: { expression: "({ v: inputs.x * 3 })" },
        },
        {
          id: "join",
          type: "transform",
          name: "Join",
          inputs: [
            { from: "nodes.branch-a.outputs.v", to: "a" },
            { from: "nodes.branch-b.outputs.v", to: "b" },
          ],
          outputs: ["sum"],
          config: { expression: "({ sum: inputs.a + inputs.b })" },
        },
      ],
      edges: [
        { from: "start", to: "branch-a" },
        { from: "start", to: "branch-b" },
        { from: "branch-a", to: "join" },
        { from: "branch-b", to: "join" },
      ],
    };

    const opts = makeSchedulerOptions(registry);
    const scheduler = new Scheduler(workflow, makeState("parallel"), opts);
    const result = await scheduler.execute();

    expect(result.status).toBe("completed");
    expect(result.steps["branch-a"].outputs.v).toBe(20);
    expect(result.steps["branch-b"].outputs.v).toBe(30);
    expect(result.steps["join"].outputs.sum).toBe(50);
  });

  it("handles conditional branching", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", transformHandler);
    registry.register("condition", conditionHandler);

    const workflow: WorkflowDefinition = {
      id: "branching",
      name: "Branching",
      version: "1",
      nodes: [
        {
          id: "start",
          type: "transform",
          name: "Start",
          inputs: [],
          outputs: ["value"],
          config: { expression: "({ value: 5 })" },
        },
        {
          id: "decide",
          type: "condition",
          name: "Decide",
          inputs: [{ from: "nodes.start.outputs.value", to: "v" }],
          outputs: ["selectedBranch"],
          config: { expression: "inputs.v > 3 ? 'high' : 'low'" },
          branches: { high: ["high-path"], low: ["low-path"] },
        },
        {
          id: "high-path",
          type: "transform",
          name: "High",
          inputs: [{ from: "nodes.start.outputs.value", to: "v" }],
          outputs: ["result"],
          config: { expression: "({ result: 'HIGH: ' + inputs.v })" },
        },
        {
          id: "low-path",
          type: "transform",
          name: "Low",
          inputs: [{ from: "nodes.start.outputs.value", to: "v" }],
          outputs: ["result"],
          config: { expression: "({ result: 'LOW: ' + inputs.v })" },
        },
      ],
      edges: [
        { from: "start", to: "decide" },
        { from: "decide", to: "high-path", condition: "high" },
        { from: "decide", to: "low-path", condition: "low" },
      ],
    };

    const opts = makeSchedulerOptions(registry);
    const scheduler = new Scheduler(workflow, makeState("branching"), opts);
    const result = await scheduler.execute();

    expect(result.status).toBe("completed");
    expect(result.steps["decide"].selectedBranch).toBe("high");
    expect(result.steps["high-path"].status).toBe("completed");
    expect(result.steps["high-path"].outputs.result).toBe("HIGH: 5");
    expect(result.steps["low-path"].status).toBe("skipped");
  });

  it("continueOnError: downstream still runs when a failed node allows it", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", transformHandler);

    const workflow: WorkflowDefinition = {
      id: "soft-fail",
      name: "Soft Fail",
      version: "1",
      nodes: [
        {
          id: "ok",
          type: "transform",
          name: "OK",
          inputs: [],
          outputs: ["v"],
          config: { expression: "({ v: 1 })" },
        },
        {
          id: "boom",
          type: "transform",
          name: "Boom",
          inputs: [],
          outputs: ["v"],
          config: { expression: "(() => { throw new Error('boom') })()" },
          continueOnError: true,
        },
        {
          id: "after",
          type: "transform",
          name: "After",
          inputs: [
            { from: "nodes.ok.outputs.v", to: "ok" },
          ],
          outputs: ["done"],
          config: { expression: "({ done: true })" },
        },
      ],
      edges: [
        { from: "ok", to: "after" },
        { from: "boom", to: "after" },
      ],
    };

    const opts = makeSchedulerOptions(registry);
    const scheduler = new Scheduler(workflow, makeState("soft-fail"), opts);
    const result = await scheduler.execute();

    // Workflow completes despite the boom failure
    expect(result.status).toBe("completed");
    expect(result.steps["ok"].status).toBe("completed");
    expect(result.steps["boom"].status).toBe("failed");
    expect(result.steps["boom"].error?.message).toContain("boom");
    // Downstream ran
    expect(result.steps["after"].status).toBe("completed");
    expect(result.steps["after"].outputs.done).toBe(true);
  });

  it("without continueOnError: a failure aborts the workflow", async () => {
    const registry = new NodeRegistry();
    registry.register("transform", transformHandler);

    const workflow: WorkflowDefinition = {
      id: "hard-fail",
      name: "Hard Fail",
      version: "1",
      nodes: [
        {
          id: "boom",
          type: "transform",
          name: "Boom",
          inputs: [],
          outputs: ["v"],
          config: { expression: "(() => { throw new Error('nope') })()" },
        },
        {
          id: "after",
          type: "transform",
          name: "After",
          inputs: [{ from: "nodes.boom.outputs.v", to: "v" }],
          outputs: ["done"],
          config: { expression: "({ done: true })" },
        },
      ],
      edges: [{ from: "boom", to: "after" }],
    };

    const opts = makeSchedulerOptions(registry);
    const scheduler = new Scheduler(workflow, makeState("hard-fail"), opts);
    const result = await scheduler.execute();

    expect(result.status).toBe("failed");
    expect(result.steps["boom"].status).toBe("failed");
    // Downstream should NOT have run
    expect(result.steps["after"]).toBeUndefined();
  });
});

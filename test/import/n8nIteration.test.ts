import { describe, it, expect } from "vitest";
import { WorkflowEngine } from "../../src/engine/Engine.js";
import { transformHandler } from "../../src/nodes/TransformNode.js";
import { conditionHandler } from "../../src/nodes/ConditionNode.js";
import type { ExecutionState } from "../../src/types/execution.js";
import type { WorkflowDefinition } from "../../src/types/workflow.js";

class MemoryStore {
  private states = new Map<string, ExecutionState>();
  async save(s: ExecutionState) { this.states.set(s.executionId, s); }
  async load(id: string) { return this.states.get(id) ?? null; }
  async list() { return [...this.states.values()]; }
}

/**
 * Shared test scaffolding: an engine with transform + condition + an echo
 * node type that mirrors its config as outputs. The echo node is how we
 * observe per-item config evaluation without stubbing HTTP or DB.
 */
function makeEngine() {
  const engine = new WorkflowEngine({ stateStore: new MemoryStore() as any });
  engine.getRegistry().register("transform", transformHandler);
  engine.getRegistry().register("condition", conditionHandler);
  engine.getRegistry().register("echo", async (config) => ({
    echoed: config as Record<string, unknown>,
  }));
  return engine;
}

describe("n8n per-item iteration", () => {
  it("array-shaped upstream triggers handler-per-item, collecting {items: [...]}", async () => {
    const engine = makeEngine();

    const workflow: WorkflowDefinition = {
      id: "wf-iter-array",
      name: "iter-array",
      version: "1",
      nodes: [
        {
          id: "src",
          type: "transform",
          name: "Src",
          inputs: [],
          outputs: ["users"],
          // Transform returns an array directly — iteration helper treats
          // the upstream `outputs` object as the iterable only when it's a
          // bare array; otherwise it looks for an `items` field. Using an
          // already-wrapped shape keeps downstream `__n8nJson` simple.
          config: {
            expression: "({items: [{name: 'alice', id: 1}, {name: 'bob', id: 2}]})",
          },
        },
        {
          id: "dst",
          // @ts-expect-error echo is a test-only type
          type: "echo",
          name: "Dst",
          inputs: [{ from: "nodes.src.outputs", to: "__n8nJson" }],
          outputs: [],
          config: {
            _n8nExpressions: true,
            _n8nPerItem: true,
            label: "user-{{ $json.id }}",
            name: "={{ $json.name }}",
          },
        },
      ],
      edges: [{ from: "src", to: "dst" }],
    };
    engine.registerWorkflow(workflow);

    const state = await engine.execute(workflow.id, {});
    expect(state.status).toBe("completed");

    const dstOutputs = state.steps.dst.outputs as { items: Array<Record<string, unknown>>; count: number };
    expect(dstOutputs.count).toBe(2);
    expect(dstOutputs.items).toHaveLength(2);

    // Each item was evaluated independently against its own $json
    const first = dstOutputs.items[0].echoed as Record<string, unknown>;
    const second = dstOutputs.items[1].echoed as Record<string, unknown>;
    expect(first.label).toBe("user-1");
    expect(first.name).toBe("alice");
    expect(second.label).toBe("user-2");
    expect(second.name).toBe("bob");
  });

  it("single-object upstream runs handler once, wrapped as {items: [...]}", async () => {
    const engine = makeEngine();

    const workflow: WorkflowDefinition = {
      id: "wf-iter-single",
      name: "iter-single",
      version: "1",
      nodes: [
        {
          id: "src",
          type: "transform",
          name: "Src",
          inputs: [],
          outputs: ["name"],
          config: { expression: "({name: 'solo', id: 42})" },
        },
        {
          id: "dst",
          // @ts-expect-error echo is a test-only type
          type: "echo",
          name: "Dst",
          inputs: [{ from: "nodes.src.outputs", to: "__n8nJson" }],
          outputs: [],
          config: {
            _n8nExpressions: true,
            _n8nPerItem: true,
            greeting: "hello {{ $json.name }}",
          },
        },
      ],
      edges: [{ from: "src", to: "dst" }],
    };
    engine.registerWorkflow(workflow);

    const state = await engine.execute(workflow.id, {});
    expect(state.status).toBe("completed");

    const dst = state.steps.dst.outputs as { items: Array<Record<string, unknown>>; count: number };
    expect(dst.count).toBe(1);
    const echoed = dst.items[0].echoed as Record<string, unknown>;
    expect(echoed.greeting).toBe("hello solo");
  });

  it("chained per-item nodes propagate the items shape", async () => {
    const engine = makeEngine();

    const workflow: WorkflowDefinition = {
      id: "wf-iter-chain",
      name: "iter-chain",
      version: "1",
      nodes: [
        {
          id: "src",
          type: "transform",
          name: "Src",
          inputs: [],
          outputs: [],
          config: { expression: "({items: [{n: 1}, {n: 2}, {n: 3}]})" },
        },
        {
          id: "doubler",
          // @ts-expect-error echo is test-only
          type: "echo",
          name: "Doubler",
          inputs: [{ from: "nodes.src.outputs", to: "__n8nJson" }],
          outputs: [],
          config: {
            _n8nExpressions: true,
            _n8nPerItem: true,
            doubled: "={{ $json.n * 2 }}",
          },
        },
        {
          id: "labeler",
          // @ts-expect-error echo is test-only
          type: "echo",
          name: "Labeler",
          inputs: [{ from: "nodes.doubler.outputs", to: "__n8nJson" }],
          outputs: [],
          config: {
            _n8nExpressions: true,
            _n8nPerItem: true,
            // Doubler's output shape: { items: [{echoed: {doubled: 2}}, ...], count: 3 }
            // So `$json` per item = { echoed: { doubled: N } }.
            label: "value-{{ $json.echoed.doubled }}",
          },
        },
      ],
      edges: [
        { from: "src", to: "doubler" },
        { from: "doubler", to: "labeler" },
      ],
    };
    engine.registerWorkflow(workflow);

    const state = await engine.execute(workflow.id, {});
    expect(state.status).toBe("completed");

    const labeler = state.steps.labeler.outputs as { items: Array<Record<string, unknown>>; count: number };
    expect(labeler.count).toBe(3);
    const labels = labeler.items.map((i) => (i.echoed as Record<string, unknown>).label);
    expect(labels).toEqual(["value-2", "value-4", "value-6"]);
  });

  it("per-item flag on a native workflow (no iteration source) is a no-op", async () => {
    // Sanity check: a node with _n8nPerItem but no __n8nJson input wrapping
    // falls back to a single call. `{items: [result]}` is the convention.
    const engine = makeEngine();

    const workflow: WorkflowDefinition = {
      id: "wf-noop",
      name: "noop",
      version: "1",
      nodes: [
        {
          id: "only",
          // @ts-expect-error echo
          type: "echo",
          name: "Only",
          inputs: [],
          outputs: [],
          config: { _n8nPerItem: true, hello: "world" },
        },
      ],
      edges: [],
    };
    engine.registerWorkflow(workflow);

    const state = await engine.execute(workflow.id, {});
    expect(state.status).toBe("completed");

    const only = state.steps.only.outputs as { items: Array<Record<string, unknown>>; count: number };
    expect(only.count).toBe(1);
    expect((only.items[0].echoed as Record<string, unknown>).hello).toBe("world");
  });

  it("condition nodes skip iteration even with array upstream", async () => {
    const engine = makeEngine();

    const workflow: WorkflowDefinition = {
      id: "wf-cond",
      name: "cond",
      version: "1",
      nodes: [
        {
          id: "src",
          type: "transform",
          name: "Src",
          inputs: [],
          outputs: [],
          config: { expression: "({items: [1, 2, 3]})" },
        },
        {
          id: "gate",
          type: "condition",
          name: "Gate",
          inputs: [{ from: "nodes.src.outputs", to: "__n8nJson" }],
          outputs: [],
          branches: { "true": [], "false": [] },
          config: {
            // Regular condition, no n8n flags — decides once using the
            // whole primary upstream. If we accidentally iterated, we'd
            // get 3 evaluations and bogus branch selection.
            expression: '"true"',
          },
        },
      ],
      edges: [{ from: "src", to: "gate" }],
    };
    engine.registerWorkflow(workflow);

    const state = await engine.execute(workflow.id, {});
    expect(state.status).toBe("completed");
    expect(state.steps.gate.selectedBranch).toBe("true");
    // Crucially the gate's outputs are NOT wrapped in {items: [...]}
    expect((state.steps.gate.outputs as Record<string, unknown>).items).toBeUndefined();
  });
});

describe("n8n importer sets _n8nPerItem correctly", () => {
  it("imports tag a non-trigger non-condition node with _n8nPerItem", async () => {
    const { importN8nWorkflow } = await import("../../src/import/n8n.js");
    const { workflow } = importN8nWorkflow({
      name: "flag",
      nodes: [
        {
          id: "h",
          name: "HTTP",
          type: "n8n-nodes-base.httpRequest",
          parameters: { url: "https://x", method: "GET" },
        },
      ],
    });
    const http = workflow.nodes[0];
    expect((http.config as Record<string, unknown>)._n8nPerItem).toBe(true);
  });

  it("does NOT tag condition nodes with _n8nPerItem", async () => {
    const { importN8nWorkflow } = await import("../../src/import/n8n.js");
    const { workflow } = importN8nWorkflow({
      name: "flag",
      nodes: [
        {
          id: "i",
          name: "If",
          type: "n8n-nodes-base.if",
          parameters: {
            conditions: { number: [{ value1: "={{ $json.n }}", value2: 0, operation: "larger" }] },
          },
        },
      ],
    });
    expect((workflow.nodes[0].config as Record<string, unknown>)._n8nPerItem).toBeUndefined();
    // But condition flag is set
    expect((workflow.nodes[0].config as Record<string, unknown>)._n8nCondition).toBe(true);
  });

  it("does NOT tag trigger-entry passthroughs", async () => {
    const { importN8nWorkflow } = await import("../../src/import/n8n.js");
    const { workflow } = importN8nWorkflow({
      name: "flag",
      nodes: [
        {
          id: "t",
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          parameters: { path: "hook", httpMethod: "POST" },
        },
      ],
    });
    // webhook becomes a passthrough with triggerKind metadata
    const t = workflow.nodes[0];
    expect(t.type).toBe("passthrough");
    expect((t.config as Record<string, unknown>)._n8nPerItem).toBeUndefined();
  });
});

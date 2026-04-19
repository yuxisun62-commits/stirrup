import { describe, it, expect } from "vitest";
import { importN8nWorkflow } from "../../src/import/n8n.js";
import { WorkflowEngine } from "../../src/engine/Engine.js";
import { transformHandler } from "../../src/nodes/TransformNode.js";
import type { ExecutionState } from "../../src/types/execution.js";
import type { WorkflowDefinition } from "../../src/types/workflow.js";

class MemoryStore {
  private states = new Map<string, ExecutionState>();
  async save(s: ExecutionState) { this.states.set(s.executionId, s); }
  async load(id: string) { return this.states.get(id) ?? null; }
  async list() { return [...this.states.values()]; }
}

describe("n8n import + runtime expression evaluation", () => {
  it("importer emits input mappings + _n8nExpressions flag for nodes with {{ }}", () => {
    const n8n = {
      name: "test",
      nodes: [
        { id: "src", name: "Src", type: "n8n-nodes-base.set", parameters: {} },
        {
          id: "dst",
          name: "Dst",
          type: "n8n-nodes-base.httpRequest",
          parameters: { url: "={{ $json.base }}/api", method: "GET" },
        },
      ],
      connections: { Src: { main: [[{ node: "Dst", type: "main", index: 0 }]] } },
    };
    const { workflow } = importN8nWorkflow(n8n, { workflowId: "wf-flag" });
    const dst = workflow.nodes.find((n) => n.id === "dst")!;
    expect((dst.config as Record<string, unknown>)._n8nExpressions).toBe(true);
    // Primary upstream → __n8nJson input mapping auto-added
    expect(dst.inputs.some((i) => i.to === "__n8nJson" && i.from === "nodes.src.outputs")).toBe(true);
  });

  it("Runner pre-evaluates expressions against upstream outputs at runtime", async () => {
    const engine = new WorkflowEngine({ stateStore: new MemoryStore() as any });
    engine.getRegistry().register("transform", transformHandler);

    // Custom "echo" node: returns its config back as outputs. The whole point
    // is to verify the Runner fed the handler an already-evaluated config.
    // Using a bespoke handler keeps the test independent of whatever the
    // real http/transform handlers do with their inputs.
    engine.getRegistry().register("echo", async (config) => ({
      echoed: config as Record<string, unknown>,
    }));

    const workflow: WorkflowDefinition = {
      id: "wf-eval",
      name: "eval",
      version: "1",
      nodes: [
        {
          id: "src",
          type: "transform",
          name: "Src",
          inputs: [],
          outputs: ["base", "count"],
          config: { expression: "({base: 'https://api.example', count: 7})" },
        },
        {
          id: "dst",
          // @ts-expect-error echo is a test-only node type
          type: "echo",
          name: "Dst",
          inputs: [{ from: "nodes.src.outputs", to: "__n8nJson" }],
          outputs: [],
          config: {
            _n8nExpressions: true,
            url: "={{ $json.base }}/users/{{ $json.count }}",
            doubled: "={{ $json.count * 2 }}",
            literal: "unchanged",
          },
        },
      ],
      edges: [{ from: "src", to: "dst" }],
    };
    engine.registerWorkflow(workflow);

    const state = await engine.execute(workflow.id, {});
    expect(state.status).toBe("completed");

    const echoed = state.steps.dst.outputs.echoed as Record<string, unknown>;
    expect(echoed.url).toBe("https://api.example/users/7");
    expect(echoed.doubled).toBe(14);
    expect(echoed.literal).toBe("unchanged");
    // Marker stripped before handler sees the config
    expect(echoed._n8nExpressions).toBeUndefined();
  });

  it("$node[\"X\"] resolves to outputs of the referenced node", async () => {
    const engine = new WorkflowEngine({ stateStore: new MemoryStore() as any });
    engine.getRegistry().register("transform", transformHandler);
    engine.getRegistry().register("echo", async (config) => ({
      echoed: config as Record<string, unknown>,
    }));

    const workflow: WorkflowDefinition = {
      id: "wf-node-ref",
      name: "noderef",
      version: "1",
      nodes: [
        {
          id: "lookup",
          type: "transform",
          name: "Lookup",
          inputs: [],
          outputs: ["token"],
          config: { expression: "({token: 'abc123'})" },
        },
        {
          id: "primary",
          type: "transform",
          name: "Primary",
          inputs: [],
          outputs: ["url"],
          config: { expression: "({url: 'https://api.ex'})" },
        },
        {
          id: "dst",
          // @ts-expect-error echo is a test-only node type
          type: "echo",
          name: "Dst",
          inputs: [
            { from: "nodes.primary.outputs", to: "__n8nJson" },
            { from: "nodes.lookup.outputs", to: "__n8nNode_lookup" },
          ],
          outputs: [],
          config: {
            _n8nExpressions: true,
            authorization: 'Bearer {{ $node["lookup"].json.token }}',
          },
        },
      ],
      edges: [
        { from: "primary", to: "dst" },
        { from: "lookup", to: "dst" },
      ],
    };
    engine.registerWorkflow(workflow);

    const state = await engine.execute(workflow.id, {});
    expect(state.status).toBe("completed");

    const echoed = state.steps.dst.outputs.echoed as Record<string, unknown>;
    expect(echoed.authorization).toBe("Bearer abc123");
  });
});

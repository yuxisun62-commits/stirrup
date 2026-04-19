import { describe, it, expect } from "vitest";
import { importN8nWorkflow } from "../../src/import/n8n.js";
import { WorkflowEngine } from "../../src/engine/Engine.js";
import { transformHandler } from "../../src/nodes/TransformNode.js";
import { conditionHandler } from "../../src/nodes/ConditionNode.js";
import { passthroughHandler } from "../../src/nodes/PassthroughNode.js";
import type { ExecutionState } from "../../src/types/execution.js";

class MemoryStore {
  private states = new Map<string, ExecutionState>();
  async save(s: ExecutionState) { this.states.set(s.executionId, s); }
  async load(id: string) { return this.states.get(id) ?? null; }
  async list() { return [...this.states.values()]; }
}

describe("n8n If/Filter compiled conditions execute end-to-end", () => {
  it("routes to the true branch when the condition is satisfied", async () => {
    const engine = new WorkflowEngine({ stateStore: new MemoryStore() as any });
    engine.getRegistry().register("transform", transformHandler);
    engine.getRegistry().register("condition", conditionHandler);
    engine.getRegistry().register("passthrough", passthroughHandler);

    // n8n workflow: Seed → If (count > 10) → Approved | Rejected
    const n8n = {
      name: "gate",
      nodes: [
        {
          id: "seed",
          name: "Seed",
          type: "n8n-nodes-base.set",
          parameters: {},
        },
        {
          id: "if",
          name: "If",
          type: "n8n-nodes-base.if",
          parameters: {
            conditions: {
              number: [
                { value1: "={{ $json.count }}", value2: 10, operation: "larger" },
              ],
            },
            combineOperation: "all",
          },
        },
        {
          id: "ok",
          name: "Approved",
          type: "n8n-nodes-base.set",
          parameters: {},
        },
        {
          id: "no",
          name: "Rejected",
          type: "n8n-nodes-base.set",
          parameters: {},
        },
      ],
      connections: {
        Seed: { main: [[{ node: "If", type: "main", index: 0 }]] },
        If: {
          main: [
            [{ node: "Approved", type: "main", index: 0 }],
            [{ node: "Rejected", type: "main", index: 0 }],
          ],
        },
      },
    };

    const { workflow } = importN8nWorkflow(n8n, { workflowId: "wf-gate" });

    // Replace the Seed (imported as transform with generic expression) with
    // one that produces a specific upstream shape that drives the If.
    const seed = workflow.nodes.find((n) => n.id === "seed")!;
    seed.config = { expression: "({count: 42})" };
    seed.outputs = ["count"];
    delete (seed.config as Record<string, unknown>)._n8nExpressions;

    // Silence the Approved/Rejected nodes — they default to `set` → transform
    // with generic `{...inputs}` expression; that's fine, they just return
    // their inputs. We just need the branch selection to work.
    for (const nodeId of ["ok", "no"]) {
      const n = workflow.nodes.find((x) => x.id === nodeId)!;
      n.config = { expression: `({branch: '${nodeId}'})` };
      delete (n.config as Record<string, unknown>)._n8nExpressions;
    }

    engine.registerWorkflow(workflow);
    const state = await engine.execute(workflow.id, {});
    expect(state.status).toBe("completed");

    // If node selected the "true" branch
    const ifStep = state.steps.if;
    expect(ifStep.selectedBranch).toBe("true");

    // Approved ran, Rejected was skipped
    expect(state.steps.ok.status).toBe("completed");
    expect(state.steps.no.status).toBe("skipped");
  });

  it("routes to the false branch when the condition is not satisfied", async () => {
    const engine = new WorkflowEngine({ stateStore: new MemoryStore() as any });
    engine.getRegistry().register("transform", transformHandler);
    engine.getRegistry().register("condition", conditionHandler);
    engine.getRegistry().register("passthrough", passthroughHandler);

    const n8n = {
      name: "gate",
      nodes: [
        { id: "seed", name: "Seed", type: "n8n-nodes-base.set", parameters: {} },
        {
          id: "if",
          name: "If",
          type: "n8n-nodes-base.if",
          parameters: {
            conditions: {
              string: [
                { value1: "={{ $json.status }}", value2: "approved", operation: "equal" },
              ],
            },
          },
        },
        { id: "ok", name: "Approved", type: "n8n-nodes-base.set", parameters: {} },
        { id: "no", name: "Rejected", type: "n8n-nodes-base.set", parameters: {} },
      ],
      connections: {
        Seed: { main: [[{ node: "If", type: "main", index: 0 }]] },
        If: {
          main: [
            [{ node: "Approved", type: "main", index: 0 }],
            [{ node: "Rejected", type: "main", index: 0 }],
          ],
        },
      },
    };

    const { workflow } = importN8nWorkflow(n8n, { workflowId: "wf-gate-2" });

    const seed = workflow.nodes.find((n) => n.id === "seed")!;
    seed.config = { expression: "({status: 'pending'})" };
    seed.outputs = ["status"];
    delete (seed.config as Record<string, unknown>)._n8nExpressions;
    for (const nodeId of ["ok", "no"]) {
      const n = workflow.nodes.find((x) => x.id === nodeId)!;
      n.config = { expression: `({branch: '${nodeId}'})` };
      delete (n.config as Record<string, unknown>)._n8nExpressions;
    }

    engine.registerWorkflow(workflow);
    const state = await engine.execute(workflow.id, {});
    expect(state.status).toBe("completed");

    expect(state.steps.if.selectedBranch).toBe("false");
    expect(state.steps.no.status).toBe("completed");
    expect(state.steps.ok.status).toBe("skipped");
  });
});

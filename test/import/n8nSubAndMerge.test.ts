import { describe, it, expect } from "vitest";
import { importN8nWorkflow } from "../../src/import/n8n.js";

describe("n8n executeWorkflow mapper", () => {
  it("maps executeWorkflow → sub-workflow node with workflowId", () => {
    const { workflow } = importN8nWorkflow({
      name: "parent",
      nodes: [
        {
          id: "ew",
          name: "Run Child",
          type: "n8n-nodes-base.executeWorkflow",
          parameters: {
            workflowId: { value: "child-id" },
            workflowInputs: {
              values: [
                { name: "foo", value: "bar" },
                { name: "n", value: 42 },
              ],
            },
          },
        },
      ],
    });
    const node = workflow.nodes[0];
    expect(node.type).toBe("sub-workflow");
    expect(node.config.workflowId).toBe("child-id");
    expect(node.config.inputs).toEqual({ foo: "bar", n: 42 });
  });

  it("falls back to plain inputData when workflowInputs.values is absent", () => {
    const { workflow } = importN8nWorkflow({
      name: "parent",
      nodes: [
        {
          id: "ew",
          name: "Run",
          type: "n8n-nodes-base.executeWorkflow",
          parameters: {
            workflowId: "direct-id",
            inputData: { a: 1, b: 2 },
          },
        },
      ],
    });
    expect(workflow.nodes[0].config.workflowId).toBe("direct-id");
    expect(workflow.nodes[0].config.inputs).toEqual({ a: 1, b: 2 });
  });
});

describe("n8n merge mapper", () => {
  it("maps append mode → merge node with mode=append", () => {
    const { workflow } = importN8nWorkflow({
      name: "m",
      nodes: [
        { id: "a", name: "A", type: "n8n-nodes-base.set", parameters: {} },
        { id: "b", name: "B", type: "n8n-nodes-base.set", parameters: {} },
        {
          id: "m",
          name: "Merge",
          type: "n8n-nodes-base.merge",
          parameters: { mode: "append" },
        },
      ],
      connections: {
        A: { main: [[{ node: "Merge", type: "main", index: 0 }]] },
        B: { main: [[{ node: "Merge", type: "main", index: 0 }]] },
      },
    });
    const mergeNode = workflow.nodes.find((n) => n.id === "m")!;
    expect(mergeNode.type).toBe("merge");
    expect(mergeNode.config.mode).toBe("append");

    // Two incoming edges → two __n8nMerge_* input mappings
    const mergeInputs = mergeNode.inputs.filter((i) => i.to.startsWith("__n8nMerge_"));
    expect(mergeInputs).toHaveLength(2);
    expect(mergeInputs.map((i) => i.to).sort()).toEqual(["__n8nMerge_0", "__n8nMerge_1"]);
  });

  it("translates n8n's combineByPosition → combine", () => {
    const { workflow } = importN8nWorkflow({
      name: "m",
      nodes: [
        {
          id: "m",
          name: "Merge",
          type: "n8n-nodes-base.merge",
          parameters: { mode: "combineByPosition" },
        },
      ],
    });
    expect(workflow.nodes[0].config.mode).toBe("combine");
  });

  it("pulls mergeByKey field from nested mergeByFields config", () => {
    const { workflow } = importN8nWorkflow({
      name: "m",
      nodes: [
        {
          id: "m",
          name: "Merge",
          type: "n8n-nodes-base.merge",
          parameters: {
            mode: "mergeByKey",
            mergeByFields: { values: [{ field1: "userId", field2: "userId" }] },
          },
        },
      ],
    });
    expect(workflow.nodes[0].config.mode).toBe("mergeByKey");
    expect(workflow.nodes[0].config.mergeByKey).toBe("userId");
  });
});

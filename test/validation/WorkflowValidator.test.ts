import { describe, it, expect } from "vitest";
import { validateWorkflow, WorkflowValidationError } from "../../src/validation/WorkflowValidator.js";

describe("WorkflowValidator", () => {
  const validWorkflow = {
    id: "test",
    name: "Test",
    version: "1",
    nodes: [
      { id: "a", type: "transform", name: "A", inputs: [], outputs: ["v"], config: {} },
      { id: "b", type: "transform", name: "B", inputs: [], outputs: ["v"], config: {} },
    ],
    edges: [{ from: "a", to: "b" }],
  };

  it("accepts a valid workflow", () => {
    expect(() => validateWorkflow(validWorkflow)).not.toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => validateWorkflow({ id: "test" })).toThrow(WorkflowValidationError);
  });

  it("rejects duplicate node IDs", () => {
    const workflow = {
      ...validWorkflow,
      nodes: [
        { id: "a", type: "transform", name: "A", inputs: [], outputs: [], config: {} },
        { id: "a", type: "transform", name: "A2", inputs: [], outputs: [], config: {} },
      ],
    };
    expect(() => validateWorkflow(workflow)).toThrow("Duplicate");
  });

  it("rejects edges referencing unknown nodes", () => {
    const workflow = {
      ...validWorkflow,
      edges: [{ from: "a", to: "unknown" }],
    };
    expect(() => validateWorkflow(workflow)).toThrow("Invalid edge references");
  });

  it("rejects cyclic graphs", () => {
    const workflow = {
      id: "cyclic",
      name: "Cyclic",
      version: "1",
      nodes: [
        { id: "a", type: "transform", name: "A", inputs: [], outputs: [], config: {} },
        { id: "b", type: "transform", name: "B", inputs: [], outputs: [], config: {} },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    expect(() => validateWorkflow(workflow)).toThrow("cycle");
  });
});

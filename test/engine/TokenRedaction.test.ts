import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkflowEngine } from "../../src/engine/Engine.js";
import { FileStateStore } from "../../src/persistence/FileStateStore.js";
import { transformHandler } from "../../src/nodes/TransformNode.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowDefinition } from "../../src/types/workflow.js";

describe("Token redaction on persistence", () => {
  let tmpDir: string;
  let engine: WorkflowEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "stirrup-redact-"));
    engine = new WorkflowEngine({
      stateStore: new FileStateStore(tmpDir),
    });
    engine.getRegistry().register("transform", transformHandler);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("strips service-backed param values from the persisted state", async () => {
    const workflow: WorkflowDefinition = {
      id: "test-redact",
      name: "Redact Test",
      version: "1",
      params: [
        { name: "githubToken", type: "string", service: "github" },
        { name: "publicData", type: "string" },
      ],
      nodes: [
        {
          id: "echo",
          type: "transform",
          name: "Echo",
          inputs: [],
          outputs: ["out"],
          config: { expression: "({ out: 'ran' })" },
        },
      ],
      edges: [],
    };
    engine.registerWorkflow(workflow);

    const result = await engine.execute("test-redact", {
      githubToken: "ghp_SECRET_TOKEN_1234",
      publicData: "visible",
    });

    // Reload state from disk — this is what would leak if the DB was copied
    const loaded = await engine.getState(result.executionId);
    expect(loaded).toBeTruthy();
    expect(loaded!.context.githubToken).toBe("");
    expect(loaded!.context.publicData).toBe("visible");
  });

  it("leaves params without a service binding untouched", async () => {
    const workflow: WorkflowDefinition = {
      id: "no-service",
      name: "No Service",
      version: "1",
      params: [
        { name: "apiUrl", type: "string" },
      ],
      nodes: [
        {
          id: "n",
          type: "transform",
          name: "N",
          inputs: [],
          outputs: ["v"],
          config: { expression: "({ v: 1 })" },
        },
      ],
      edges: [],
    };
    engine.registerWorkflow(workflow);

    const result = await engine.execute("no-service", { apiUrl: "https://example.com" });
    const loaded = await engine.getState(result.executionId);
    expect(loaded!.context.apiUrl).toBe("https://example.com");
  });

  it("does not touch node outputs (only context)", async () => {
    // If a node's output happens to contain a token-shaped value, we don't
    // scan for it. The redaction is scoped to known service-backed params.
    const workflow: WorkflowDefinition = {
      id: "output-test",
      name: "Output Test",
      version: "1",
      params: [
        { name: "token", type: "string", service: "github" },
      ],
      nodes: [
        {
          id: "emit",
          type: "transform",
          name: "Emit",
          inputs: [],
          outputs: ["leaked"],
          config: { expression: "({ leaked: 'ghp_still_here' })" },
        },
      ],
      edges: [],
    };
    engine.registerWorkflow(workflow);

    const result = await engine.execute("output-test", { token: "ghp_SECRET" });
    const loaded = await engine.getState(result.executionId);
    expect(loaded!.context.token).toBe("");
    // Node outputs are not scanned — documents the scope of redaction
    expect(loaded!.steps.emit?.outputs.leaked).toBe("ghp_still_here");
  });
});

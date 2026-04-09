import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "node:path";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { stringify as yamlStringify } from "yaml";
import { WorkflowEngine } from "../engine/Engine.js";
import { SqliteStateStore } from "../persistence/SqliteStateStore.js";
import { NodeRegistry } from "../nodes/NodeRegistry.js";
import { transformHandler } from "../nodes/TransformNode.js";
import { conditionHandler } from "../nodes/ConditionNode.js";
import { httpHandler } from "../nodes/HttpNode.js";
import { scriptHandler } from "../nodes/ScriptNode.js";
import { validateWorkflow, WorkflowValidationError } from "../validation/WorkflowValidator.js";
import type { WorkflowDefinition } from "../types/workflow.js";

let engine: WorkflowEngine;

function getEngine(): WorkflowEngine {
  if (!engine) {
    const workflowsDir = resolve(process.env.WORKFLOWS_DIR ?? "./workflows");
    const dbPath = resolve(process.env.DB_PATH ?? "./stirrup.db");

    if (!existsSync(workflowsDir)) {
      mkdirSync(workflowsDir, { recursive: true });
    }

    engine = new WorkflowEngine({
      definitionsDir: workflowsDir,
      stateStore: new SqliteStateStore(dbPath),
    });

    const registry = engine.getRegistry();
    registry.register("transform", transformHandler);
    registry.register("condition", conditionHandler);
    registry.register("http", httpHandler);
    registry.register("script", scriptHandler);
  }
  return engine;
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "stirrup",
    version: "0.1.0",
  });

  // --- Tool: list_workflows ---
  server.tool(
    "list_workflows",
    "List all available workflow definitions with their IDs, names, descriptions, and parameter info",
    {},
    async () => {
      const eng = getEngine();
      const workflows = (eng as any).workflows as Map<string, WorkflowDefinition>;
      const list = [...workflows.values()].map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        params: wf.params,
        nodeCount: wf.nodes.length,
        edgeCount: wf.edges.length,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(list, null, 2) }] };
    }
  );

  // --- Tool: get_workflow ---
  server.tool(
    "get_workflow",
    "Get the full definition of a workflow by ID, including all nodes, edges, and configuration",
    { workflowId: z.string().describe("The workflow ID to retrieve") },
    async ({ workflowId }) => {
      const eng = getEngine();
      const workflows = (eng as any).workflows as Map<string, WorkflowDefinition>;
      const wf = workflows.get(workflowId);
      if (!wf) {
        return { content: [{ type: "text" as const, text: `Error: Workflow not found: "${workflowId}"` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(wf, null, 2) }] };
    }
  );

  // --- Tool: create_workflow ---
  server.tool(
    "create_workflow",
    "Create a new workflow from a JSON definition. The workflow is validated, saved as YAML, and registered with the engine. Returns the created workflow.",
    {
      workflow: z.string().describe("Complete workflow definition as a JSON string. Must include id, name, version, nodes, and edges."),
    },
    async ({ workflow: workflowJson }) => {
      const eng = getEngine();
      let parsed: unknown;
      try {
        parsed = JSON.parse(workflowJson);
      } catch {
        return { content: [{ type: "text" as const, text: "Error: Invalid JSON" }], isError: true };
      }

      try {
        validateWorkflow(parsed);
      } catch (err) {
        if (err instanceof WorkflowValidationError) {
          return {
            content: [{ type: "text" as const, text: `Validation error: ${err.message}\n${err.details.join("\n")}` }],
            isError: true,
          };
        }
        throw err;
      }

      const wf = parsed as WorkflowDefinition;
      eng.registerWorkflow(wf);

      // Save to disk
      const workflowsDir = resolve(process.env.WORKFLOWS_DIR ?? "./workflows");
      const filePath = resolve(workflowsDir, `${wf.id}.yaml`);
      writeFileSync(filePath, yamlStringify(wf), "utf-8");

      return {
        content: [{ type: "text" as const, text: `Created workflow "${wf.name}" (${wf.id}) with ${wf.nodes.length} nodes. Saved to ${filePath}` }],
      };
    }
  );

  // --- Tool: run_workflow ---
  server.tool(
    "run_workflow",
    "Execute a workflow by ID with the given parameters. Returns the full execution state including all step outputs.",
    {
      workflowId: z.string().describe("The workflow ID to execute"),
      params: z.string().optional().describe("JSON object of parameter values to pass as context (e.g. '{\"repo\": \"owner/repo\", \"prNumber\": 42}')"),
    },
    async ({ workflowId, params }) => {
      const eng = getEngine();
      let context: Record<string, unknown> | undefined;
      if (params) {
        try {
          context = JSON.parse(params);
        } catch {
          return { content: [{ type: "text" as const, text: "Error: Invalid JSON for params" }], isError: true };
        }
      }

      try {
        const state = await eng.execute(workflowId, context);
        return { content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Execution error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: get_execution ---
  server.tool(
    "get_execution",
    "Get the current state of a workflow execution by its execution ID",
    { executionId: z.string().describe("The execution ID to retrieve") },
    async ({ executionId }) => {
      const eng = getEngine();
      const state = await eng.getState(executionId);
      if (!state) {
        return { content: [{ type: "text" as const, text: `Error: Execution not found: "${executionId}"` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }] };
    }
  );

  // --- Tool: validate_workflow ---
  server.tool(
    "validate_workflow",
    "Validate a workflow definition JSON without saving or executing it. Returns validation errors or confirms it's valid.",
    {
      workflow: z.string().describe("Workflow definition as a JSON string to validate"),
    },
    async ({ workflow: workflowJson }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(workflowJson);
      } catch {
        return { content: [{ type: "text" as const, text: "Error: Invalid JSON" }], isError: true };
      }

      try {
        validateWorkflow(parsed);
        const wf = parsed as WorkflowDefinition;
        return {
          content: [{
            type: "text" as const,
            text: `Valid workflow: "${wf.name}" (${wf.id}) — ${wf.nodes.length} nodes, ${wf.edges.length} edges`,
          }],
        };
      } catch (err) {
        if (err instanceof WorkflowValidationError) {
          return {
            content: [{ type: "text" as const, text: `Invalid:\n${err.details.join("\n")}` }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- Tool: list_node_types ---
  server.tool(
    "list_node_types",
    "List all available node types with their configuration schemas. Use this to understand what types of nodes can be used in workflows.",
    {},
    async () => {
      const types = [
        { type: "transform", category: "deterministic", description: "Evaluate a JS expression on inputs", configFields: "expression (string, required)" },
        { type: "condition", category: "deterministic", description: "Branch based on a JS expression that returns a branch name", configFields: "expression (string, required)" },
        { type: "http", category: "deterministic", description: "Make HTTP requests to external APIs", configFields: "url (string), method (GET|POST|PUT|DELETE|PATCH), headers (object), body (any)" },
        { type: "script", category: "deterministic", description: "Run arbitrary JS code in a sandbox", configFields: "code (string), timeoutMs (number)" },
        { type: "llm-prompt", category: "ai", description: "Send a templated prompt to Claude and get a response", configFields: "promptTemplate (string), systemPrompt (string), model (string), responseFormat (text|json), maxTokens (number), temperature (number)" },
        { type: "agent-tool-use", category: "ai", description: "Autonomous AI agent that can use tools in a loop", configFields: "systemPrompt (string), taskTemplate (string), tools (string[]), maxIterations (number), maxTokens (number)" },
        { type: "decision-routing", category: "ai", description: "AI evaluates data and picks the next branch", configFields: "promptTemplate (string), branches (Record<name, description>), maxTokens (number)" },
        { type: "code-generation", category: "ai", description: "AI generates code and optionally executes it", configFields: "promptTemplate (string), language (typescript|javascript|python), execute (boolean), sandboxTimeoutMs (number)" },
      ];
      return { content: [{ type: "text" as const, text: JSON.stringify(types, null, 2) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run if called directly
startMcpServer().catch(console.error);

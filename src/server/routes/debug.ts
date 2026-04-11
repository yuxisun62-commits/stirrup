import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import type { WorkflowEngine } from "../../engine/Engine.js";

export function debugRoutes(engine: WorkflowEngine): Router {
  const router = Router();

  /**
   * Inspect a failed node: returns resolved inputs, current config, and the step result
   * from the most recent execution.
   */
  router.get("/executions/:executionId/nodes/:nodeId", async (req, res) => {
    const { executionId, nodeId } = req.params;
    try {
      const state = await engine.getState(executionId);
      if (!state) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Execution not found" } });
        return;
      }
      const step = state.steps[nodeId];
      const info = await engine.getNodeInputs(executionId, nodeId);
      res.json({
        step,
        resolvedInputs: info.resolvedInputs,
        mappings: info.mappings,
        config: info.config,
        context: state.context,
      });
    } catch (err) {
      res.status(500).json({ error: { code: "DEBUG_FAILED", message: (err as Error).message } });
    }
  });

  /**
   * Re-run a single node in isolation with optional input/config overrides.
   * Useful for iterating on a fix without re-running the whole workflow.
   */
  router.post("/executions/:executionId/nodes/:nodeId/retry", async (req, res) => {
    const { executionId, nodeId } = req.params;
    const { inputs, config } = req.body as {
      inputs?: Record<string, unknown>;
      config?: Record<string, unknown>;
    };
    try {
      const result = await engine.debugNode(executionId, nodeId, inputs, config);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: { code: "DEBUG_RETRY_FAILED", message: (err as Error).message } });
    }
  });

  /**
   * Ask Claude to diagnose a failed node and suggest a fix.
   */
  router.post("/executions/:executionId/nodes/:nodeId/analyze", async (req, res) => {
    const { executionId, nodeId } = req.params;

    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({
        error: { code: "CONFIG_ERROR", message: "ANTHROPIC_API_KEY not configured" },
      });
      return;
    }

    try {
      const state = await engine.getState(executionId);
      if (!state) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Execution not found" } });
        return;
      }
      const step = state.steps[nodeId];
      if (!step || step.status !== "failed") {
        res.status(400).json({ error: { code: "NOT_FAILED", message: "Node did not fail" } });
        return;
      }

      const info = await engine.getNodeInputs(executionId, nodeId);
      const workflows = (engine as any).workflows as Map<string, import("../../types/workflow.js").WorkflowDefinition>;
      const workflow = workflows.get(state.workflowId);
      const node = workflow?.nodes.find((n) => n.id === nodeId);

      const client = new Anthropic();
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: `You are a debugging expert for Stirrup, a DAG workflow engine. A node failed during execution. Analyze the error, the node's config, the inputs it received, and determine:
1. Root cause of the failure
2. A specific, actionable fix
3. Whether the issue is in the node config, the input data, an upstream node, or external factors

Be concise and technical. Focus on what the user can change to fix it.`,
        messages: [
          {
            role: "user",
            content: `A node failed in a workflow. Help me debug it.

**Node type:** ${node?.type}
**Node ID:** ${nodeId}
**Node name:** ${node?.name}

**Config:**
\`\`\`json
${JSON.stringify(info.config, null, 2)}
\`\`\`

**Input mappings:**
\`\`\`json
${JSON.stringify(info.mappings, null, 2)}
\`\`\`

**Resolved inputs (what the node actually received):**
\`\`\`json
${JSON.stringify(info.resolvedInputs, null, 2)}
\`\`\`

**Error:**
${step.error?.message ?? "unknown"}

${step.error?.stack ? `**Stack trace:**\n\`\`\`\n${step.error.stack}\n\`\`\`` : ""}

**Attempts:** ${step.attempts}

Diagnose the root cause and suggest a specific fix.`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const analysis = textBlock && textBlock.type === "text" ? textBlock.text : "No analysis available";

      res.json({ analysis, nodeId, executionId });
    } catch (err) {
      res.status(500).json({ error: { code: "ANALYZE_FAILED", message: (err as Error).message } });
    }
  });

  return router;
}

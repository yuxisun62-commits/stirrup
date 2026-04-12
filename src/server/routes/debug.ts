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
        max_tokens: 2500,
        system: `You are a debugging expert for Stirrup, a DAG workflow engine. A node failed during execution. Analyze the error and produce a structured response in the exact JSON shape below.

Your output must be valid JSON matching this schema:
{
  "analysis": "string — concise prose diagnosis of what went wrong and why. 2–5 sentences, technical, specific. Reference concrete values from the config/inputs/error.",
  "suggestedEdits": [
    {
      "field": "string — dot-path inside the node (e.g. 'config.url', 'config.headers.Authorization', 'config.promptTemplate', 'retry.maxAttempts', 'description'). Must start with 'config.', 'retry.', 'description', or 'name'. Do NOT suggest edits to 'inputs', 'outputs', or 'id' — those are structural and need manual review.",
      "currentValue": "the CURRENT value of that field, verbatim from the provided config",
      "suggestedValue": "the value that would fix the problem. Use the same type as currentValue (string, number, boolean, object).",
      "reason": "one sentence — WHY this edit fixes the specific error above"
    }
  ]
}

Rules:
- If the failure is not fixable via simple field edits (needs upstream changes, needs new nodes, needs a token the user hasn't supplied), return an empty suggestedEdits array and explain in the analysis what the user needs to do manually
- Only suggest edits you are confident will help. Don't speculate.
- Preserve type fidelity: if currentValue is a number, suggestedValue must be a number; if it's an object, return the full replacement object
- For nested config fields use dot notation: "config.headers.Authorization" → config.headers.Authorization
- Never suggest the SAME value as currentValue
- Never suggest edits that would introduce secrets/tokens — if auth is broken, recommend the user connect the service in the Connections panel in the analysis prose

Output ONLY the JSON object. No markdown fences, no preamble, no explanation outside the JSON.`,
        messages: [
          {
            role: "user",
            content: `A node failed in a workflow. Diagnose and suggest concrete field edits.

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

Return the JSON response as specified.`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";

      // Parse the structured output. Be tolerant of models that wrap JSON
      // in markdown fences despite being told not to.
      let analysis = "No analysis available";
      let suggestedEdits: Array<{
        field: string;
        currentValue: unknown;
        suggestedValue: unknown;
        reason: string;
      }> = [];

      if (rawText) {
        const cleaned = rawText
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```\s*$/, "")
          .trim();
        try {
          const parsed = JSON.parse(cleaned);
          if (typeof parsed.analysis === "string") analysis = parsed.analysis;
          if (Array.isArray(parsed.suggestedEdits)) {
            // Validate each edit has the required shape and a safe field path
            suggestedEdits = parsed.suggestedEdits.filter((e: unknown) => {
              if (!e || typeof e !== "object") return false;
              const edit = e as Record<string, unknown>;
              if (typeof edit.field !== "string") return false;
              const field = edit.field;
              // Only allow editing safe top-level fields — no inputs/outputs/id
              if (
                !field.startsWith("config.") &&
                !field.startsWith("retry.") &&
                field !== "description" &&
                field !== "name"
              ) {
                return false;
              }
              if (typeof edit.reason !== "string") return false;
              // Reject no-op edits
              if (JSON.stringify(edit.currentValue) === JSON.stringify(edit.suggestedValue)) {
                return false;
              }
              return true;
            }).map((e: unknown) => {
              const edit = e as Record<string, unknown>;
              return {
                field: edit.field as string,
                currentValue: edit.currentValue,
                suggestedValue: edit.suggestedValue,
                reason: edit.reason as string,
              };
            });
          }
        } catch {
          // JSON parse failed — fall back to using the raw text as analysis
          analysis = rawText;
        }
      }

      res.json({ analysis, suggestedEdits, nodeId, executionId });
    } catch (err) {
      res.status(500).json({ error: { code: "ANALYZE_FAILED", message: (err as Error).message } });
    }
  });

  return router;
}

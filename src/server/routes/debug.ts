import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import type { WorkflowEngine } from "../../engine/Engine.js";
import type { WorkflowDefinition } from "../../types/workflow.js";

/**
 * Identify the param names that carry service-backed credentials. Tokens are
 * injected into context under these names by executions.ts and the engine,
 * so they show up in resolvedInputs, config (if referenced by a template
 * string), and state.context. We redact them before:
 *   - returning the debug inspect payload to the browser (M-4)
 *   - embedding anything in the AI analyze prompt sent to Anthropic (H-1)
 */
function getTokenKeys(workflow: WorkflowDefinition | undefined): Set<string> {
  const keys = new Set<string>();
  if (!workflow?.params) return keys;
  for (const p of workflow.params) {
    if (p.service) keys.add(p.name);
    // Also catch conventional token-like param names as a fallback defense
    // for templates that may not declare `service: X` but still hold secrets.
    if (/token|secret|password|api[_-]?key|credential/i.test(p.name)) keys.add(p.name);
  }
  return keys;
}

/** Recursively redact token values at any depth in a nested object. */
function redactTokens(value: unknown, tokenKeys: Set<string>): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactTokens(v, tokenKeys));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (tokenKeys.has(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactTokens(v, tokenKeys);
      }
    }
    return out;
  }
  return value;
}

export function debugRoutes(engine: WorkflowEngine): Router {
  const router = Router();

  // Helper: look up the workflow definition for a running execution
  const getWorkflow = (workflowId: string): WorkflowDefinition | undefined => {
    const workflows = (engine as unknown as { workflows: Map<string, WorkflowDefinition> }).workflows;
    return workflows.get(workflowId);
  };

  /**
   * Inspect a failed node: returns resolved inputs, current config, and the step result
   * from the most recent execution. Tokens are redacted server-side so they
   * never reach the browser.
   */
  router.get("/executions/:executionId/nodes/:nodeId", async (req, res) => {
    const { executionId, nodeId } = req.params;
    try {
      const state = await engine.getState(executionId);
      if (!state) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Execution not found" } });
        return;
      }
      const workflow = getWorkflow(state.workflowId);
      const tokenKeys = getTokenKeys(workflow);
      const step = state.steps[nodeId];
      const info = await engine.getNodeInputs(executionId, nodeId);
      res.json({
        step,
        resolvedInputs: redactTokens(info.resolvedInputs, tokenKeys),
        mappings: info.mappings,
        config: redactTokens(info.config, tokenKeys),
        context: redactTokens(state.context, tokenKeys),
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
      const workflow = getWorkflow(state.workflowId);
      const node = workflow?.nodes.find((n) => n.id === nodeId);

      // Redact tokens before embedding in the prompt. This keeps stored
      // credentials from ever being sent to Anthropic. The analysis quality
      // is unaffected — Claude can still diagnose auth failures based on
      // the error message, just can't see the actual token values.
      const tokenKeys = getTokenKeys(workflow);
      const redactedConfig = redactTokens(info.config, tokenKeys) as Record<string, unknown>;
      const redactedInputs = redactTokens(info.resolvedInputs, tokenKeys) as Record<string, unknown>;

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
${JSON.stringify(redactedConfig, null, 2)}
\`\`\`

**Input mappings:**
\`\`\`json
${JSON.stringify(info.mappings, null, 2)}
\`\`\`

**Resolved inputs (what the node actually received — credentials shown as [REDACTED]):**
\`\`\`json
${JSON.stringify(redactedInputs, null, 2)}
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
            // Validate each edit has the required shape and a safe field path.
            // Prototype-pollution guard: reject any path whose segments
            // include __proto__, constructor, or prototype. These pass the
            // "starts with config." check but would poison downstream
            // property lookups if applied.
            const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
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
              // Reject any dot-path segment that would enable prototype pollution
              if (field.split(".").some((seg) => FORBIDDEN_PATH_SEGMENTS.has(seg))) {
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

import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { validateWorkflow, WorkflowValidationError } from "../../validation/WorkflowValidator.js";

const SYSTEM_PROMPT = `You are a workflow architect for Stirrup, a DAG workflow engine. When given a description of a desired workflow, you generate a complete workflow definition as JSON.

Available node types:
- transform: Evaluate a JS expression. Config: { expression: string }
- condition: Branch based on expression result (returns branch name string). Config: { expression: string }
- http: Make HTTP requests. Config: { url: string, method: string, headers?: object, body?: any }
- script: Run JS code in sandbox. Config: { code: string, timeoutMs?: number }
- llm-prompt: Send a prompt to Claude. Config: { promptTemplate: string, systemPrompt?: string, responseFormat?: "text"|"json", maxTokens?: number }
- agent-tool-use: Autonomous AI agent with tools. Config: { systemPrompt: string, taskTemplate: string, tools: string[], maxIterations?: number }
- decision-routing: AI picks next branch. Config: { promptTemplate: string, branches: { branchName: "description" } }
- code-generation: AI generates code. Config: { promptTemplate: string, language: "typescript"|"javascript"|"python", execute: boolean }

Each node has: id, type, name, inputs (array of {from, to}), outputs (string[]), config, and optionally branches (for condition/decision-routing).
Inputs reference data as "context.<param>" or "nodes.<nodeId>.outputs.<field>".
Edges connect nodes: { from, to, condition? }.

The workflow definition must include: id, name, version, description, params (array of {name, type, required?, description?, default?}), nodes, edges.

Guidelines:
- Use descriptive node IDs (kebab-case)
- Use meaningful names
- Declare all params the workflow needs at runtime
- Connect nodes with proper edges including conditional edges for branching
- Use AI nodes (llm-prompt, decision-routing, agent-tool-use) where intelligence/reasoning is needed
- Use deterministic nodes (transform, http, condition, script) for predictable operations
- Always output valid JSON with no markdown fencing or extra text`;

export function generateRoutes(): Router {
  const router = Router();

  router.post("/workflow", async (req, res) => {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "prompt is required" } });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: { code: "CONFIG_ERROR", message: "ANTHROPIC_API_KEY not configured. Run: stirrup config set anthropicApiKey <key>" } });
      return;
    }

    try {
      const client = new Anthropic();
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Generate a Stirrup workflow definition for the following:\n\n${prompt}\n\nRespond with ONLY the JSON workflow definition, no explanation or markdown.`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        res.status(500).json({ error: { code: "GENERATION_FAILED", message: "No text response from AI" } });
        return;
      }

      // Extract JSON from response (handle potential markdown fencing)
      let jsonStr = textBlock.text.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const workflow = JSON.parse(jsonStr);
      res.json(workflow);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("JSON")) {
        res.status(500).json({ error: { code: "PARSE_ERROR", message: "AI generated invalid JSON. Try again with a clearer description." } });
      } else {
        res.status(500).json({ error: { code: "GENERATION_FAILED", message } });
      }
    }
  });

  // Validate a workflow definition
  router.post("/validate", (req, res) => {
    try {
      validateWorkflow(req.body);
      res.json({ valid: true, errors: [] });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        res.json({ valid: false, errors: err.details });
      } else {
        res.json({ valid: false, errors: [(err as Error).message] });
      }
    }
  });

  // Auto-fix a workflow based on validation errors
  router.post("/fix", async (req, res) => {
    const { workflow, errors } = req.body as { workflow?: unknown; errors?: string[] };
    if (!workflow || !errors?.length) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "workflow and errors are required" } });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: { code: "CONFIG_ERROR", message: "ANTHROPIC_API_KEY not configured" } });
      return;
    }

    try {
      const client = new Anthropic();
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Fix the following Stirrup workflow definition. It has these validation errors:\n\n${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}\n\nCurrent workflow:\n${JSON.stringify(workflow, null, 2)}\n\nFix ALL the errors while preserving the workflow's intent. Return ONLY the corrected JSON, no explanation.`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        res.status(500).json({ error: { code: "FIX_FAILED", message: "No response from AI" } });
        return;
      }

      let jsonStr = textBlock.text.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const fixed = JSON.parse(jsonStr);
      res.json(fixed);
    } catch (err) {
      res.status(500).json({ error: { code: "FIX_FAILED", message: (err as Error).message } });
    }
  });

  return router;
}

import { Router } from "express";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { stringify as yamlStringify } from "yaml";
import type { WorkflowEngine } from "../../engine/Engine.js";
import type { TriggerManager } from "../../triggers/TriggerManager.js";
import type { WorkflowDefinition } from "../../types/workflow.js";
import { validateWorkflow, WorkflowValidationError } from "../../validation/WorkflowValidator.js";
import { assertSafeId, assertPathContained } from "../../validation/pathSafety.js";

export function workflowRoutes(
  engine: WorkflowEngine,
  workflowsDir: string,
  triggerManager?: TriggerManager,
): Router {
  const router = Router();

  // List all workflows
  router.get("/", (_req, res) => {
    const workflows = (engine as any).workflows as Map<string, unknown>;
    res.json([...workflows.values()]);
  });

  // Get single workflow
  router.get("/:id", (req, res) => {
    const workflows = (engine as any).workflows as Map<string, unknown>;
    const workflow = workflows.get(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Workflow not found: ${req.params.id}` } });
      return;
    }
    res.json(workflow);
  });

  // Create workflow
  router.post("/", (req, res) => {
    try {
      validateWorkflow(req.body);
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message, details: err.details } });
        return;
      }
      throw err;
    }

    const workflow = req.body;
    try { assertSafeId(workflow.id); } catch {
      res.status(400).json({ error: { code: "INVALID_ID", message: "Workflow ID must be alphanumeric with hyphens/underscores" } });
      return;
    }
    engine.registerWorkflow(workflow);
    triggerManager?.refreshWorkflow(workflow as WorkflowDefinition);

    const filePath = resolve(workflowsDir, `${workflow.id}.yaml`);
    assertPathContained(workflowsDir, filePath);
    writeFileSync(filePath, yamlStringify(workflow), "utf-8");

    res.status(201).json(workflow);
  });

  // Update workflow
  router.put("/:id", (req, res) => {
    try {
      validateWorkflow(req.body);
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message, details: err.details } });
        return;
      }
      throw err;
    }

    const workflow = req.body;
    const id = String(req.params.id);
    try { assertSafeId(id); } catch {
      res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid workflow ID" } });
      return;
    }
    workflow.id = id;
    engine.registerWorkflow(workflow);
    triggerManager?.refreshWorkflow(workflow as WorkflowDefinition);

    const filePath = resolve(workflowsDir, `${id}.yaml`);
    assertPathContained(workflowsDir, filePath);
    writeFileSync(filePath, yamlStringify(workflow), "utf-8");

    res.json(workflow);
  });

  // Delete workflow
  router.delete("/:id", (req, res) => {
    const id = String(req.params.id);
    try { assertSafeId(id); } catch {
      res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid workflow ID" } });
      return;
    }
    const workflows = (engine as any).workflows as Map<string, unknown>;
    if (!workflows.has(id)) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Workflow not found: ${id}` } });
      return;
    }

    workflows.delete(id);
    triggerManager?.unregisterWorkflow(id);
    const filePath = resolve(workflowsDir, `${id}.yaml`);
    assertPathContained(workflowsDir, filePath);
    if (existsSync(filePath)) unlinkSync(filePath);

    res.json({ ok: true });
  });

  // Validate workflow
  router.post("/:id/validate", (req, res) => {
    const workflows = (engine as any).workflows as Map<string, unknown>;
    const workflow = workflows.get(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Workflow not found: ${req.params.id}` } });
      return;
    }

    try {
      validateWorkflow(workflow);
      res.json({ valid: true });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        res.json({ valid: false, errors: err.details });
        return;
      }
      throw err;
    }
  });

  return router;
}

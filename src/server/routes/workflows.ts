import { Router } from "express";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { stringify as yamlStringify } from "yaml";
import type { WorkflowEngine } from "../../engine/Engine.js";
import { validateWorkflow, WorkflowValidationError } from "../../validation/WorkflowValidator.js";

export function workflowRoutes(engine: WorkflowEngine, workflowsDir: string): Router {
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
    engine.registerWorkflow(workflow);

    // Write to disk
    const filePath = resolve(workflowsDir, `${workflow.id}.yaml`);
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
    workflow.id = req.params.id;
    engine.registerWorkflow(workflow);

    const filePath = resolve(workflowsDir, `${workflow.id}.yaml`);
    writeFileSync(filePath, yamlStringify(workflow), "utf-8");

    res.json(workflow);
  });

  // Delete workflow
  router.delete("/:id", (req, res) => {
    const workflows = (engine as any).workflows as Map<string, unknown>;
    if (!workflows.has(req.params.id)) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Workflow not found: ${req.params.id}` } });
      return;
    }

    workflows.delete(req.params.id);
    const filePath = resolve(workflowsDir, `${req.params.id}.yaml`);
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

import { Router } from "express";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify as yamlStringify } from "yaml";
import type { WorkflowEngine } from "../../engine/Engine.js";
import type { WorkflowDefinition } from "../../types/workflow.js";
import { importN8nWorkflow } from "../../import/n8n.js";
import { importMakeBlueprint } from "../../import/make.js";
import { validateWorkflow, WorkflowValidationError } from "../../validation/WorkflowValidator.js";
import { assertSafeId, assertPathContained } from "../../validation/pathSafety.js";

/**
 * Routes for importing foreign workflow formats. Each importer produces a
 * Stirrup WorkflowDefinition plus a report describing what was translated
 * cleanly and what became a passthrough stub the user will need to fix.
 *
 *   POST /api/import/n8n   — body: raw n8n JSON, or { source: ... } wrapper
 *   POST /api/import/make  — body: raw Make blueprint, or { source: ... }
 *
 * Both support `?dryRun=1` to return the emitted workflow + report without
 * persisting it to disk or registering it with the engine.
 */
export function importRoutes(engine: WorkflowEngine, workflowsDir: string): Router {
  const router = Router();

  function unwrapSource(body: unknown): unknown {
    return (body && typeof body === "object" && "source" in body ? (body as any).source : body) ?? {};
  }

  function finalize(
    res: Parameters<Parameters<Router["post"]>[1]>[1],
    workflow: WorkflowDefinition,
    report: unknown,
    dryRun: boolean,
  ) {
    try {
      validateWorkflow(workflow);
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        res.status(422).json({
          error: {
            code: "IMPORT_PRODUCED_INVALID_WORKFLOW",
            message: err.message,
            details: err.details,
            report,
            workflow,
          },
        });
        return;
      }
      throw err;
    }

    if (dryRun) {
      res.json({ workflow, report, persisted: false });
      return;
    }

    try {
      assertSafeId(workflow.id);
    } catch {
      res.status(400).json({
        error: { code: "INVALID_ID", message: "Imported workflow produced an unsafe id" },
      });
      return;
    }

    engine.registerWorkflow(workflow);
    const filePath = resolve(workflowsDir, `${workflow.id}.yaml`);
    assertPathContained(workflowsDir, filePath);
    writeFileSync(filePath, yamlStringify(workflow), "utf-8");

    res.status(201).json({ workflow, report, persisted: true });
  }

  router.post("/n8n", (req, res) => {
    const raw = unwrapSource(req.body);
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).nodes)) {
      res.status(400).json({
        error: {
          code: "INVALID_SOURCE",
          message: "Request body must be an n8n workflow JSON (or { source: ... }) with a `nodes` array",
        },
      });
      return;
    }
    const { workflow, report } = importN8nWorkflow(raw as any);
    const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
    finalize(res, workflow, report, dryRun);
  });

  router.post("/make", (req, res) => {
    const raw = unwrapSource(req.body);
    const hasFlow = raw && typeof raw === "object" && Array.isArray((raw as any).flow);
    const hasModule = raw && typeof raw === "object" && typeof (raw as any).module === "string";
    if (!hasFlow && !hasModule) {
      res.status(400).json({
        error: {
          code: "INVALID_SOURCE",
          message: "Request body must be a Make blueprint (object with `flow` array or a single root module)",
        },
      });
      return;
    }
    const { workflow, report } = importMakeBlueprint(raw as any);
    const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
    finalize(res, workflow, report, dryRun);
  });

  return router;
}

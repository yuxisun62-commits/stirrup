import { Router } from "express";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify as yamlStringify } from "yaml";
import type { WorkflowEngine } from "../../engine/Engine.js";
import { importN8nWorkflow } from "../../import/n8n.js";
import { validateWorkflow, WorkflowValidationError } from "../../validation/WorkflowValidator.js";
import { assertSafeId, assertPathContained } from "../../validation/pathSafety.js";

/**
 * Routes for importing foreign workflow formats. Each importer produces a
 * Stirrup WorkflowDefinition plus a report describing what was translated
 * cleanly and what became a passthrough stub the user will need to fix.
 *
 * POST /api/import/n8n
 *   body: n8n JSON (raw export), or { source: N8nWorkflow } wrapper
 *   query: ?dryRun=1 to return the workflow + report without persisting
 *   response: { workflow, report }
 */
export function importRoutes(engine: WorkflowEngine, workflowsDir: string): Router {
  const router = Router();

  router.post("/n8n", (req, res) => {
    const raw = (req.body && typeof req.body === "object" && "source" in req.body
      ? (req.body as any).source
      : req.body) ?? {};

    if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).nodes)) {
      res.status(400).json({
        error: {
          code: "INVALID_SOURCE",
          message: "Request body must be an n8n workflow JSON (or { source: ... }) with a `nodes` array",
        },
      });
      return;
    }

    const { workflow, report } = importN8nWorkflow(raw);

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

    const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
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
  });

  return router;
}

import { Router } from "express";
import AdmZip from "adm-zip";
import type { WorkflowEngine } from "../../engine/Engine.js";
import type { WorkflowDefinition } from "../../types/workflow.js";
import { generateExportFiles } from "../../export/generateFiles.js";

export function exportRoutes(engine: WorkflowEngine): Router {
  const router = Router();

  router.post("/workflow", (req, res) => {
    const { workflowId, format } = req.body as { workflowId: string; format?: "node" | "docker" };

    if (!workflowId) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "workflowId is required" } });
      return;
    }

    const workflows = (engine as any).workflows as Map<string, WorkflowDefinition>;
    const workflow = workflows.get(workflowId);
    if (!workflow) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Workflow not found: ${workflowId}` } });
      return;
    }

    try {
      const files = generateExportFiles(workflow, { format: format ?? "node" });
      const zip = new AdmZip();
      for (const file of files) {
        zip.addFile(file.path, Buffer.from(file.content, "utf-8"));
      }
      const buffer = zip.toBuffer();

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${workflow.id}.zip"`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: { code: "EXPORT_FAILED", message: (err as Error).message } });
    }
  });

  return router;
}

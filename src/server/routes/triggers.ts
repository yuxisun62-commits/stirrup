import { Router } from "express";
import type { TriggerManager } from "../../triggers/TriggerManager.js";
import type { WorkflowEngine } from "../../engine/Engine.js";

/**
 * Trigger-related API routes:
 *   GET  /api/triggers                   — list runtime status of every trigger
 *   POST /api/triggers/test/:workflowId  — fire a workflow like a trigger would
 *
 * HTTP and webhook triggers mount their own routes under the same router
 * via sub-routers created in createServer. That means those endpoints live
 * at /api/triggers/http/... and /api/triggers/webhook/... — visible to the
 * outside world, no auth (they're the entry point for external callers).
 * The status endpoint above requires the normal /api auth.
 */
export function triggersRoutes(
  manager: TriggerManager,
  engine: WorkflowEngine,
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ triggers: manager.listStatuses() });
  });

  // Developer-friendly manual fire — treat the POST body as the context
  // the trigger would have passed. Useful in the UI "Test" button and
  // during local testing without an actual Telegram/webhook round-trip.
  router.post("/test/:workflowId", async (req, res, next) => {
    try {
      const workflowId = String(req.params.workflowId);
      const context = (req.body ?? {}) as Record<string, unknown>;
      const state = await engine.execute(workflowId, context);
      res.json({ ok: true, executionId: state.executionId, status: state.status });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

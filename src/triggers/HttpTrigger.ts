import type { Request, Response, NextFunction, Router } from "express";
import type { WorkflowDefinition } from "../types/workflow.js";
import type { TriggerHandler, TriggerRegistration, TriggerDispatch } from "./types.js";

/**
 * Registers a per-workflow HTTP endpoint under the trigger router. A POST
 * (or GET) body/query becomes the workflow's initial context.
 *
 * Paths live under the trigger router mount point (e.g., `/api/triggers/http`)
 * so callers hit `/api/triggers/http/<path-or-workflow-id>`.
 *
 * Because this handler needs the router at register-time, the caller builds
 * HttpTriggerHandler(router) once and then adds it to the TriggerManager.
 */
export function HttpTriggerHandler(router: Router): TriggerHandler {
  return {
    kind: "http",
    register(
      workflow: WorkflowDefinition,
      dispatch: TriggerDispatch,
      reportFire,
    ): TriggerRegistration | null {
      const cfg = workflow.triggers?.http;
      if (!cfg) return null;

      const rawPath = cfg.path ?? `/${workflow.id}`;
      const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
      const method = (cfg.method ?? "POST").toLowerCase() as "post" | "get";

      const handler = async (req: Request, res: Response, next: NextFunction) => {
        try {
          const context =
            method === "get"
              ? (req.query as Record<string, unknown>)
              : ((req.body ?? {}) as Record<string, unknown>);
          const result = await dispatch(workflow.id, context);
          reportFire({ executionId: result.executionId });
          res.json({ ok: true, executionId: result.executionId });
        } catch (err) {
          reportFire({ error: err as Error });
          next(err);
        }
      };

      if (method === "get") router.get(path, handler);
      else router.post(path, handler);

      return {
        workflowId: workflow.id,
        kind: "http",
        label: `${method.toUpperCase()} ${path}`,
        // Express 5 has no supported route-removal API. HTTP triggers persist
        // for the lifetime of the server; refreshWorkflow() will create a
        // duplicate route on the second registration. Acceptable trade-off
        // since the last-registered handler wins and we don't expect workflows
        // to rewire HTTP triggers at runtime often. If it becomes a problem,
        // swap to a single dynamic dispatcher route.
        stop: () => {},
      };
    },
  };
}

import { Router } from "express";
import type { WorkflowEngine } from "../../engine/Engine.js";
import type { WorkflowDefinition, WorkflowParam } from "../../types/workflow.js";
import { getToken } from "../../auth/tokenStore.js";

/**
 * Enrich an execution context by injecting stored credentials for any workflow
 * param that declares `service: X` and wasn't given a value by the caller.
 *
 * Without this, the Run Workflow dialog's "✓ Using saved credential" path
 * silently breaks: the UI stops sending the token (because it's saved), but
 * the engine runs with context[paramName] = undefined and every plugin node
 * fails with "token required". This bridges the two.
 *
 * Rules:
 * - Only injects when the param is missing/empty in the caller's context
 * - If the stored token has a userName, also injects `<paramName>_user` so
 *   nodes that want the username alongside the token can grab it
 * - Silently skips params whose service has no saved token (the plugin node
 *   will surface a clearer error than we can here)
 */
function injectServiceTokens(
  params: WorkflowParam[] | undefined,
  context: Record<string, unknown>,
): Record<string, unknown> {
  if (!params || params.length === 0) return context;
  const enriched = { ...context };
  for (const p of params) {
    if (!p.service) continue;
    const existing = enriched[p.name];
    if (existing !== undefined && existing !== "" && existing !== null) continue;
    const token = getToken(p.service);
    if (!token) continue;
    enriched[p.name] = token.accessToken;
    if (token.userName && enriched[`${p.name}_user`] === undefined) {
      enriched[`${p.name}_user`] = token.userName;
    }
  }
  return enriched;
}

export function executionRoutes(engine: WorkflowEngine): Router {
  const router = Router();

  // Start execution (async — responds as soon as execution has started,
  // client subscribes to SSE for live progress)
  router.post("/workflows/:id/execute", async (req, res, next) => {
    try {
      const rawContext = (req.body?.context as Record<string, unknown> | undefined) ?? {};

      // Look up the workflow to find its param definitions, then enrich the
      // context with stored credentials for any service-backed params the
      // caller didn't explicitly pass.
      const workflows = (engine as unknown as { workflows: Map<string, WorkflowDefinition> }).workflows;
      const workflow = workflows.get(req.params.id);
      const context = injectServiceTokens(workflow?.params, rawContext);

      let responded = false;

      // Listen for execution:start to capture the ID and respond early
      const startListener = (event: { executionId: string }) => {
        if (responded) return;
        responded = true;
        engine.off("execution:start", startListener);

        // Build a safe fallback that matches the ExecutionState shape so the UI
        // never sees a partial object. Critical: `steps` MUST be present (even
        // if empty) because the UI's stepStatuses memo runs Object.entries over
        // it on every render and crashes on undefined.
        const fallback = {
          executionId: event.executionId,
          workflowId: req.params.id,
          status: "running" as const,
          context: context,
          steps: {} as Record<string, unknown>,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        engine.getState(event.executionId).then((state) => {
          if (state) res.status(202).json(state);
          else res.status(202).json(fallback);
        }).catch(() => {
          res.status(202).json(fallback);
        });
      };
      engine.on("execution:start", startListener);

      // Kick off execution without awaiting — errors reported via events
      engine.execute(req.params.id, context).catch((err) => {
        engine.off("execution:start", startListener);
        if (!responded) {
          responded = true;
          res.status(400).json({ error: { code: "EXECUTE_FAILED", message: (err as Error).message } });
        }
      });

      // Safety timeout in case execution:start never fires (e.g., validation error)
      setTimeout(() => {
        if (!responded) {
          responded = true;
          engine.off("execution:start", startListener);
          res.status(500).json({ error: { code: "START_TIMEOUT", message: "Workflow did not start in time" } });
        }
      }, 10000);
    } catch (err) {
      next(err);
    }
  });

  // List executions
  router.get("/executions", async (req, res, next) => {
    try {
      const workflowId = req.query.workflowId as string | undefined;
      const executions = await engine.listExecutions(workflowId);
      res.json(executions);
    } catch (err) {
      next(err);
    }
  });

  // Get single execution
  router.get("/executions/:id", async (req, res, next) => {
    try {
      const state = await engine.getState(req.params.id);
      if (!state) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Execution not found: ${req.params.id}` } });
        return;
      }
      res.json(state);
    } catch (err) {
      next(err);
    }
  });

  // Resume execution
  router.post("/executions/:id/resume", async (req, res, next) => {
    try {
      const state = await engine.resume(req.params.id);
      res.json(state);
    } catch (err) {
      next(err);
    }
  });

  // Pause execution
  router.post("/executions/:id/pause", (req, res) => {
    try {
      engine.pause(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({
        error: {
          code: "PAUSE_FAILED",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  // Delete execution
  router.delete("/executions/:id", async (req, res, next) => {
    try {
      const store = (engine as any).stateStore;
      await store.delete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // SSE event stream for a specific execution
  router.get("/executions/:id/events", (req, res) => {
    const executionId = req.params.id;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const eventTypes = [
      "execution:start",
      "execution:complete",
      "execution:fail",
      "execution:pause",
      "node:start",
      "node:complete",
      "node:fail",
      "node:retry",
      "node:skip",
    ];

    const listeners: Array<{ event: string; handler: (data: unknown) => void }> = [];

    for (const eventType of eventTypes) {
      const handler = (data: unknown) => {
        const evt = data as { executionId?: string };
        if (evt.executionId !== executionId) return;
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(evt)}\n\n`);

        // Close stream when execution finishes
        if (
          eventType === "execution:complete" ||
          eventType === "execution:fail"
        ) {
          res.end();
        }
      };
      engine.on(eventType, handler);
      listeners.push({ event: eventType, handler });
    }

    req.on("close", () => {
      for (const { event, handler } of listeners) {
        engine.off(event, handler);
      }
    });
  });

  return router;
}

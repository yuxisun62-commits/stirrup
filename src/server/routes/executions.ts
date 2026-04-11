import { Router } from "express";
import type { WorkflowEngine } from "../../engine/Engine.js";

export function executionRoutes(engine: WorkflowEngine): Router {
  const router = Router();

  // Start execution (async — responds as soon as execution has started,
  // client subscribes to SSE for live progress)
  router.post("/workflows/:id/execute", async (req, res, next) => {
    try {
      const context = req.body?.context as Record<string, unknown> | undefined;
      let responded = false;

      // Listen for execution:start to capture the ID and respond early
      const startListener = (event: { executionId: string }) => {
        if (responded) return;
        responded = true;
        engine.off("execution:start", startListener);
        // Return the initial state snapshot so the client can subscribe to SSE
        engine.getState(event.executionId).then((state) => {
          if (state) res.status(202).json(state);
          else res.status(202).json({ executionId: event.executionId, status: "running" });
        }).catch(() => {
          res.status(202).json({ executionId: event.executionId, status: "running" });
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

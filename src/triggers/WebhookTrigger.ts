import type { Request, Response, Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { WorkflowDefinition } from "../types/workflow.js";
import type { TriggerHandler, TriggerRegistration, TriggerDispatch } from "./types.js";

/**
 * Shared webhook ingress at `/:source` under the router's mount point
 * (e.g. `/api/triggers/webhook/github`). Dispatches to every workflow that
 * declared `triggers.webhook.source` matching the incoming :source param.
 *
 * HMAC verification: if a workflow declares `secret`, requests without a
 * matching `X-Hub-Signature-256` (GitHub-style) or `X-Signature` header are
 * rejected for that workflow. Workflows without a secret accept anything
 * that reaches the endpoint — suitable for dev, but production webhooks
 * should always set a secret.
 *
 * Event filtering: `events: [...]` matches against `x-github-event`,
 * `x-event-type`, or `<event>.<body.action>`.
 */
export function WebhookTriggerHandler(
  router: Router,
  getWorkflows: () => Iterable<WorkflowDefinition>,
  getDispatch: () => TriggerDispatch,
  reportFireFor: (
    workflowId: string,
    result: { executionId?: string; error?: Error },
  ) => void,
): TriggerHandler {
  // The router-level handler is mounted once on the first register() call;
  // subsequent workflows share it. We track that with a module-scoped flag
  // captured in the closure.
  let mounted = false;

  function mount(): void {
    router.post("/:source", async (req: Request, res: Response) => {
      const source = String(req.params.source);
      const dispatch = getDispatch();
      const triggered: Array<{ workflowId: string; executionId?: string; error?: string }> = [];

      for (const wf of getWorkflows()) {
        const cfg = wf.triggers?.webhook;
        if (!cfg || cfg.source !== source) continue;

        if (!passesEventFilter(req, cfg.events)) continue;

        if (cfg.secret) {
          const payload = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
          const sig =
            (req.headers["x-hub-signature-256"] as string | undefined) ??
            (req.headers["x-signature"] as string | undefined);
          if (!sig || !verifyHmac(payload, cfg.secret, sig)) continue;
        }

        try {
          const result = await dispatch(wf.id, req.body as Record<string, unknown>);
          reportFireFor(wf.id, { executionId: result.executionId });
          triggered.push({ workflowId: wf.id, executionId: result.executionId });
        } catch (err) {
          reportFireFor(wf.id, { error: err as Error });
          triggered.push({ workflowId: wf.id, error: (err as Error).message });
        }
      }

      res.json({ triggered: triggered.length, results: triggered });
    });
  }

  return {
    kind: "webhook",
    register(workflow: WorkflowDefinition): TriggerRegistration | null {
      const cfg = workflow.triggers?.webhook;
      if (!cfg) return null;

      if (!mounted) {
        mount();
        mounted = true;
      }

      return {
        workflowId: workflow.id,
        kind: "webhook",
        label: `/webhook/${cfg.source}${cfg.events ? ` [${cfg.events.join(",")}]` : ""}`,
        // Per-workflow webhook registrations are effectively config entries —
        // the single mounted route re-reads the workflow list on each request.
        // Nothing per-workflow to tear down.
        stop: () => {},
      };
    },
  };
}

function passesEventFilter(req: Request, events?: string[]): boolean {
  if (!events || events.length === 0) return true;
  const rawEvent =
    (req.headers["x-github-event"] as string | undefined) ??
    (req.headers["x-event-type"] as string | undefined);
  if (!rawEvent) return false;
  const action = (req.body as { action?: string } | undefined)?.action;
  const fullEvent = action ? `${rawEvent}.${action}` : rawEvent;
  return events.some((e) => e === rawEvent || e === fullEvent);
}

function verifyHmac(payload: string, secret: string, signature: string): boolean {
  try {
    const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

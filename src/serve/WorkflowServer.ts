import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { WorkflowEngine } from "../engine/Engine.js";
import type { WorkflowDefinition } from "../types/workflow.js";

export interface ServeOptions {
  engine: WorkflowEngine;
  port?: number;
  /** If true, also exposes the UI and management API */
  withUi?: boolean;
}

export class WorkflowServer {
  private app = express();
  private engine: WorkflowEngine;
  private cronJobs: Array<{ id: string; timer: ReturnType<typeof setInterval> }> = [];

  constructor(private options: ServeOptions) {
    this.engine = options.engine;
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.text({ type: "application/x-www-form-urlencoded" }));
  }

  /** Register all workflow triggers and start listening */
  async start(): Promise<void> {
    const workflows = (this.engine as any).workflows as Map<string, WorkflowDefinition>;

    // Health check
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", workflows: workflows.size, uptime: process.uptime() });
    });

    // List available workflow endpoints
    this.app.get("/workflows", (_req, res) => {
      const list = [...workflows.values()].map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        params: wf.params,
        triggers: wf.triggers,
        endpoint: `/run/${wf.id}`,
      }));
      res.json(list);
    });

    // Universal run endpoint for any workflow
    this.app.post("/run/:workflowId", async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workflowId = String(req.params.workflowId);
        const context = req.body ?? {};
        const state = await this.engine.execute(workflowId, context);
        res.json(state);
      } catch (err) {
        next(err);
      }
    });

    // Register per-workflow HTTP triggers
    for (const [_id, wf] of workflows) {
      if (wf.triggers?.http) {
        this.registerHttpTrigger(wf);
      }
      if (wf.triggers?.webhook) {
        this.registerWebhookTrigger(wf);
      }
      if (wf.triggers?.cron) {
        this.registerCronTrigger(wf);
      }
    }

    // Generic webhook ingress
    this.app.post("/webhook/:source", async (req: Request, res: Response) => {
      const source = req.params.source;
      const results = [];

      for (const [_id, wf] of workflows) {
        if (wf.triggers?.webhook?.source !== source) continue;

        // Check event filter
        const eventHeader = req.headers["x-github-event"] ?? req.headers["x-event-type"];
        if (wf.triggers.webhook.events && eventHeader) {
          const event = String(eventHeader);
          const action = (req.body as any)?.action;
          const fullEvent = action ? `${event}.${action}` : event;
          if (!wf.triggers.webhook.events.some((e) => e === event || e === fullEvent)) {
            continue;
          }
        }

        // Verify signature if secret is set
        if (wf.triggers.webhook.secret) {
          const sig = req.headers["x-hub-signature-256"] ?? req.headers["x-signature"];
          if (!sig || !verifySignature(JSON.stringify(req.body), wf.triggers.webhook.secret, String(sig))) {
            continue;
          }
        }

        try {
          const state = await this.engine.execute(wf.id, req.body as Record<string, unknown>);
          results.push({ workflowId: wf.id, executionId: state.executionId, status: state.status });
        } catch (err) {
          results.push({ workflowId: wf.id, error: (err as Error).message });
        }
      }

      res.json({ triggered: results.length, results });
    });

    // Error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error("Server error:", err.message);
      res.status(500).json({ error: err.message });
    });

    const port = this.options.port ?? 3711;
    return new Promise((resolve) => {
      this.app.listen(port, () => {
        console.log(`\nStirrup server running on http://localhost:${port}\n`);
        console.log("Endpoints:");
        console.log(`  GET  /health           — Health check`);
        console.log(`  GET  /workflows        — List workflows & endpoints`);
        console.log(`  POST /run/:workflowId  — Run any workflow by ID\n`);

        for (const [_id, wf] of workflows) {
          if (wf.triggers?.http) {
            const path = wf.triggers.http.path ?? `/${wf.id}`;
            const method = wf.triggers.http.method ?? "POST";
            console.log(`  ${method.padEnd(5)} ${path.padEnd(25)} — ${wf.name}`);
          }
          if (wf.triggers?.webhook) {
            console.log(`  POST /webhook/${wf.triggers.webhook.source.padEnd(16)} — ${wf.name} (webhook)`);
          }
          if (wf.triggers?.cron) {
            console.log(`  CRON ${wf.triggers.cron.schedule.padEnd(24)} — ${wf.name}`);
          }
        }

        console.log();
        resolve();
      });
    });
  }

  stop(): void {
    for (const job of this.cronJobs) {
      clearInterval(job.timer);
    }
    this.cronJobs = [];
  }

  private registerHttpTrigger(wf: WorkflowDefinition): void {
    const path = wf.triggers!.http!.path ?? `/${wf.id}`;
    const method = (wf.triggers!.http!.method ?? "POST").toLowerCase();

    (this.app as any)[method](path, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const context = method === "get" ? (req.query as Record<string, unknown>) : (req.body ?? {});
        const state = await this.engine.execute(wf.id, context);
        res.json(state);
      } catch (err) {
        next(err);
      }
    });
  }

  private registerWebhookTrigger(wf: WorkflowDefinition): void {
    // Handled by the generic /webhook/:source route
  }

  private registerCronTrigger(wf: WorkflowDefinition): void {
    const cronExpr = wf.triggers!.cron!.schedule;
    const intervalMs = parseCronToInterval(cronExpr);

    if (intervalMs <= 0) {
      console.warn(`  Warning: Could not parse cron "${cronExpr}" for ${wf.id}, skipping`);
      return;
    }

    const timer = setInterval(async () => {
      console.log(`[CRON] Triggering ${wf.id} (${cronExpr})`);
      try {
        await this.engine.execute(wf.id, { _trigger: "cron", _triggeredAt: new Date().toISOString() });
      } catch (err) {
        console.error(`[CRON] Failed ${wf.id}:`, (err as Error).message);
      }
    }, intervalMs);

    this.cronJobs.push({ id: wf.id, timer });
  }
}

/** Simple cron-like interval parser (supports basic intervals) */
function parseCronToInterval(expr: string): number {
  // Handle common patterns: "*/5 * * * *" (every 5 min), "0 * * * *" (hourly), etc.
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return 0;

  const [min] = parts;

  // "*/N * * * *" — every N minutes
  const everyMinMatch = min.match(/^\*\/(\d+)$/);
  if (everyMinMatch) return parseInt(everyMinMatch[1]) * 60 * 1000;

  // "0 */N * * *" — every N hours
  if (min === "0" && parts[1].match(/^\*\/(\d+)$/)) {
    return parseInt(parts[1].match(/^\*\/(\d+)$/)![1]) * 60 * 60 * 1000;
  }

  // "0 0 * * *" — daily
  if (min === "0" && parts[1] === "0" && parts[2] === "*") {
    return 24 * 60 * 60 * 1000;
  }

  // "0 * * * *" — hourly
  if (min === "0" && parts[1] === "*") {
    return 60 * 60 * 1000;
  }

  // Fallback: treat as hourly
  return 60 * 60 * 1000;
}

function verifySignature(payload: string, secret: string, signature: string): boolean {
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

import express from "express";
import cors from "cors";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { WorkflowEngine } from "../engine/Engine.js";
import type { PluginLoader } from "../plugins/PluginLoader.js";
import type { NodeRegistry } from "../nodes/NodeRegistry.js";
import { workflowRoutes } from "./routes/workflows.js";
import { executionRoutes } from "./routes/executions.js";
import { pluginRoutes } from "./routes/plugins.js";
import { templateRoutes } from "./routes/templates.js";
import { generateRoutes } from "./routes/generate.js";
import { exportRoutes } from "./routes/export.js";
import { authRoutes } from "./routes/auth.js";
import { debugRoutes } from "./routes/debug.js";
import { importRoutes } from "./routes/import.js";
import { triggersRoutes } from "./routes/triggers.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authMiddleware, hostCheckMiddleware, csrfMiddleware } from "./middleware/auth.js";
import { TriggerManager } from "../triggers/TriggerManager.js";
import { HttpTriggerHandler } from "../triggers/HttpTrigger.js";
import { WebhookTriggerHandler } from "../triggers/WebhookTrigger.js";
import { CronTriggerHandler } from "../triggers/CronTrigger.js";
import { TelegramTriggerHandler } from "../triggers/TelegramTrigger.js";
import { Router } from "express";
import type { WorkflowDefinition } from "../types/workflow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

import type { ToolManager } from "../ai/ToolManager.js";

export interface ServerOptions {
  engine: WorkflowEngine;
  pluginLoader: PluginLoader;
  toolManager?: ToolManager;
  workflowsDir: string;
  port?: number;
  /** Exposed so callers (startServer, tests) can stop triggers on shutdown */
  onTriggerManager?: (manager: TriggerManager) => void;
}

export function createServer(options: ServerOptions) {
  const { engine, pluginLoader, workflowsDir } = options;
  const app = express();

  // Trigger subsystem. HTTP and webhook handlers register Express routes
  // on sub-routers that we mount OUTSIDE the /api auth umbrella, because
  // external services (GitHub, custom HTTP clients) hit these with no
  // Stirrup token. Auth boundary for those ingress routes is HMAC
  // (webhooks with a secret) or "anyone with the URL" (HTTP triggers).
  const triggerManager = new TriggerManager(engine);
  const httpTriggerRouter = Router();
  const webhookTriggerRouter = Router();
  triggerManager.addHandler(HttpTriggerHandler(httpTriggerRouter));
  triggerManager.addHandler(
    WebhookTriggerHandler(
      webhookTriggerRouter,
      () => (engine as unknown as { workflows: Map<string, WorkflowDefinition> }).workflows.values(),
      () => async (workflowId, context) => {
        const state = await engine.execute(workflowId, context);
        return { executionId: state.executionId };
      },
      (workflowId, result) => triggerManager.reportFireByWorkflow(workflowId, "webhook", result),
    ),
  );
  triggerManager.addHandler(CronTriggerHandler());
  triggerManager.addHandler(TelegramTriggerHandler());
  options.onTriggerManager?.(triggerManager);

  app.use(cors({ origin: process.env.STIRRUP_CORS_ORIGIN ?? "http://localhost:3710" }));
  // 10mb is generous for hand-authored workflows but necessary for imports:
  // real-world n8n exports and Make.com blueprints regularly exceed the
  // express default of 100kb (seen 259KB on a single Make scenario). Still
  // well below a DoS threshold on a localhost service.
  app.use(express.json({ limit: "10mb" }));

  // Trigger ingress routes are mounted OUTSIDE /api — they accept traffic
  // from external callers (GitHub webhooks, scheduled pings, HTTP clients)
  // that don't carry a Stirrup session token. HMAC (for webhooks with a
  // secret) and origin constraints are the real auth here.
  app.use("/triggers/http", httpTriggerRouter);
  app.use("/triggers/webhook", webhookTriggerRouter);

  // DNS rebinding protection — rejects requests with unexpected Host headers.
  // Runs before authMiddleware so it applies to health check too (except /health).
  app.use(hostCheckMiddleware);

  // Authentication
  app.use("/api", authMiddleware);

  // CSRF protection for state-changing /api/auth routes. Blocks cross-origin
  // POSTs that a malicious webpage in the user's browser could use to abuse
  // endpoints like /api/auth/cli-login (which spawns subprocesses) or
  // /api/auth/token/:service (which persists credentials).
  app.use("/api/auth", csrfMiddleware);

  // CSRF for import routes — defense in depth. The host-header check is the
  // primary barrier, but if a user sets STIRRUP_HOST to a public domain the
  // check opens up, and /api/import/* writes YAML to disk and registers
  // workflows. An Origin/Referer check is cheap insurance.
  app.use("/api/import", csrfMiddleware);

  // API routes
  app.use("/api/workflows", workflowRoutes(engine, workflowsDir, triggerManager));
  app.use("/api", executionRoutes(engine));
  app.use("/api", pluginRoutes(pluginLoader, engine.getRegistry(), options.toolManager));
  app.use("/api/templates", templateRoutes());
  app.use("/api/generate", generateRoutes());
  app.use("/api/export", exportRoutes(engine));
  app.use("/api/auth", authRoutes());
  app.use("/api/debug", debugRoutes(engine));
  app.use("/api/import", importRoutes(engine, workflowsDir));
  app.use("/api/triggers", triggersRoutes(triggerManager, engine));

  // Serve React UI static files if they exist
  const uiDistDir = resolve(__dirname, "../../src/ui/dist");
  if (existsSync(uiDistDir)) {
    app.use(express.static(uiDistDir));
    // SPA fallback: serve index.html for non-API routes
    app.get("/{*splat}", (req, res) => {
      if (!req.path.startsWith("/api")) {
        res.sendFile(resolve(uiDistDir, "index.html"));
      }
    });
  }

  app.use(errorHandler);

  return app;
}

export function startServer(options: ServerOptions): Promise<void> {
  const port = options.port ?? 3710;
  let triggerManager: TriggerManager | null = null;
  const app = createServer({
    ...options,
    onTriggerManager: (m) => {
      triggerManager = m;
      options.onTriggerManager?.(m);
    },
  });

  return new Promise((resolvePromise) => {
    app.listen(port, async () => {
      // Fire up triggers after the server is accepting connections so that
      // a cron job firing immediately on startup can reach its own /api
      // endpoints if it dispatches synchronously.
      if (triggerManager) {
        try {
          await triggerManager.start();
          const statuses = triggerManager.listStatuses();
          if (statuses.length > 0) {
            console.log(`Triggers: ${statuses.length} active`);
            for (const s of statuses) {
              console.log(`  ${s.kind.padEnd(9)} ${s.workflowId.padEnd(28)} ${s.label}`);
            }
          }
        } catch (err) {
          console.error("Trigger startup failed:", (err as Error).message);
        }
      }

      // Stop triggers cleanly on SIGINT/SIGTERM so long-pollers (Telegram)
      // release their getUpdates connections and cron tasks are cancelled.
      const shutdown = async () => {
        try { await triggerManager?.stop(); } catch { /* best-effort */ }
        process.exit(0);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);

      console.log(`Stirrup server running at http://localhost:${port}`);
      console.log(`API:  http://localhost:${port}/api`);
      console.log(`UI:   http://localhost:${port}`);
      resolvePromise();
    });
  });
}

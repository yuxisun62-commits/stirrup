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
import { errorHandler } from "./middleware/errorHandler.js";
import { authMiddleware, hostCheckMiddleware, csrfMiddleware } from "./middleware/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

import type { ToolManager } from "../ai/ToolManager.js";

export interface ServerOptions {
  engine: WorkflowEngine;
  pluginLoader: PluginLoader;
  toolManager?: ToolManager;
  workflowsDir: string;
  port?: number;
}

export function createServer(options: ServerOptions) {
  const { engine, pluginLoader, workflowsDir } = options;
  const app = express();

  app.use(cors({ origin: process.env.STIRRUP_CORS_ORIGIN ?? "http://localhost:3710" }));
  app.use(express.json());

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

  // API routes
  app.use("/api/workflows", workflowRoutes(engine, workflowsDir));
  app.use("/api", executionRoutes(engine));
  app.use("/api", pluginRoutes(pluginLoader, engine.getRegistry(), options.toolManager));
  app.use("/api/templates", templateRoutes());
  app.use("/api/generate", generateRoutes());
  app.use("/api/export", exportRoutes(engine));
  app.use("/api/auth", authRoutes());
  app.use("/api/debug", debugRoutes(engine));
  app.use("/api/import", importRoutes(engine, workflowsDir));

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
  const app = createServer(options);

  return new Promise((resolvePromise) => {
    app.listen(port, () => {
      console.log(`Stirrup server running at http://localhost:${port}`);
      console.log(`API:  http://localhost:${port}/api`);
      console.log(`UI:   http://localhost:${port}`);
      resolvePromise();
    });
  });
}

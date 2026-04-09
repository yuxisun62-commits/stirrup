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
import { errorHandler } from "./middleware/errorHandler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  engine: WorkflowEngine;
  pluginLoader: PluginLoader;
  workflowsDir: string;
  port?: number;
}

export function createServer(options: ServerOptions) {
  const { engine, pluginLoader, workflowsDir } = options;
  const app = express();

  app.use(cors());
  app.use(express.json());

  // API routes
  app.use("/api/workflows", workflowRoutes(engine, workflowsDir));
  app.use("/api", executionRoutes(engine));
  app.use("/api", pluginRoutes(pluginLoader, engine.getRegistry()));
  app.use("/api/templates", templateRoutes());

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

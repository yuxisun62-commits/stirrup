import { Router } from "express";
import type { PluginLoader } from "../../plugins/PluginLoader.js";
import type { NodeRegistry } from "../../nodes/NodeRegistry.js";

export function pluginRoutes(pluginLoader: PluginLoader, registry: NodeRegistry): Router {
  const router = Router();

  // List loaded plugins
  router.get("/plugins", (_req, res) => {
    res.json(pluginLoader.getLoadedPlugins());
  });

  // Load a plugin at runtime
  router.post("/plugins/load", async (req, res, next) => {
    const { specifier } = req.body as { specifier?: string };
    if (!specifier) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "specifier is required (npm package name or path)" } });
      return;
    }
    try {
      const info = await pluginLoader.load(specifier);
      res.status(201).json(info);
    } catch (err) {
      next(err);
    }
  });

  // List all registered node types
  router.get("/node-types", (_req, res) => {
    const builtIn = [
      "transform", "condition", "http", "script",
      "llm-prompt", "agent-tool-use", "decision-routing", "code-generation",
    ];

    const pluginTypes = pluginLoader.getLoadedPlugins().flatMap((p) => p.nodeTypes);
    const allTypes = [...new Set([...builtIn, ...pluginTypes])].filter((t) => registry.has(t));

    res.json(allTypes.map((type) => ({
      type,
      isBuiltIn: builtIn.includes(type),
      source: builtIn.includes(type)
        ? "built-in"
        : pluginLoader.getLoadedPlugins().find((p) => p.nodeTypes.includes(type))?.name ?? "plugin",
    })));
  });

  return router;
}

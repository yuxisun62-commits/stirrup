import { Router } from "express";
import type { PluginLoader } from "../../plugins/PluginLoader.js";
import type { NodeRegistry } from "../../nodes/NodeRegistry.js";

export function pluginRoutes(pluginLoader: PluginLoader, registry: NodeRegistry): Router {
  const router = Router();

  // List plugins
  router.get("/plugins", (_req, res) => {
    res.json(pluginLoader.getLoadedPlugins());
  });

  // List all registered node types
  router.get("/node-types", (_req, res) => {
    const builtIn = [
      "transform", "condition", "http", "script",
      "llm-prompt", "agent-tool-use", "decision-routing", "code-generation",
    ];

    const pluginTypes = pluginLoader.getLoadedPlugins().flatMap((p) => p.nodeTypes);

    const allTypes = [...builtIn, ...pluginTypes].filter((t) => registry.has(t));
    res.json(allTypes.map((type) => ({ type, isBuiltIn: builtIn.includes(type) })));
  });

  return router;
}

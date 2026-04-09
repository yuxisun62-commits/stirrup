import { Router } from "express";
import type { PluginLoader } from "../../plugins/PluginLoader.js";
import type { NodeRegistry } from "../../nodes/NodeRegistry.js";
import { BUILTIN_PLUGINS, loadBuiltinPlugin } from "../../plugins/builtins.js";
import type { ToolManager } from "../../ai/ToolManager.js";

export function pluginRoutes(pluginLoader: PluginLoader, registry: NodeRegistry, toolManager?: ToolManager): Router {
  const router = Router();

  // List loaded plugins
  router.get("/plugins", (_req, res) => {
    res.json(pluginLoader.getLoadedPlugins());
  });

  // List all available built-in plugins (loaded + available for install)
  router.get("/plugins/catalog", (_req, res) => {
    const loaded = pluginLoader.getLoadedPlugins();
    const loadedNames = new Set(loaded.map((p) => p.name));

    const catalog = BUILTIN_PLUGINS.map((p) => ({
      name: p.name,
      description: p.description,
      category: p.category,
      isLoaded: loadedNames.has(p.name) || registry.has(p.name === 'github' ? 'github-get-pr' : `${p.name}-query`),
      requiresInstall: !!p.peerDep,
      peerDep: p.peerDep,
      installHint: p.installHint,
      nodeTypes: loaded.find((l) => l.name === p.name)?.nodeTypes ?? [],
      tools: loaded.find((l) => l.name === p.name)?.tools ?? [],
    }));

    // Check which are actually loaded by looking at registered node types
    for (const item of catalog) {
      if (!item.isLoaded) {
        // Check if any of the plugin's expected node types are registered
        const prefixes = [`${item.name}-`, `${item.name.substring(0, 2)}-`];
        item.isLoaded = [...(pluginLoader.getLoadedPlugins())]
          .some((p) => p.name === item.name);
      }
    }

    res.json(catalog);
  });

  // Load a plugin at runtime
  router.post("/plugins/load", async (req, res, next) => {
    const { specifier } = req.body as { specifier?: string };
    if (!specifier) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "specifier is required" } });
      return;
    }

    // Check if it's a built-in plugin name
    const builtin = BUILTIN_PLUGINS.find((p) => p.name === specifier);
    if (builtin && toolManager) {
      try {
        const info = await loadBuiltinPlugin(specifier, registry, toolManager);
        if (info) {
          (pluginLoader as any).plugins?.push(info);
          res.status(201).json(info);
          return;
        }
      } catch (err) {
        res.status(500).json({
          error: {
            code: "LOAD_FAILED",
            message: (err as Error).message,
            hint: builtin.installHint ? `Install dependency: ${builtin.installHint}` : undefined,
          },
        });
        return;
      }
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

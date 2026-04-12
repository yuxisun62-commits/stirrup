import { Router } from "express";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * In-memory cache for parsed templates. Without it, every template list or
 * lookup re-scans all three candidate directories and YAML-parses every
 * file from disk — a DoS surface for anyone who can hit the route.
 * 60-second TTL is plenty: users rarely edit templates at runtime, and the
 * cache invalidates on its own between app restarts.
 */
interface CachedTemplate {
  id: string;
  content: Record<string, unknown>;
}
interface TemplateCache {
  templates: CachedTemplate[];
  cachedAt: number;
}
const TEMPLATE_CACHE_TTL_MS = 60 * 1000;
let templateCache: TemplateCache | null = null;

function loadAllTemplates(): CachedTemplate[] {
  if (templateCache && Date.now() - templateCache.cachedAt < TEMPLATE_CACHE_TTL_MS) {
    return templateCache.templates;
  }

  const templateDirs = [
    resolve(__dirname, "../../../templates"),
    resolve(__dirname, "../../../../templates"),
    resolve(process.cwd(), "templates"),
  ];

  const results: CachedTemplate[] = [];
  const seen = new Set<string>();

  for (const dir of templateDirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of files) {
      try {
        const content = parseYaml(readFileSync(resolve(dir, file), "utf-8")) as Record<string, unknown>;
        const id = (content.id as string | undefined) ?? file.replace(/\.ya?ml$/, "");
        if (seen.has(id)) continue;
        seen.add(id);
        results.push({ id, content });
      } catch {
        // Skip invalid files — next request will retry after cache TTL
      }
    }
  }

  templateCache = { templates: results, cachedAt: Date.now() };
  return results;
}

export function templateRoutes(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const templates: Array<{
      id: string;
      name: string;
      description: string;
      nodeCount: number;
      edgeCount: number;
      nodeTypes: string[];
      category: string;
    }> = [];

    for (const { id, content } of loadAllTemplates()) {
      const nodes = (content.nodes as Array<{ type: string }> | undefined) ?? [];
      const nodeTypes = [...new Set(nodes.map((n) => n.type))];
      const hasAi = nodeTypes.some((t) => ["llm-prompt", "agent-tool-use", "decision-routing", "code-generation"].includes(t));
      templates.push({
        id,
        name: (content.name as string | undefined) ?? id,
        description: (content.description as string | undefined) ?? "",
        nodeCount: nodes.length,
        edgeCount: ((content.edges as unknown[] | undefined) ?? []).length,
        nodeTypes,
        category: hasAi ? "ai" : "deterministic",
      });
    }

    res.json(templates);
  });

  router.get("/:id", (req, res) => {
    const match = loadAllTemplates().find((t) => t.id === req.params.id);
    if (!match) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Template not found: ${req.params.id}` } });
      return;
    }
    res.json(match.content);
  });

  return router;
}

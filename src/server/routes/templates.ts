import { Router } from "express";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

    const templateDirs = [
      resolve(__dirname, "../../../templates"),
      resolve(__dirname, "../../../../templates"),
      resolve(process.cwd(), "templates"),
    ];

    const seen = new Set<string>();

    for (const dir of templateDirs) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
      for (const file of files) {
        try {
          const content = parseYaml(readFileSync(resolve(dir, file), "utf-8"));
          const id = content.id ?? file.replace(/\.ya?ml$/, "");
          if (seen.has(id)) continue;
          seen.add(id);

          const nodes = content.nodes ?? [];
          const nodeTypes = [...new Set(nodes.map((n: { type: string }) => n.type))] as string[];
          const hasAi = nodeTypes.some((t: string) => ["llm-prompt", "agent-tool-use", "decision-routing", "code-generation"].includes(t));

          templates.push({
            id,
            name: content.name ?? id,
            description: content.description ?? "",
            nodeCount: nodes.length,
            edgeCount: (content.edges ?? []).length,
            nodeTypes,
            category: hasAi ? "ai" : "deterministic",
          });
        } catch {
          // Skip invalid files
        }
      }
    }

    res.json(templates);
  });

  router.get("/:id", (req, res) => {
    const templateDirs = [
      resolve(__dirname, "../../../templates"),
      resolve(__dirname, "../../../../templates"),
      resolve(process.cwd(), "templates"),
    ];

    for (const dir of templateDirs) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
      for (const file of files) {
        try {
          const content = parseYaml(readFileSync(resolve(dir, file), "utf-8"));
          if (content.id === req.params.id) {
            res.json(content);
            return;
          }
        } catch {
          continue;
        }
      }
    }

    res.status(404).json({ error: { code: "NOT_FOUND", message: `Template not found: ${req.params.id}` } });
  });

  return router;
}

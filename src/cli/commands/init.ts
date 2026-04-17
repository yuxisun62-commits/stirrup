import type { CommandModule } from "yargs";
import { resolve, dirname } from "node:path";
import { writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { input, select } from "@inquirer/prompts";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import { loadConfig } from "../config.js";
import { success, error } from "../output.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TemplateInfo {
  value: string;
  name: string;
  file?: string;
}

const BUILT_IN_TEMPLATES: Record<string, { nodes: unknown[]; edges: unknown[] }> = {
  blank: {
    nodes: [
      { id: "start", type: "transform", name: "Start", inputs: [], outputs: ["result"], config: { expression: '({ result: "hello" })' } },
    ],
    edges: [],
  },
  linear: {
    nodes: [
      { id: "step-1", type: "transform", name: "Step 1", inputs: [], outputs: ["value"], config: { expression: "({ value: 1 })" } },
      { id: "step-2", type: "transform", name: "Step 2", inputs: [{ from: "nodes.step-1.outputs.value", to: "x" }], outputs: ["value"], config: { expression: "({ value: inputs.x + 1 })" } },
      { id: "step-3", type: "transform", name: "Step 3", inputs: [{ from: "nodes.step-2.outputs.value", to: "x" }], outputs: ["result"], config: { expression: '({ result: "Final: " + inputs.x })' } },
    ],
    edges: [{ from: "step-1", to: "step-2" }, { from: "step-2", to: "step-3" }],
  },
  branching: {
    nodes: [
      { id: "input", type: "transform", name: "Input", inputs: [], outputs: ["value"], config: { expression: "({ value: 42 })" } },
      { id: "decide", type: "condition", name: "Check Value", inputs: [{ from: "nodes.input.outputs.value", to: "v" }], outputs: ["selectedBranch"], config: { expression: "inputs.v > 50 ? 'high' : 'low'" }, branches: { high: ["high-path"], low: ["low-path"] } },
      { id: "high-path", type: "transform", name: "High Path", inputs: [{ from: "nodes.input.outputs.value", to: "v" }], outputs: ["result"], config: { expression: '({ result: "HIGH: " + inputs.v })' } },
      { id: "low-path", type: "transform", name: "Low Path", inputs: [{ from: "nodes.input.outputs.value", to: "v" }], outputs: ["result"], config: { expression: '({ result: "LOW: " + inputs.v })' } },
    ],
    edges: [{ from: "input", to: "decide" }, { from: "decide", to: "high-path", condition: "high" }, { from: "decide", to: "low-path", condition: "low" }],
  },
};

function loadFileTemplates(): TemplateInfo[] {
  // Look for templates in the package's templates/ directory
  const templateDirs = [
    resolve(__dirname, "../../../templates"),       // from dist/cli/commands/
    resolve(__dirname, "../../../../templates"),     // fallback
    resolve(process.cwd(), "templates"),             // local project templates
  ];

  const templates: TemplateInfo[] = [];
  const seen = new Set<string>();

  for (const dir of templateDirs) {
    // Isolate per-dir failures (Windows EPERM on home-dir junctions, etc.)
    // so one unreadable candidate doesn't hide the packaged templates.
    let files: string[];
    try {
      if (!existsSync(dir)) continue;
      const s = statSync(dir);
      if (!s.isDirectory()) continue;
      files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    } catch {
      continue;
    }
    for (const file of files) {
      const filePath = resolve(dir, file);
      try {
        const content = yamlParse(readFileSync(filePath, "utf-8"));
        const key = content.id ?? file.replace(/\.ya?ml$/, "");
        if (seen.has(key)) continue;
        seen.add(key);
        templates.push({
          value: `file:${filePath}`,
          name: `${content.name ?? key} — ${content.description ?? `${content.nodes?.length ?? 0} nodes`}`,
          file: filePath,
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return templates;
}

export const initCommand: CommandModule = {
  command: "init",
  describe: "Interactively scaffold a new workflow file",
  handler: async (argv) => {
    const config = loadConfig({
      workflowsDir: (argv as Record<string, string>)["workflows-dir"],
    });

    const fileTemplates = loadFileTemplates();

    const basicChoices: Array<{ value: string; name: string }> = [
      { value: "blank", name: "Blank — single start node" },
      { value: "linear", name: "Linear — 3-step pipeline" },
      { value: "branching", name: "Branching — conditional paths" },
    ];

    const templateChoices = fileTemplates.length > 0
      ? [
        ...basicChoices,
        { value: "---", name: "── Workflow Templates ──" },
        ...fileTemplates,
      ]
      : basicChoices;

    const template = await select({
      message: "Starter template:",
      choices: templateChoices,
    });

    if (template === "---") {
      error("Please select a template, not the separator");
      process.exit(1);
    }

    let workflow: Record<string, unknown>;

    if (typeof template === "string" && template.startsWith("file:")) {
      // Load from file template
      const filePath = template.slice(5);
      workflow = yamlParse(readFileSync(filePath, "utf-8"));

      // Let the user customize id and name
      const id = await input({ message: "Workflow ID:", default: workflow.id as string });
      const name = await input({ message: "Workflow name:", default: workflow.name as string });
      workflow.id = id;
      workflow.name = name;
    } else {
      // Built-in template
      const id = await input({ message: "Workflow ID:", default: "my-workflow" });
      const name = await input({ message: "Workflow name:", default: "My Workflow" });
      workflow = {
        id,
        name,
        version: "1.0",
        ...(BUILT_IN_TEMPLATES[template as string] ?? BUILT_IN_TEMPLATES.blank),
      };
    }

    const fileName = `${workflow.id}.yaml`;
    const filePath = resolve(config.workflowsDir, fileName);

    if (existsSync(filePath)) {
      error(`File already exists: ${filePath}`);
      process.exit(1);
    }

    writeFileSync(filePath, yamlStringify(workflow), "utf-8");
    success(`Created workflow: ${filePath}`);
  },
};

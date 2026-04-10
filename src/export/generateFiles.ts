import { stringify as yamlStringify } from "yaml";
import type { WorkflowDefinition } from "../types/workflow.js";

export interface ExportFile {
  path: string;
  content: string;
}

export interface ExportOptions {
  format?: "node" | "docker";
}

/**
 * Generate all files needed to export a workflow as a standalone deployable project.
 * Returns an array of { path, content } to be written to disk or zipped.
 */
export function generateExportFiles(workflow: WorkflowDefinition, options: ExportOptions = {}): ExportFile[] {
  const format = options.format ?? "node";
  const files: ExportFile[] = [];

  // workflow YAML
  files.push({
    path: `workflows/${workflow.id}.yaml`,
    content: yamlStringify(workflow),
  });

  // package.json
  files.push({
    path: "package.json",
    content: JSON.stringify(
      {
        name: `workflow-${workflow.id}`,
        version: "1.0.0",
        description: workflow.description ?? `Workflow service: ${workflow.name}`,
        type: "module",
        scripts: {
          start: "node server.js",
          dev: "node --watch server.js",
        },
        dependencies: {
          "stirrup-ai": "^0.2.0",
          "express": "^5.0.0",
        },
      },
      null,
      2
    ),
  });

  // server.js
  const paramDocs = (workflow.params ?? [])
    .map((p) => `//   ${p.name} (${p.type}${p.required ? ", required" : ""})${p.description ? ` — ${p.description}` : ""}`)
    .join("\n");

  files.push({
    path: "server.js",
    content: `import { WorkflowEngine, SqliteStateStore } from "stirrup-ai";
import { transformHandler, conditionHandler, httpHandler, scriptHandler } from "stirrup-ai";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;

const engine = new WorkflowEngine({
  definitionsDir: resolve(__dirname, "workflows"),
  stateStore: new SqliteStateStore(resolve(__dirname, "state.db")),
});

const registry = engine.getRegistry();
registry.register("transform", transformHandler);
registry.register("condition", conditionHandler);
registry.register("http", httpHandler);
registry.register("script", scriptHandler);

// For AI nodes, set ANTHROPIC_API_KEY and add:
// import { AnthropicProvider, createLlmPromptHandler } from "stirrup-ai";
// const provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
// registry.register("llm-prompt", createLlmPromptHandler(provider));

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", workflow: "${workflow.id}" });
});

// Workflow parameters:
${paramDocs || "//   (none declared)"}

app.post("/run", async (req, res) => {
  try {
    const state = await engine.execute("${workflow.id}", req.body ?? {});
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/status/:executionId", async (req, res) => {
  const state = await engine.getState(req.params.executionId);
  if (!state) { res.status(404).json({ error: "Execution not found" }); return; }
  res.json(state);
});

app.listen(PORT, () => {
  console.log(\`Workflow service running on http://localhost:\${PORT}\`);
});
`,
  });

  // .env.example
  const envVars = ["PORT=3000", "ANTHROPIC_API_KEY=your-api-key-here"];
  if (workflow.params) {
    for (const p of workflow.params) {
      if (p.name === "token" || p.name.toLowerCase().includes("key") || p.name.toLowerCase().includes("secret")) {
        envVars.push(`${p.name.toUpperCase()}=your-${p.name}-here`);
      }
    }
  }
  files.push({ path: ".env.example", content: envVars.join("\n") + "\n" });

  // .gitignore
  files.push({ path: ".gitignore", content: "node_modules/\nstate.db\n.env\n" });

  // README.md
  const readmeParams = (workflow.params ?? [])
    .map((p) => `| \`${p.name}\` | ${p.type} | ${p.required ? "Yes" : "No"} | ${p.default !== undefined ? String(p.default) : "-"} | ${p.description ?? ""} |`)
    .join("\n");

  files.push({
    path: "README.md",
    content: `# ${workflow.name}

${workflow.description ?? ""}

## Setup

\`\`\`bash
npm install
cp .env.example .env
# Edit .env with your API keys
npm start
\`\`\`

## API

### POST /run
Execute the workflow with parameters.

${workflow.params && workflow.params.length > 0 ? `| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
${readmeParams}` : "No parameters declared."}

### GET /status/:executionId
Check the status of a running or completed execution.

## Example

\`\`\`bash
curl -X POST http://localhost:3000/run \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(
    Object.fromEntries(
      (workflow.params ?? [])
        .filter((p) => p.required)
        .map((p) => [p.name, p.default ?? (p.type === "number" ? 0 : p.type === "boolean" ? false : "value")])
    )
  )}'
\`\`\`
`,
  });

  // Dockerfile (always include for docker format, optional info for node)
  if (format === "docker") {
    files.push({
      path: "Dockerfile",
      content: `FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
`,
    });
    files.push({
      path: ".dockerignore",
      content: "node_modules\n.env\nstate.db\n.git\n",
    });
  }

  return files;
}

import type { CommandModule } from "yargs";
import { resolve, basename, dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadWorkflowFile } from "../../loader/WorkflowLoader.js";
import { success, error, info } from "../output.js";

/**
 * Read the host stirrup-ai version so the exported project pins against
 * the one that generated it. Falls back to "latest" when we can't find
 * our own package.json (tests / dev builds under unusual layouts).
 */
function currentStirrupVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // Walk up looking for package.json with name "stirrup-ai".
    for (let dir = here, prev = ""; dir !== prev; prev = dir, dir = dirname(dir)) {
      const candidate = resolve(dir, "package.json");
      if (!existsSync(candidate)) continue;
      const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as { name?: string; version?: string };
      if (pkg.name === "stirrup-ai" && pkg.version) return `^${pkg.version}`;
    }
  } catch { /* fall through */ }
  return "latest";
}

interface ExportArgs {
  workflow: string;
  output: string;
  format?: string;
}

export const exportCommand: CommandModule<{}, ExportArgs> = {
  command: "export <workflow>",
  describe: "Export a workflow as a standalone deployable project",
  builder: (yargs) =>
    yargs
      .positional("workflow", {
        type: "string",
        describe: "Path to workflow YAML file",
        demandOption: true,
      })
      .option("output", {
        alias: "o",
        type: "string",
        default: "./exported",
        describe: "Output directory",
      })
      .option("format", {
        type: "string",
        default: "node",
        choices: ["node", "docker"],
        describe: "Export format",
      }),
  handler: (argv) => {
    const wfPath = resolve(argv.workflow);
    if (!existsSync(wfPath)) {
      error(`File not found: ${wfPath}`);
      process.exit(1);
    }

    const workflow = loadWorkflowFile(wfPath);
    const outDir = resolve(argv.output, workflow.id);

    if (existsSync(outDir)) {
      error(`Output directory already exists: ${outDir}`);
      process.exit(1);
    }

    mkdirSync(outDir, { recursive: true });
    mkdirSync(resolve(outDir, "workflows"), { recursive: true });

    // Copy the workflow file
    copyFileSync(wfPath, resolve(outDir, "workflows", basename(wfPath)));

    // Generate package.json
    writeFileSync(
      resolve(outDir, "package.json"),
      JSON.stringify(
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
            // The npm package name is `stirrup-ai` — the generated server
            // imports from it below. Pinning to the CURRENT stirrup-ai
            // version prevents drift between the generator and the
            // deployed runtime, and rules out the old "ReferenceError:
            // require is not defined" failure caused by accidentally
            // installing an unrelated `stirrup` package.
            "stirrup-ai": currentStirrupVersion(),
            // server.js uses Express directly; it's a peer of stirrup-ai
            // for the exported project so we must list it ourselves.
            "express": "^5.2.1",
          },
        },
        null,
        2
      )
    );

    // Generate server entry point
    const paramDocs = (workflow.params ?? [])
      .map((p) => `//   ${p.name} (${p.type}${p.required ? ", required" : ""})${p.description ? ` — ${p.description}` : ""}`)
      .join("\n");

    const serverCode = `import { WorkflowEngine, SqliteStateStore, NodeRegistry } from "stirrup-ai";
import { transformHandler, conditionHandler, httpHandler, scriptHandler } from "stirrup-ai";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;

// Initialize the workflow engine
const engine = new WorkflowEngine({
  definitionsDir: resolve(__dirname, "workflows"),
  stateStore: new SqliteStateStore(resolve(__dirname, "state.db")),
});

// Register built-in node handlers
const registry = engine.getRegistry();
registry.register("transform", transformHandler);
registry.register("condition", conditionHandler);
registry.register("http", httpHandler);
registry.register("script", scriptHandler);

// NOTE: For AI nodes, add:
// import { AnthropicProvider, createLlmPromptHandler, ... } from "stirrup-ai";
// const provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
// registry.register("llm-prompt", createLlmPromptHandler(provider));

// Create HTTP server
const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", workflow: "${workflow.id}" });
});

// Workflow parameters:
${paramDocs || "//   (none declared)"}

// Run the workflow
app.post("/run", async (req, res) => {
  try {
    const context = req.body ?? {};
    const state = await engine.execute("${workflow.id}", context);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get execution status
app.get("/status/:executionId", async (req, res) => {
  const state = await engine.getState(req.params.executionId);
  if (!state) {
    res.status(404).json({ error: "Execution not found" });
    return;
  }
  res.json(state);
});

app.listen(PORT, () => {
  console.log(\`Workflow service running on http://localhost:\${PORT}\`);
  console.log(\`  POST /run    — Execute the workflow\`);
  console.log(\`  GET  /status/:id — Check execution status\`);
});
`;

    writeFileSync(resolve(outDir, "server.js"), serverCode);

    // Generate .env.example
    const envVars = ["PORT=3000", "ANTHROPIC_API_KEY=your-api-key-here"];
    if (workflow.params) {
      for (const p of workflow.params) {
        if (p.name === "token" || p.name.toLowerCase().includes("key") || p.name.toLowerCase().includes("secret")) {
          envVars.push(`${p.name.toUpperCase()}=your-${p.name}-here`);
        }
      }
    }
    writeFileSync(resolve(outDir, ".env.example"), envVars.join("\n") + "\n");

    // Generate .gitignore
    writeFileSync(resolve(outDir, ".gitignore"), "node_modules/\nstate.db\n.env\n");

    // Generate README
    const readmeParams = (workflow.params ?? [])
      .map((p) => `| \`${p.name}\` | ${p.type} | ${p.required ? "Yes" : "No"} | ${p.default !== undefined ? String(p.default) : "-"} | ${p.description ?? ""} |`)
      .join("\n");

    writeFileSync(
      resolve(outDir, "README.md"),
      `# ${workflow.name}

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
`
    );

    // Docker support
    if (argv.format === "docker") {
      writeFileSync(
        resolve(outDir, "Dockerfile"),
        `FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
`
      );
    }

    success(`Exported workflow to: ${outDir}`);
    info(`  Files created:`);
    info(`    package.json   — Dependencies and scripts`);
    info(`    server.js      — Express server with /run and /status endpoints`);
    info(`    workflows/     — Workflow definition`);
    info(`    .env.example   — Environment variables template`);
    info(`    README.md      — API documentation`);
    if (argv.format === "docker") {
      info(`    Dockerfile     — Docker container config`);
    }
    info(`\n  To deploy:`);
    info(`    cd ${outDir}`);
    info(`    npm install`);
    info(`    npm start`);
  },
};

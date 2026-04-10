import { WorkflowEngine, SqliteStateStore, NodeRegistry } from "stirrup";
import { transformHandler, conditionHandler, httpHandler, scriptHandler } from "stirrup";
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
// import { AnthropicProvider, createLlmPromptHandler, ... } from "stirrup";
// const provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
// registry.register("llm-prompt", createLlmPromptHandler(provider));

// Create HTTP server
const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", workflow: "content-pipeline-mnrzyegw" });
});

// Workflow parameters:
//   topic (string, required) — The topic to write about
//   audience (string, required) — Target audience
//   tone (string) — Writing tone/style

// Run the workflow
app.post("/run", async (req, res) => {
  try {
    const context = req.body ?? {};
    const state = await engine.execute("content-pipeline-mnrzyegw", context);
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
  console.log(`Workflow service running on http://localhost:${PORT}`);
  console.log(`  POST /run    — Execute the workflow`);
  console.log(`  GET  /status/:id — Check execution status`);
});

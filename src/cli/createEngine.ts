import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { WorkflowEngine } from "../engine/Engine.js";
import { SqliteStateStore } from "../persistence/SqliteStateStore.js";
import { FileStateStore } from "../persistence/FileStateStore.js";
import { transformHandler } from "../nodes/TransformNode.js";
import { conditionHandler } from "../nodes/ConditionNode.js";
import { httpHandler } from "../nodes/HttpNode.js";
import { scriptHandler } from "../nodes/ScriptNode.js";
import { AnthropicProvider } from "../ai/AnthropicProvider.js";
import { ToolManager } from "../ai/ToolManager.js";
import { createLlmPromptHandler } from "../nodes/LlmPromptNode.js";
import { createAgentToolUseHandler } from "../nodes/AgentToolUseNode.js";
import { createDecisionRoutingHandler } from "../nodes/DecisionRoutingNode.js";
import { createCodeGenerationHandler } from "../nodes/CodeGenerationNode.js";
import { loadBuiltinPlugins } from "../plugins/builtins.js";
import type { AppConfig } from "./config.js";

export interface CreateEngineResult {
  engine: WorkflowEngine;
  toolManager: ToolManager;
}

export async function createEngine(config: AppConfig): Promise<CreateEngineResult> {
  const workflowsDir = resolve(config.workflowsDir);
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
  }

  const stateStore =
    config.store === "sqlite"
      ? new SqliteStateStore(resolve(config.dbPath))
      : new FileStateStore(resolve(config.stateDir));

  const engine = new WorkflowEngine({
    definitionsDir: workflowsDir,
    stateStore,
  });

  const registry = engine.getRegistry();
  const toolManager = new ToolManager();

  // Core deterministic node handlers
  registry.register("transform", transformHandler);
  registry.register("condition", conditionHandler);
  registry.register("http", httpHandler);
  registry.register("script", scriptHandler);

  // AI node handlers — check env var first, then fall back to the token store
  // (the user may have saved the key via the Connections panel instead of
  // setting an env var).
  let anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    try {
      const { getToken } = await import("../auth/tokenStore.js");
      const stored = getToken("anthropic");
      if (stored) anthropicApiKey = stored.accessToken;
    } catch { /* token store not available */ }
  }
  if (anthropicApiKey) {
    const provider = new AnthropicProvider(anthropicApiKey);
    registry.register("llm-prompt", createLlmPromptHandler(provider));
    registry.register("agent-tool-use", createAgentToolUseHandler(provider, toolManager));
    registry.register("decision-routing", createDecisionRoutingHandler(provider));
    registry.register("code-generation", createCodeGenerationHandler(provider));
  }

  // Auto-load built-in plugins (zero-dep ones load immediately, peer-dep on demand)
  await loadBuiltinPlugins(registry, toolManager, { verbose: config.verbose });

  return { engine, toolManager };
}

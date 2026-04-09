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
import type { AppConfig } from "./config.js";

export function createEngine(config: AppConfig): WorkflowEngine {
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

  // Deterministic node handlers
  registry.register("transform", transformHandler);
  registry.register("condition", conditionHandler);
  registry.register("http", httpHandler);
  registry.register("script", scriptHandler);

  // AI node handlers (only if ANTHROPIC_API_KEY is available)
  if (process.env.ANTHROPIC_API_KEY) {
    const provider = new AnthropicProvider();
    const toolManager = new ToolManager();
    registry.register("llm-prompt", createLlmPromptHandler(provider));
    registry.register("agent-tool-use", createAgentToolUseHandler(provider, toolManager));
    registry.register("decision-routing", createDecisionRoutingHandler(provider));
    registry.register("code-generation", createCodeGenerationHandler(provider));
  }

  return engine;
}

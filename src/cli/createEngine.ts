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
import { GeminiProvider } from "../ai/GeminiProvider.js";
import { ProviderRouter } from "../ai/ProviderRouter.js";
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

  // ── AI providers ──────────────────────────────────────────────────
  // Check env vars first, then fall back to the token store (the user
  // may have saved the key via the Connections panel).

  let anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    try {
      const { getToken } = await import("../auth/tokenStore.js");
      const stored = getToken("anthropic");
      if (stored) anthropicApiKey = stored.accessToken;
    } catch { /* token store not available */ }
  }

  // Only honor GEMINI_API_KEY — GOOGLE_API_KEY is commonly set for unrelated
  // Google services (Maps, Cloud) and silently pulling it in would cause
  // scoped keys to hit the wrong endpoint.
  let geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    try {
      const { getToken } = await import("../auth/tokenStore.js");
      const stored = getToken("gemini");
      if (stored) geminiApiKey = stored.accessToken;
    } catch { /* token store not available */ }
  }

  // Build the provider router — routes by model prefix (gemini-*, claude-*)
  // At least one provider must be available for AI nodes to register.
  const hasAnyProvider = !!(anthropicApiKey || geminiApiKey);

  if (hasAnyProvider) {
    // Default provider is Anthropic if available, otherwise Gemini
    const anthropic = anthropicApiKey ? new AnthropicProvider(anthropicApiKey) : null;
    const gemini = geminiApiKey ? new GeminiProvider(geminiApiKey) : null;

    const router = new ProviderRouter(anthropic ?? gemini!);
    if (anthropic) router.register("claude", anthropic);
    if (gemini) router.register("gemini", gemini);

    registry.register("llm-prompt", createLlmPromptHandler(router));
    registry.register("agent-tool-use", createAgentToolUseHandler(router, toolManager));
    registry.register("decision-routing", createDecisionRoutingHandler(router));
    registry.register("code-generation", createCodeGenerationHandler(router));
  }

  // Auto-load built-in plugins (zero-dep ones load immediately, peer-dep on demand)
  await loadBuiltinPlugins(registry, toolManager, { verbose: config.verbose });

  return { engine, toolManager };
}

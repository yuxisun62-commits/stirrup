import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { WorkflowEngine } from "../engine/Engine.js";
import { SqliteStateStore } from "../persistence/SqliteStateStore.js";
import { FileStateStore } from "../persistence/FileStateStore.js";
import { transformHandler } from "../nodes/TransformNode.js";
import { conditionHandler } from "../nodes/ConditionNode.js";
import { passthroughHandler } from "../nodes/PassthroughNode.js";
import { failHandler } from "../nodes/FailNode.js";
import { httpHandler } from "../nodes/HttpNode.js";
import { scriptHandler } from "../nodes/ScriptNode.js";
import { createIterateHandler } from "../nodes/IterateNode.js";
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
  registry.register("passthrough", passthroughHandler);
  registry.register("fail", failHandler);
  // Iterate needs the registry itself so it can dispatch to child node types
  registry.register("iterate", createIterateHandler(registry));

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
  } else {
    // No AI provider configured. Register stub handlers so that running a
    // workflow with AI nodes fails with an actionable message at the node
    // level ("set ANTHROPIC_API_KEY or connect via Connections panel")
    // instead of the cryptic "No handler registered for node type"
    // engine-level error — which hides the real cause of "I have no API key".
    if (config.verbose) {
      console.log("  [ai] no provider configured — set ANTHROPIC_API_KEY or GEMINI_API_KEY, or connect via the UI Connections panel");
    }
    const missingProviderError = () => {
      throw new Error(
        "No AI provider configured. Set ANTHROPIC_API_KEY or GEMINI_API_KEY " +
        "in your environment, or connect a provider in the Connections panel of the UI."
      );
    };
    registry.register("llm-prompt", missingProviderError);
    registry.register("agent-tool-use", missingProviderError);
    registry.register("decision-routing", missingProviderError);
    registry.register("code-generation", missingProviderError);
  }

  // Auto-load built-in plugins (zero-dep ones load immediately, peer-dep on demand)
  await loadBuiltinPlugins(registry, toolManager, { verbose: config.verbose });

  return { engine, toolManager };
}

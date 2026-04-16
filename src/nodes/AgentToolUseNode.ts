import type { NodeHandler } from "./NodeRegistry.js";
import type { AgentToolUseConfig } from "../types/nodes.js";
import type { AIProvider, AIMessage, AIContentBlock } from "../ai/AIProvider.js";
import type { ToolManager } from "../ai/ToolManager.js";
import { renderTemplate } from "../ai/PromptTemplate.js";

export function createAgentToolUseHandler(
  provider: AIProvider,
  toolManager: ToolManager
): NodeHandler {
  return async (config, ctx) => {
    const cfg = config as unknown as AgentToolUseConfig;
    const task = renderTemplate(cfg.taskTemplate, ctx.inputs);
    const maxIterations = cfg.maxIterations ?? 10;
    const tools = toolManager.getToolDefs(cfg.tools);

    const messages: AIMessage[] = [
      { role: "user", content: task },
    ];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await provider.createMessage({
        model: cfg.model,
        system: cfg.systemPrompt,
        messages,
        maxTokens: cfg.maxTokens,
        tools,
      });

      // Check for tool use blocks
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use") as
        Array<{ type: "tool_use"; id: string; name: string; input: Record<string, unknown> }>;

      if (toolUseBlocks.length === 0 || response.stopReason === "end_turn") {
        // No more tool calls — extract final text response
        const textBlocks = response.content.filter((b) => b.type === "text") as
          Array<{ type: "text"; text: string }>;
        const finalText = textBlocks.map((b) => b.text).join("");
        return { response: finalText, iterations: iteration + 1 };
      }

      // Add assistant response to conversation
      messages.push({ role: "assistant", content: response.content });

      // Execute each tool call and collect results
      const toolResults: AIContentBlock[] = [];
      for (const block of toolUseBlocks) {
        try {
          const result = await toolManager.execute(
            block.name,
            block.input,
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: typeof result === "string" ? result : JSON.stringify(result),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    throw new Error(`Agent exceeded max iterations (${maxIterations})`);
  };
}

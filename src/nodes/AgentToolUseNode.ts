import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import type { NodeHandler } from "./NodeRegistry.js";
import type { AgentToolUseConfig } from "../types/nodes.js";
import type { AnthropicProvider } from "../ai/AnthropicProvider.js";
import type { ToolManager } from "../ai/ToolManager.js";
import { renderTemplate } from "../ai/PromptTemplate.js";

export function createAgentToolUseHandler(
  provider: AnthropicProvider,
  toolManager: ToolManager
): NodeHandler {
  return async (config, ctx) => {
    const cfg = config as unknown as AgentToolUseConfig;
    const task = renderTemplate(cfg.taskTemplate, ctx.inputs);
    const maxIterations = cfg.maxIterations ?? 10;
    const tools = toolManager.getAnthropicToolDefs(cfg.tools);

    const messages: MessageParam[] = [
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
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        // No more tool calls — extract final text response
        const textBlocks = response.content.filter((b) => b.type === "text");
        const finalText = textBlocks.map((b) => b.text).join("");
        return { response: finalText, iterations: iteration + 1 };
      }

      // Add assistant response to conversation
      messages.push({ role: "assistant", content: response.content });

      // Execute each tool call and collect results
      const toolResults: ContentBlockParam[] = [];
      for (const block of toolUseBlocks) {
        if (block.type !== "tool_use") continue;
        try {
          const result = await toolManager.execute(
            block.name,
            block.input as Record<string, unknown>
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: typeof result === "string" ? result : JSON.stringify(result),
          } as unknown as ContentBlockParam);
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          } as unknown as ContentBlockParam);
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    throw new Error(`Agent exceeded max iterations (${maxIterations})`);
  };
}

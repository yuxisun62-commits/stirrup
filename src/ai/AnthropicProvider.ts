import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages.js";
import type { AIProvider, AICreateMessageParams, AIResponse, AIMessage, AIContentBlock, AIToolDef } from "./AIProvider.js";

/** Convert provider-agnostic messages to Anthropic SDK format */
function toAnthropicMessages(messages: AIMessage[]): MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }
    // Convert AIContentBlock[] to Anthropic content blocks
    const blocks = msg.content.map((block) => {
      if (block.type === "text") return { type: "text" as const, text: block.text };
      if (block.type === "tool_use") return {
        type: "tool_use" as const,
        id: block.id,
        name: block.name,
        input: block.input,
      };
      if (block.type === "tool_result") return {
        type: "tool_result" as const,
        tool_use_id: block.tool_use_id,
        content: block.content,
        is_error: block.is_error,
      };
      return block;
    });
    return { role: msg.role, content: blocks } as MessageParam;
  });
}

/** Convert provider-agnostic tool defs to Anthropic SDK format */
function toAnthropicTools(tools: AIToolDef[]): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Tool["input_schema"],
  }));
}

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : undefined);
  }

  async createMessage(params: AICreateMessageParams): Promise<AIResponse> {
    const response = await this.client.messages.create({
      model: params.model ?? "claude-sonnet-4-20250514",
      system: params.system,
      messages: toAnthropicMessages(params.messages),
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
      tools: params.tools ? toAnthropicTools(params.tools) : undefined,
    });

    // Normalize Anthropic response to AIResponse
    const content: AIContentBlock[] = response.content.map((block) => {
      if (block.type === "text") return { type: "text" as const, text: block.text };
      if (block.type === "tool_use") return {
        type: "tool_use" as const,
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      };
      return { type: "text" as const, text: "" };
    });

    const stopReason: AIResponse["stopReason"] =
      response.stop_reason === "end_turn" ? "end_turn"
      : response.stop_reason === "tool_use" ? "tool_use"
      : response.stop_reason === "max_tokens" ? "max_tokens"
      : "unknown";

    return { content, stopReason };
  }
}

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ContentBlockParam, Tool, Message } from "@anthropic-ai/sdk/resources/messages.js";

export interface CreateMessageParams {
  model?: string;
  system?: string;
  messages: MessageParam[];
  maxTokens?: number;
  temperature?: number;
  tools?: Tool[];
}

export class AnthropicProvider {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : undefined);
  }

  async createMessage(params: CreateMessageParams): Promise<Message> {
    return this.client.messages.create({
      model: params.model ?? "claude-sonnet-4-20250514",
      system: params.system,
      messages: params.messages,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
      tools: params.tools,
    });
  }
}

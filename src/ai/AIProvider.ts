/**
 * Provider-agnostic AI interface. Both Anthropic and Gemini (and future
 * providers) implement this so that node handlers don't couple to any SDK.
 */

/** A single message in a conversation */
export interface AIMessage {
  role: "user" | "assistant";
  content: string | AIContentBlock[];
}

/** A content block — text, tool call, or tool result */
export type AIContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

/** Tool definition in provider-agnostic format */
export interface AIToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Parameters for creating a message */
export interface AICreateMessageParams {
  model?: string;
  system?: string;
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
  tools?: AIToolDef[];
}

/** Normalized response from any provider */
export interface AIResponse {
  content: AIContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "unknown";
}

/** The interface every AI provider must implement */
export interface AIProvider {
  createMessage(params: AICreateMessageParams): Promise<AIResponse>;
}

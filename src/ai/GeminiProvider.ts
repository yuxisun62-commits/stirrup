import {
  GoogleGenAI,
  type Content,
  type Part,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type Tool as GeminiTool,
  Type,
} from "@google/genai";
import type { AIProvider, AICreateMessageParams, AIResponse, AIMessage, AIContentBlock, AIToolDef } from "./AIProvider.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

/** Convert JSON Schema type strings to Gemini's Type enum */
function mapSchemaType(type: string | undefined): Type {
  switch (type) {
    case "string": return Type.STRING;
    case "number": return Type.NUMBER;
    case "integer": return Type.INTEGER;
    case "boolean": return Type.BOOLEAN;
    case "array": return Type.ARRAY;
    case "object": return Type.OBJECT;
    default: return Type.STRING;
  }
}

/** Recursively convert a JSON Schema to Gemini's schema format */
function convertSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (schema.type) result.type = mapSchemaType(schema.type as string);
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) {
      props[key] = convertSchema(val);
    }
    result.properties = props;
  }
  if (schema.required) result.required = schema.required;
  if (schema.items) result.items = convertSchema(schema.items as Record<string, unknown>);
  return result;
}

/** Convert provider-agnostic messages to Gemini Content format */
function toGeminiContents(messages: AIMessage[]): Content[] {
  return messages.map((msg) => {
    const role = msg.role === "assistant" ? "model" : "user";

    if (typeof msg.content === "string") {
      return { role, parts: [{ text: msg.content }] };
    }

    const parts: Part[] = msg.content.map((block) => {
      if (block.type === "text") return { text: block.text };
      if (block.type === "tool_use") return {
        functionCall: { name: block.name, args: block.input },
      };
      if (block.type === "tool_result") return {
        functionResponse: {
          name: block.tool_use_id, // We store the tool name in tool_use_id for Gemini
          response: { result: block.content },
        },
      };
      return { text: "" };
    });

    return { role, parts };
  });
}

/** Convert provider-agnostic tool defs to Gemini format */
function toGeminiTools(tools: AIToolDef[]): GeminiTool[] {
  const declarations: FunctionDeclaration[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: convertSchema(t.inputSchema),
  }));
  return [{ functionDeclarations: declarations }];
}

/** Extract text from a Gemini response */
function extractContent(response: GenerateContentResponse): AIContentBlock[] {
  const candidate = response.candidates?.[0];
  if (!candidate?.content?.parts) return [{ type: "text", text: "" }];

  const blocks: AIContentBlock[] = [];
  for (const part of candidate.content.parts) {
    if (part.text !== undefined) {
      blocks.push({ type: "text", text: part.text });
    }
    if (part.functionCall) {
      // Gemini doesn't provide a tool_use ID — generate one
      blocks.push({
        type: "tool_use",
        id: `gemini_${part.functionCall.name}_${Date.now()}`,
        name: part.functionCall.name!,
        input: (part.functionCall.args ?? {}) as Record<string, unknown>,
      });
    }
  }

  return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
}

export class GeminiProvider implements AIProvider {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async createMessage(params: AICreateMessageParams): Promise<AIResponse> {
    const model = params.model ?? DEFAULT_MODEL;
    const contents = toGeminiContents(params.messages);

    const config: Record<string, unknown> = {};
    if (params.maxTokens) config.maxOutputTokens = params.maxTokens;
    if (params.temperature !== undefined) config.temperature = params.temperature;
    if (params.system) config.systemInstruction = params.system;
    if (params.tools && params.tools.length > 0) {
      config.tools = toGeminiTools(params.tools);
    }

    const response = await this.client.models.generateContent({
      model,
      contents,
      config,
    });

    const content = extractContent(response);
    const hasToolCalls = content.some((b) => b.type === "tool_use");
    const finishReason = response.candidates?.[0]?.finishReason;

    const stopReason: AIResponse["stopReason"] =
      hasToolCalls ? "tool_use"
      : finishReason === "MAX_TOKENS" ? "max_tokens"
      : "end_turn";

    return { content, stopReason };
  }
}

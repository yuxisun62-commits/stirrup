import type { NodeHandler } from "./NodeRegistry.js";
import type { LlmPromptConfig } from "../types/nodes.js";
import type { AnthropicProvider } from "../ai/AnthropicProvider.js";
import { renderTemplate } from "../ai/PromptTemplate.js";

export function createLlmPromptHandler(provider: AnthropicProvider): NodeHandler {
  return async (config, ctx) => {
    const cfg = config as unknown as LlmPromptConfig;
    const prompt = renderTemplate(cfg.promptTemplate, ctx.inputs);

    const response = await provider.createMessage({
      model: cfg.model,
      system: cfg.systemPrompt,
      messages: [{ role: "user", content: prompt }],
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const rawText = textBlocks.map((b) => b.text).join("");

    if (cfg.responseFormat === "json") {
      // Claude often wraps JSON in markdown fences (```json ... ```) even
      // when the prompt says "output ONLY JSON". Strip them before parsing.
      const cleaned = rawText
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?\s*```\s*$/i, "")
        .trim();
      try {
        const parsed = JSON.parse(cleaned);
        return { response: parsed };
      } catch {
        // If stripping didn't help, try parsing the original
        try {
          const parsed = JSON.parse(rawText);
          return { response: parsed };
        } catch {
          throw new Error(`LLM returned invalid JSON: ${rawText.slice(0, 200)}`);
        }
      }
    }

    return { response: rawText };
  };
}

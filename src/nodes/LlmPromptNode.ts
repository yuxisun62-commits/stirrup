import type { NodeHandler } from "./NodeRegistry.js";
import type { LlmPromptConfig } from "../types/nodes.js";
import type { AIProvider } from "../ai/AIProvider.js";
import { renderTemplate } from "../ai/PromptTemplate.js";

export function createLlmPromptHandler(provider: AIProvider): NodeHandler {
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
    const rawText = textBlocks.map((b) => (b as { type: "text"; text: string }).text).join("");

    if (cfg.responseFormat === "json") {
      // LLMs often wrap JSON in markdown fences (```json ... ```) even
      // when the prompt says "output ONLY JSON". Also, if the response was
      // truncated (hit max_tokens), the JSON and/or the closing fence will
      // be incomplete. We try progressively harder to extract valid JSON.
      let cleaned = rawText
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?\s*```\s*$/i, "")
        .trim();

      // 1. Try parsing the cleaned text directly
      try {
        return { response: JSON.parse(cleaned) };
      } catch { /* continue */ }

      // 2. Try the raw text (no fences present)
      try {
        return { response: JSON.parse(rawText) };
      } catch { /* continue */ }

      // 3. If truncated, try to repair: close open brackets/braces
      try {
        let repaired = cleaned;
        repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");
        repaired = repaired.replace(/,\s*$/, "");
        const opens = (repaired.match(/\[/g) || []).length;
        const closes = (repaired.match(/\]/g) || []).length;
        const openBraces = (repaired.match(/\{/g) || []).length;
        const closeBraces = (repaired.match(/\}/g) || []).length;
        repaired += "]".repeat(Math.max(0, opens - closes));
        repaired += "}".repeat(Math.max(0, openBraces - closeBraces));
        return { response: JSON.parse(repaired) };
      } catch { /* continue */ }

      // 4. Last resort: return the raw text
      ctx.logger.warn(
        `LLM response was not valid JSON (likely truncated at max_tokens=${cfg.maxTokens}). ` +
        `Returning raw text. Consider increasing maxTokens.`
      );
      return { response: rawText };
    }

    return { response: rawText };
  };
}

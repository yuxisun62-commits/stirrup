import vm from "node:vm";
import type { NodeHandler } from "./NodeRegistry.js";
import type { CodeGenerationConfig } from "../types/nodes.js";
import type { AIProvider } from "../ai/AIProvider.js";
import { renderTemplate } from "../ai/PromptTemplate.js";

/** Extract code from a markdown code fence */
function extractCode(text: string): string {
  const fenceMatch = text.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return text.trim();
}

export function createCodeGenerationHandler(provider: AIProvider): NodeHandler {
  return async (config, ctx) => {
    const cfg = config as unknown as CodeGenerationConfig;
    const prompt = renderTemplate(cfg.promptTemplate, ctx.inputs);

    const systemPrompt = [
      `You are a code generator. Write ${cfg.language} code that accomplishes the task.`,
      "Wrap your code in a markdown code fence.",
      "The code should be complete and ready to execute.",
    ].join("\n");

    const response = await provider.createMessage({
      model: cfg.model,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
      maxTokens: cfg.maxTokens ?? 4096,
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const rawText = textBlocks.map((b) => (b as { type: "text"; text: string }).text).join("");
    const code = extractCode(rawText);

    const result: Record<string, unknown> = { code };

    if (cfg.execute && (cfg.language === "javascript" || cfg.language === "typescript")) {
      const sandbox = {
        inputs: ctx.inputs,
        context: ctx.context,
        result: undefined as unknown,
        console: {
          log: (...args: unknown[]) => ctx.logger.info(args.map(String).join(" ")),
        },
      };

      try {
        vm.runInNewContext(code, sandbox, {
          timeout: cfg.sandboxTimeoutMs ?? 10000,
        });
        result.executionResult = sandbox.result;
        result.executed = true;
      } catch (err) {
        result.executionError = err instanceof Error ? err.message : String(err);
        result.executed = false;
      }
    } else {
      result.executed = false;
    }

    return result;
  };
}

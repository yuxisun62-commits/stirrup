import type { NodeHandler } from "./NodeRegistry.js";
import type { DecisionRoutingConfig } from "../types/nodes.js";
import type { AnthropicProvider } from "../ai/AnthropicProvider.js";
import { renderTemplate } from "../ai/PromptTemplate.js";

export function createDecisionRoutingHandler(provider: AnthropicProvider): NodeHandler {
  return async (config, ctx) => {
    const cfg = config as unknown as DecisionRoutingConfig;
    const prompt = renderTemplate(cfg.promptTemplate, ctx.inputs);

    const branchDescriptions = Object.entries(cfg.branches)
      .map(([name, desc]) => `- "${name}": ${desc}`)
      .join("\n");

    const systemPrompt = [
      "You are a decision router. Based on the data provided, choose exactly ONE of the following branches.",
      "Respond with ONLY the branch name, nothing else.",
      "",
      "Available branches:",
      branchDescriptions,
    ].join("\n");

    const response = await provider.createMessage({
      model: cfg.model,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
      maxTokens: cfg.maxTokens ?? 100,
      temperature: 0,
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const rawResponse = textBlocks.map((b) => b.text).join("").trim();

    // Find the branch name in the response
    const branchNames = Object.keys(cfg.branches);
    const selectedBranch = branchNames.find(
      (name) => rawResponse.toLowerCase() === name.toLowerCase()
    );

    if (!selectedBranch) {
      throw new Error(
        `Decision routing returned invalid branch "${rawResponse}". Valid branches: ${branchNames.join(", ")}`
      );
    }

    return { selectedBranch };
  };
}

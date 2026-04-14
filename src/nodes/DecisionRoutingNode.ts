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
      // Default was 100 which truncated responses — Claude often includes
      // brief reasoning before the branch name even when told not to.
      // 1024 gives ample room while still being conservative.
      maxTokens: cfg.maxTokens ?? 1024,
      temperature: 0,
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const rawResponse = textBlocks.map((b) => b.text).join("").trim();

    // Find the branch name in the response. Try exact match first, then
    // progressively looser matching — Claude sometimes includes reasoning
    // even when told to output only the branch name.
    const branchNames = Object.keys(cfg.branches);
    const lower = rawResponse.toLowerCase().trim();

    // 1. Exact match
    let selectedBranch = branchNames.find((n) => lower === n.toLowerCase());

    // 2. Response starts with the branch name (e.g., "python — because...")
    if (!selectedBranch) {
      selectedBranch = branchNames.find((n) => lower.startsWith(n.toLowerCase()));
    }

    // 3. Branch name appears as a standalone word in the response
    if (!selectedBranch) {
      selectedBranch = branchNames.find((n) => {
        const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        return re.test(rawResponse);
      });
    }

    if (!selectedBranch) {
      throw new Error(
        `Decision routing returned invalid branch "${rawResponse.slice(0, 100)}". Valid branches: ${branchNames.join(", ")}`
      );
    }

    return { selectedBranch, reasoning: rawResponse };
  };
}

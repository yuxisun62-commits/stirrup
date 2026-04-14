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

    // Extract the branch name from the response. Claude often ignores the
    // "respond with ONLY the branch name" instruction and outputs reasoning,
    // quotes, markdown, or a full analysis after the branch name. We need to
    // handle all of these robustly.
    const branchNames = Object.keys(cfg.branches);

    // Normalize: strip quotes, extra whitespace, and take just the first
    // line/word for initial matching attempts.
    const cleaned = rawResponse
      .replace(/^["'`\s]+/, "")   // strip leading quotes/whitespace
      .replace(/["'`\s]+$/, "")   // strip trailing quotes/whitespace
      .trim();
    const firstLine = cleaned.split(/[\n\r]/)[0].trim().toLowerCase();
    const firstWord = firstLine.split(/[\s.,;:!?\-—]+/)[0].trim();
    const lower = cleaned.toLowerCase();

    let selectedBranch: string | undefined;

    // 1. First word is the branch name (handles "fail", "fail.", "fail — because")
    if (!selectedBranch) {
      selectedBranch = branchNames.find((n) => firstWord === n.toLowerCase());
    }

    // 2. First line starts with the branch name
    if (!selectedBranch) {
      selectedBranch = branchNames.find((n) => firstLine.startsWith(n.toLowerCase()));
    }

    // 3. Exact match on full response (clean case)
    if (!selectedBranch) {
      selectedBranch = branchNames.find((n) => lower === n.toLowerCase());
    }

    // 4. Branch name appears as a word boundary anywhere in the response
    if (!selectedBranch) {
      selectedBranch = branchNames.find((n) => {
        const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        return re.test(rawResponse);
      });
    }

    // 5. Case-insensitive substring match (last resort — "...this should FAIL..." → fail)
    if (!selectedBranch) {
      selectedBranch = branchNames.find((n) => lower.includes(n.toLowerCase()));
    }

    if (!selectedBranch) {
      throw new Error(
        `Decision routing returned invalid branch "${rawResponse.slice(0, 100)}". Valid branches: ${branchNames.join(", ")}`
      );
    }

    return { selectedBranch, reasoning: rawResponse };
  };
}

/**
 * Stirrup Plugin: Perplexity (research-grade LLM with live web search)
 * Node types: perplexity-chat, perplexity-search
 *
 * Perplexity's USP is the combined retrieval + generation loop — the
 * model searches the web and cites sources in its answer. Great for
 * "summarize the latest news on X" or "find benchmarks for Y" use cases
 * that plain LLMs can't do reliably.
 *
 * Auth: API key (service "perplexity"). Get one at
 * perplexity.ai/settings/api.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../safeFetch.js";

const API = "https://api.perplexity.ai";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Perplexity API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("perplexity-chat", async (config, execCtx) => {
    const { token, messages, model, temperature, maxTokens, searchDomainFilter, returnRelatedQuestions, searchRecencyFilter } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string;
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      model?: string; temperature?: number; maxTokens?: number;
      // Sonar-only params — ignored by the non-search models.
      searchDomainFilter?: string[];
      returnRelatedQuestions?: boolean;
      searchRecencyFilter?: "month" | "week" | "day" | "hour";
    };
    const data = await call<{
      choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
      citations?: string[];
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    }>(token, "/chat/completions", {
      model: model ?? "sonar",
      messages,
      temperature, max_tokens: maxTokens,
      search_domain_filter: searchDomainFilter,
      return_related_questions: returnRelatedQuestions,
      search_recency_filter: searchRecencyFilter,
    });
    const choice = data.choices[0];
    return {
      content: choice?.message?.content,
      citations: data.citations ?? [],
      finishReason: choice?.finish_reason,
      usage: data.usage,
      raw: data,
    };
  });

  // Convenience wrapper — "search the web for X" with a single string
  // input, returns answer + citation list. Under the hood it's just a
  // single-turn sonar chat completion.
  ctx.registerNodeType("perplexity-search", async (config, execCtx) => {
    const { token, query, model, recency, domainFilter } = { ...execCtx.inputs, ...config } as {
      token: string; query: string; model?: string;
      recency?: "month" | "week" | "day" | "hour"; domainFilter?: string[];
    };
    const data = await call<{
      choices: Array<{ message: { content: string } }>;
      citations?: string[];
    }>(token, "/chat/completions", {
      model: model ?? "sonar",
      messages: [{ role: "user", content: query }],
      search_recency_filter: recency,
      search_domain_filter: domainFilter,
    });
    return {
      answer: data.choices[0]?.message?.content,
      citations: data.citations ?? [],
    };
  });
}

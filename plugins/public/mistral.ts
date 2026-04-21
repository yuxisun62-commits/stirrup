/**
 * Stirrup Plugin: Mistral AI
 * Node types: mistral-chat, mistral-embeddings
 *
 * Mistral runs their own hosted inference of the Mistral Large / Small /
 * Codestral families (plus the European Union-hosted endpoints that
 * some orgs prefer for data residency).
 *
 * Auth: API key (service "mistral"). Get one at console.mistral.ai.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../safeFetch.js";

const API = "https://api.mistral.ai/v1";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mistral API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("mistral-chat", async (config, execCtx) => {
    const { token, messages, model, temperature, maxTokens, topP, safePrompt, responseFormat } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string;
      messages: Array<{ role: string; content: string }>;
      model?: string; temperature?: number; maxTokens?: number; topP?: number;
      safePrompt?: boolean; responseFormat?: { type: "json_object" };
    };
    const data = await call<{
      choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    }>(token, "/chat/completions", {
      model: model ?? "mistral-large-latest",
      messages,
      temperature, max_tokens: maxTokens, top_p: topP,
      safe_prompt: safePrompt,
      response_format: responseFormat,
    });
    const choice = data.choices[0];
    return {
      content: choice?.message?.content,
      role: choice?.message?.role,
      finishReason: choice?.finish_reason,
      usage: data.usage,
    };
  });

  ctx.registerNodeType("mistral-embeddings", async (config, execCtx) => {
    const { token, input, model } = { ...execCtx.inputs, ...config } as {
      token: string; input: string | string[]; model?: string;
    };
    const data = await call<{
      data: Array<{ embedding: number[]; index: number }>;
      usage: { prompt_tokens: number; total_tokens: number };
    }>(token, "/embeddings", {
      model: model ?? "mistral-embed",
      input,
    });
    return {
      embeddings: data.data.map((d) => d.embedding),
      dimensions: data.data[0]?.embedding.length ?? 0,
      usage: data.usage,
    };
  });
}

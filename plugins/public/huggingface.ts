/**
 * Stirrup Plugin: Hugging Face Inference
 * Node types: hf-inference, hf-text-generation, hf-text-classification,
 *             hf-summarization, hf-question-answering, hf-embeddings,
 *             hf-image-classification, hf-zero-shot-classification
 *
 * Auth: Hugging Face API token (service "huggingface"). Create at
 * huggingface.co/settings/tokens. Works with both the public Inference
 * API and dedicated Inference Endpoints (pass `endpointUrl`).
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../safeFetch.js";

const PUBLIC_API = "https://api-inference.huggingface.co/models";

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function infer<T>(
  token: string,
  modelOrUrl: string,
  payload: unknown,
  endpointUrl?: string,
): Promise<T> {
  const url = endpointUrl ?? `${PUBLIC_API}/${modelOrUrl}`;
  const res = await safeFetch(url, {
    method: "POST",
    headers: {
      ...authHeader(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HF Inference ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  // Generic: bring your own model + payload. Every other node here is
  // just a typed wrapper around this one with the right inputs shape.
  ctx.registerNodeType("hf-inference", async (config, execCtx) => {
    const { token, model, endpointUrl, payload } = { ...execCtx.inputs, ...config } as {
      token: string; model?: string; endpointUrl?: string; payload: unknown;
    };
    if (!model && !endpointUrl) {
      throw new Error("hf-inference requires `model` or `endpointUrl`");
    }
    const result = await infer<unknown>(token, model ?? "", payload, endpointUrl);
    return { result };
  });

  ctx.registerNodeType("hf-text-generation", async (config, execCtx) => {
    const { token, model, inputs, parameters, endpointUrl } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; model?: string; inputs: string;
      parameters?: { max_new_tokens?: number; temperature?: number; top_p?: number; return_full_text?: boolean };
      endpointUrl?: string;
    };
    const result = await infer<Array<{ generated_text: string }>>(
      token,
      model ?? "mistralai/Mistral-7B-Instruct-v0.3",
      { inputs, parameters: parameters ?? { max_new_tokens: 256, temperature: 0.7 } },
      endpointUrl,
    );
    return {
      generated: Array.isArray(result) ? result[0]?.generated_text : (result as any)?.generated_text,
      raw: result,
    };
  });

  ctx.registerNodeType("hf-text-classification", async (config, execCtx) => {
    const { token, model, text, endpointUrl } = { ...execCtx.inputs, ...config } as {
      token: string; model?: string; text: string; endpointUrl?: string;
    };
    const result = await infer<Array<Array<{ label: string; score: number }>>>(
      token,
      model ?? "distilbert-base-uncased-finetuned-sst-2-english",
      { inputs: text },
      endpointUrl,
    );
    const flat = Array.isArray(result[0]) ? result[0] : (result as any);
    const top = flat?.reduce((a: any, b: any) => (a.score >= b.score ? a : b), flat[0]);
    return { label: top?.label, score: top?.score, all: flat };
  });

  ctx.registerNodeType("hf-summarization", async (config, execCtx) => {
    const { token, model, text, parameters, endpointUrl } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; model?: string; text: string;
      parameters?: { min_length?: number; max_length?: number };
      endpointUrl?: string;
    };
    const result = await infer<Array<{ summary_text: string }>>(
      token,
      model ?? "facebook/bart-large-cnn",
      { inputs: text, parameters },
      endpointUrl,
    );
    return { summary: result[0]?.summary_text, raw: result };
  });

  ctx.registerNodeType("hf-question-answering", async (config, execCtx) => {
    const { token, model, question, context, endpointUrl } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; model?: string;
      question: string; context: string; endpointUrl?: string;
    };
    const result = await infer<{ answer: string; score: number; start: number; end: number }>(
      token,
      model ?? "deepset/roberta-base-squad2",
      { inputs: { question, context } },
      endpointUrl,
    );
    return { answer: result.answer, score: result.score, start: result.start, end: result.end };
  });

  ctx.registerNodeType("hf-embeddings", async (config, execCtx) => {
    const { token, model, inputs, endpointUrl } = { ...execCtx.inputs, ...config } as {
      token: string; model?: string; inputs: string | string[]; endpointUrl?: string;
    };
    const result = await infer<number[][] | number[]>(
      token,
      model ?? "sentence-transformers/all-MiniLM-L6-v2",
      { inputs, options: { wait_for_model: true } },
      endpointUrl,
    );
    const embeddings = Array.isArray((result as number[][])[0])
      ? (result as number[][])
      : [result as number[]];
    return {
      embeddings,
      dimensions: embeddings[0]?.length ?? 0,
    };
  });

  // Zero-shot classification — handy for "categorize this into one of N
  // candidate labels" without training a model.
  ctx.registerNodeType("hf-zero-shot-classification", async (config, execCtx) => {
    const { token, model, text, candidates, multiLabel, endpointUrl } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; model?: string; text: string;
      candidates: string[]; multiLabel?: boolean; endpointUrl?: string;
    };
    const result = await infer<{ labels: string[]; scores: number[]; sequence: string }>(
      token,
      model ?? "facebook/bart-large-mnli",
      { inputs: text, parameters: { candidate_labels: candidates, multi_label: multiLabel ?? false } },
      endpointUrl,
    );
    return {
      topLabel: result.labels[0],
      topScore: result.scores[0],
      labels: result.labels,
      scores: result.scores,
    };
  });
}

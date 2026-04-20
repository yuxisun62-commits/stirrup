/**
 * Stirrup Plugin: OpenAI extras
 * Node types: openai-image, openai-embeddings, openai-tts, openai-whisper,
 *             openai-moderations
 *
 * Complements Stirrup's built-in llm-prompt node (which handles chat
 * completions). These four cover the rest of the OpenAI API that people
 * actually reach for: image generation, embeddings, speech synthesis,
 * and speech transcription.
 *
 * Auth: OpenAI API key under service "openai".
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch, safeArrayBuffer } from "../../src/plugins/safeFetch.js";

const API = "https://api.openai.com/v1";

function headers(key: string, isJson = true): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (isJson) h["Content-Type"] = "application/json";
  return h;
}

async function jsonCall<T>(key: string, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  // Image generation — gpt-image-1, dall-e-3, dall-e-2.
  // Returns the URL (or b64) — downstream nodes typically stash it in
  // object storage or post it to a chat channel.
  ctx.registerNodeType("openai-image", async (config, execCtx) => {
    const { token, prompt, model, size, quality, n, responseFormat } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; prompt: string;
      model?: string; size?: string; quality?: "standard" | "hd";
      n?: number; responseFormat?: "url" | "b64_json";
    };
    const data = await jsonCall<{ data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> }>(
      token,
      "/images/generations",
      {
        model: model ?? "gpt-image-1",
        prompt,
        size: size ?? "1024x1024",
        quality: quality ?? "standard",
        n: n ?? 1,
        response_format: responseFormat ?? "url",
      },
    );
    return {
      images: data.data.map((d) => ({ url: d.url, b64: d.b64_json, revisedPrompt: d.revised_prompt })),
      count: data.data.length,
    };
  });

  ctx.registerNodeType("openai-embeddings", async (config, execCtx) => {
    const { token, input, model, dimensions } = { ...execCtx.inputs, ...config } as {
      token: string; input: string | string[];
      model?: string; dimensions?: number;
    };
    const data = await jsonCall<{
      data: Array<{ embedding: number[]; index: number }>;
      usage: { prompt_tokens: number; total_tokens: number };
    }>(token, "/embeddings", {
      model: model ?? "text-embedding-3-small",
      input,
      dimensions,
    });
    return {
      embeddings: data.data.map((d) => d.embedding),
      dimensions: data.data[0]?.embedding.length ?? 0,
      usage: data.usage,
    };
  });

  // TTS — returns audio as a base64-encoded string. Downstream nodes
  // typically write it to filesystem (fs-write) or stream to a CDN.
  ctx.registerNodeType("openai-tts", async (config, execCtx) => {
    const { token, text, voice, model, speed, format } = { ...execCtx.inputs, ...config } as {
      token: string; text: string;
      voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
      model?: string; speed?: number; format?: "mp3" | "opus" | "aac" | "flac";
    };
    const res = await safeFetch(`${API}/audio/speech`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        model: model ?? "tts-1",
        voice: voice ?? "alloy",
        input: text,
        speed: speed ?? 1.0,
        response_format: format ?? "mp3",
      }),
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
    const buf = Buffer.from(await safeArrayBuffer(res));
    return {
      audioBase64: buf.toString("base64"),
      format: format ?? "mp3",
      byteLength: buf.length,
    };
  });

  // Whisper — accepts either a direct URL to an audio file or base64
  // audio content plus a filename. We fetch-and-forward so the caller
  // doesn't need to deal with OpenAI's multipart requirements directly.
  ctx.registerNodeType("openai-whisper", async (config, execCtx) => {
    const { token, audioUrl, audioBase64, filename, model, language, prompt, responseFormat } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; audioUrl?: string; audioBase64?: string; filename?: string;
      model?: string; language?: string; prompt?: string;
      responseFormat?: "json" | "text" | "srt" | "verbose_json" | "vtt";
    };

    let audioBuffer: Buffer;
    let mimeType = "audio/mpeg";
    let resolvedFilename = filename ?? "audio.mp3";

    if (audioUrl) {
      const r = await safeFetch(audioUrl);
      if (!r.ok) throw new Error(`Failed to fetch audio from ${audioUrl}: ${r.status}`);
      audioBuffer = Buffer.from(await safeArrayBuffer(r));
      mimeType = r.headers.get("content-type") ?? mimeType;
    } else if (audioBase64) {
      audioBuffer = Buffer.from(audioBase64, "base64");
    } else {
      throw new Error("openai-whisper requires audioUrl or audioBase64");
    }

    const form = new FormData();
    // Convert Buffer → Uint8Array so the BlobPart type is ArrayBuffer-backed
    // (SharedArrayBuffer is the default for Node's Buffer class; Blob wants
    // ArrayBuffer specifically under the web-standard typings).
    form.append(
      "file",
      new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
      resolvedFilename,
    );
    form.append("model", model ?? "whisper-1");
    if (language) form.append("language", language);
    if (prompt) form.append("prompt", prompt);
    if (responseFormat) form.append("response_format", responseFormat);

    const res = await safeFetch(`${API}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error(`OpenAI Whisper ${res.status}: ${await res.text()}`);
    // For json / verbose_json the response is JSON; for text it's a bare string.
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await res.json() as Record<string, unknown>;
      return { text: data.text, raw: data };
    }
    return { text: await res.text() };
  });

  ctx.registerNodeType("openai-moderations", async (config, execCtx) => {
    const { token, input, model } = { ...execCtx.inputs, ...config } as {
      token: string; input: string | string[]; model?: string;
    };
    const data = await jsonCall<{
      results: Array<{
        flagged: boolean;
        categories: Record<string, boolean>;
        category_scores: Record<string, number>;
      }>;
    }>(token, "/moderations", { input, model: model ?? "omni-moderation-latest" });
    return {
      flagged: data.results.some((r) => r.flagged),
      results: data.results,
    };
  });
}

/**
 * Stirrup Plugin: Groq (ultra-fast LLM inference)
 * Node types: groq-chat, groq-transcribe, groq-translate
 *
 * Groq's inference speed is the selling point — same open-source models
 * (Llama 3.x, Mixtral, DeepSeek R1) but dramatically lower latency than
 * other providers. The chat API is OpenAI-compatible so most workflows
 * can swap in `groq-chat` transparently.
 *
 * Auth: API key (service "groq"). Get one at console.groq.com/keys.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch, safeArrayBuffer } from "../safeFetch.js";

const API = "https://api.groq.com/openai/v1";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Groq API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("groq-chat", async (config, execCtx) => {
    const { token, messages, model, temperature, maxTokens, topP, stop, responseFormat } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string;
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      model?: string; temperature?: number; maxTokens?: number;
      topP?: number; stop?: string | string[]; responseFormat?: { type: "json_object" };
    };
    const data = await call<{
      choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    }>(token, "/chat/completions", {
      model: model ?? "llama-3.3-70b-versatile",
      messages,
      temperature, max_tokens: maxTokens, top_p: topP, stop,
      response_format: responseFormat,
    });
    const choice = data.choices[0];
    return {
      content: choice?.message?.content,
      role: choice?.message?.role,
      finishReason: choice?.finish_reason,
      usage: data.usage,
      raw: data,
    };
  });

  // Whisper transcription via Groq (often 10x faster than OpenAI).
  ctx.registerNodeType("groq-transcribe", async (config, execCtx) => {
    const { token, audioBase64, audioUrl, filename, model, language, prompt, responseFormat } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; audioBase64?: string; audioUrl?: string; filename?: string;
      model?: string; language?: string; prompt?: string;
      responseFormat?: "json" | "text" | "verbose_json";
    };
    let buf: Buffer;
    let mime = "audio/mpeg";
    if (audioBase64) {
      buf = Buffer.from(audioBase64, "base64");
    } else if (audioUrl) {
      const r = await safeFetch(audioUrl);
      if (!r.ok) throw new Error(`Failed to fetch audio: ${r.status}`);
      buf = Buffer.from(await safeArrayBuffer(r));
      mime = r.headers.get("content-type") ?? mime;
    } else {
      throw new Error("groq-transcribe requires audioBase64 or audioUrl");
    }

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), filename ?? "audio.mp3");
    form.append("model", model ?? "whisper-large-v3");
    if (language) form.append("language", language);
    if (prompt) form.append("prompt", prompt);
    if (responseFormat) form.append("response_format", responseFormat);

    const res = await safeFetch(`${API}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Groq transcribe ${res.status}: ${await res.text()}`);
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const data = (await res.json()) as Record<string, unknown>;
      return { text: data.text, raw: data };
    }
    return { text: await res.text() };
  });

  ctx.registerNodeType("groq-translate", async (config, execCtx) => {
    const { token, audioBase64, audioUrl, filename, model } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; audioBase64?: string; audioUrl?: string;
      filename?: string; model?: string;
    };
    let buf: Buffer;
    let mime = "audio/mpeg";
    if (audioBase64) buf = Buffer.from(audioBase64, "base64");
    else if (audioUrl) {
      const r = await safeFetch(audioUrl);
      if (!r.ok) throw new Error(`Failed to fetch audio: ${r.status}`);
      buf = Buffer.from(await safeArrayBuffer(r));
      mime = r.headers.get("content-type") ?? mime;
    } else throw new Error("groq-translate requires audioBase64 or audioUrl");

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), filename ?? "audio.mp3");
    form.append("model", model ?? "whisper-large-v3");

    const res = await safeFetch(`${API}/audio/translations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Groq translate ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as Record<string, unknown>;
    return { text: data.text, raw: data };
  });
}

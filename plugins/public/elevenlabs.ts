/**
 * Stirrup Plugin: ElevenLabs
 * Node types: elevenlabs-tts, elevenlabs-list-voices, elevenlabs-clone-voice,
 *             elevenlabs-speech-to-text
 *
 * ElevenLabs has the best TTS in the business — higher quality than
 * OpenAI's tts-1 for most voices. Stirrup's OpenAI TTS node is still
 * useful (faster, cheaper), but this plugin is where nuanced voice
 * work lives.
 *
 * Auth: API key under service "elevenlabs". Get one at
 * elevenlabs.io/app/settings/api-keys.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch, safeArrayBuffer } from "../safeFetch.js";

const API = "https://api.elevenlabs.io/v1";

function apiKeyHeader(token: string): Record<string, string> {
  return { "xi-api-key": token };
}

async function callJson<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    ...init,
    headers: { ...apiKeyHeader(token), "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`ElevenLabs API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("elevenlabs-tts", async (config, execCtx) => {
    const { token, text, voiceId, modelId, stability, similarityBoost, style, useSpeakerBoost, outputFormat } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; text: string; voiceId: string;
      modelId?: string; stability?: number; similarityBoost?: number;
      style?: number; useSpeakerBoost?: boolean;
      outputFormat?: string;
    };
    const fmt = outputFormat ?? "mp3_44100_128";
    const res = await safeFetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${fmt}`, {
      method: "POST",
      headers: { ...apiKeyHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId ?? "eleven_turbo_v2_5",
        voice_settings: {
          stability: stability ?? 0.5,
          similarity_boost: similarityBoost ?? 0.75,
          style: style ?? 0,
          use_speaker_boost: useSpeakerBoost ?? true,
        },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
    const buf = Buffer.from(await safeArrayBuffer(res));
    return {
      audioBase64: buf.toString("base64"),
      format: fmt,
      byteLength: buf.length,
    };
  });

  ctx.registerNodeType("elevenlabs-list-voices", async (config, execCtx) => {
    const { token } = { ...execCtx.inputs, ...config } as { token: string };
    const data = await callJson<{ voices: Array<Record<string, unknown>> }>(token, "/voices");
    return {
      voices: data.voices.map((v: any) => ({
        voiceId: v.voice_id, name: v.name, category: v.category,
        labels: v.labels, description: v.description,
      })),
      count: data.voices.length,
    };
  });

  // Voice cloning — upload one or more short audio samples and get back
  // a custom voice_id you can use with the TTS node. Expects audio as
  // base64; the handler decodes and sends multipart/form-data.
  ctx.registerNodeType("elevenlabs-clone-voice", async (config, execCtx) => {
    const { token, name, description, samples, labels } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; name: string; description?: string;
      samples: Array<{ filename: string; base64: string; mimeType?: string }>;
      labels?: Record<string, string>;
    };
    const form = new FormData();
    form.append("name", name);
    if (description) form.append("description", description);
    if (labels) form.append("labels", JSON.stringify(labels));
    samples.forEach((s) => {
      const buf = Buffer.from(s.base64, "base64");
      form.append(
        "files",
        new Blob([new Uint8Array(buf)], { type: s.mimeType ?? "audio/mpeg" }),
        s.filename,
      );
    });
    const res = await safeFetch(`${API}/voices/add`, {
      method: "POST",
      headers: apiKeyHeader(token),
      body: form,
    });
    if (!res.ok) throw new Error(`ElevenLabs clone ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { voice_id: string };
    return { voiceId: data.voice_id };
  });

  // Speech-to-text. ElevenLabs has a beta STT endpoint with speaker
  // diarization; we expose the basic transcription use case.
  ctx.registerNodeType("elevenlabs-speech-to-text", async (config, execCtx) => {
    const { token, audioBase64, audioUrl, filename, modelId } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; audioBase64?: string; audioUrl?: string; filename?: string; modelId?: string;
    };
    let buf: Buffer;
    let mime = "audio/mpeg";
    if (audioBase64) {
      buf = Buffer.from(audioBase64, "base64");
    } else if (audioUrl) {
      const r = await safeFetch(audioUrl);
      if (!r.ok) throw new Error(`Failed to fetch ${audioUrl}: ${r.status}`);
      buf = Buffer.from(await safeArrayBuffer(r));
      mime = r.headers.get("content-type") ?? mime;
    } else {
      throw new Error("elevenlabs-speech-to-text requires audioBase64 or audioUrl");
    }
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), filename ?? "audio.mp3");
    form.append("model_id", modelId ?? "scribe_v1");

    const res = await safeFetch(`${API}/speech-to-text`, {
      method: "POST",
      headers: apiKeyHeader(token),
      body: form,
    });
    if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { text?: string; language_code?: string };
    return { text: data.text, language: data.language_code, raw: data };
  });
}

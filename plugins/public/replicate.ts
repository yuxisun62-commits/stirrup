/**
 * Stirrup Plugin: Replicate (replicate.com)
 *
 * Run any model hosted on Replicate — Flux for images, LLaVA for vision,
 * Whisper for transcription, SDXL, etc. Closes the visual half of the
 * marketing publish loop: pair with the typefully + buffer plugins to
 * generate matching hero images for every social post.
 *
 * Node types:
 *   replicate-run     — generic node, runs any Replicate model with any input
 *   replicate-image   — convenience wrapper for image generation (defaults
 *                       to Flux Schnell, the fastest/cheapest option)
 *
 * Tools (for agent-tool-use):
 *   replicate-generate-image — same as the node, exposed for agent use
 *
 * Auth: API token from https://replicate.com/account/api-tokens
 *   - Pass via `apiToken` in node config, or
 *   - Set REPLICATE_API_TOKEN env var
 *
 * API base: https://api.replicate.com/v1
 *
 * IMPORTANT: Replicate uses `Authorization: Token <key>` (literal "Token",
 * not "Bearer"). This is unusual and easy to get wrong.
 *
 * Polling vs. webhook: This plugin polls. Replicate's API supports webhook
 * callbacks for completion, but polling is simpler for synchronous workflow
 * nodes that need to return the result inline. Default poll: 1.5s interval,
 * 5min timeout. Configurable per node.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../safeFetch.js";

const API_BASE = "https://api.replicate.com/v1";

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: unknown;
  error?: string;
  logs?: string;
  created_at?: string;
  completed_at?: string;
  urls?: { get?: string; cancel?: string };
}

function rpApi(token: string) {
  return async (
    method: string,
    path: string,
    body?: unknown
  ): Promise<Record<string, unknown>> => {
    const res = await safeFetch(`${API_BASE}${path}`, {
      method,
      headers: {
        // Replicate uses "Token <key>", NOT "Bearer <key>". Easy mistake to make.
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Replicate API ${res.status}: ${errBody.slice(0, 400)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  };
}

function getToken(config: Record<string, unknown>): string {
  const token =
    (config.apiToken as string) ??
    (config.token as string) ??
    process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error(
      "Replicate API token required: set REPLICATE_API_TOKEN env var or pass `apiToken` in node config. Get one at https://replicate.com/account/api-tokens"
    );
  }
  return token;
}

/**
 * Poll a prediction until it completes or times out.
 * Uses exponential-ish backoff (1s → 1.5s → 2s …) capped at the configured max.
 */
async function pollPrediction(
  api: ReturnType<typeof rpApi>,
  predictionId: string,
  pollIntervalMs: number,
  timeoutMs: number
): Promise<ReplicatePrediction> {
  const startedAt = Date.now();
  let interval = pollIntervalMs;
  while (Date.now() - startedAt < timeoutMs) {
    const result = (await api("GET", `/predictions/${predictionId}`)) as unknown as ReplicatePrediction;
    if (result.status === "succeeded" || result.status === "failed" || result.status === "canceled") {
      return result;
    }
    await new Promise((r) => setTimeout(r, interval));
    // Gentle backoff so fast models aren't slowed down but slow ones don't spam the API
    interval = Math.min(interval + 250, 5000);
  }
  throw new Error(`Replicate prediction ${predictionId} did not complete within ${timeoutMs / 1000}s`);
}

export default function register(ctx: PluginContext) {
  // ─────────────────────── replicate-run ───────────────────────
  /**
   * Generic node: run any Replicate model with any input shape.
   *
   * Inputs/config:
   *   apiToken         — Replicate API token (or set REPLICATE_API_TOKEN)
   *   model            — Model identifier in "owner/name" or "owner/name:version" form.
   *                      Examples: "black-forest-labs/flux-schnell",
   *                                "meta/llama-2-70b-chat",
   *                                "openai/whisper"
   *   input            — Object with model-specific input fields. Pass-through.
   *   pollIntervalMs   — Initial polling interval (default 1500)
   *   timeoutMs        — Hard cap before throwing (default 300000 = 5 min)
   *
   * Outputs:
   *   output           — Whatever the model returned (string, array, object)
   *   predictionId     — Replicate prediction ID for later inspection
   *   status           — Final status (succeeded/failed/canceled)
   *   logs             — Model logs (useful when status=failed)
   *   durationMs       — How long the prediction took
   */
  ctx.registerNodeType("replicate-run", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as {
      apiToken?: string;
      model: string;
      input: Record<string, unknown>;
      pollIntervalMs?: number;
      timeoutMs?: number;
    };
    if (!merged.model) throw new Error("replicate-run: `model` is required (e.g. 'black-forest-labs/flux-schnell')");
    if (!merged.input) throw new Error("replicate-run: `input` is required");

    const api = rpApi(getToken(merged));

    // Use the model-scoped predictions endpoint when no explicit version pin
    // (cleaner) and the legacy /predictions endpoint when ":version" is present.
    let path: string;
    let body: Record<string, unknown>;
    if (merged.model.includes(":")) {
      const [, version] = merged.model.split(":");
      path = "/predictions";
      body = { version, input: merged.input };
    } else {
      path = `/models/${merged.model}/predictions`;
      body = { input: merged.input };
    }

    const startedAt = Date.now();
    const created = (await api("POST", path, body)) as unknown as ReplicatePrediction;
    const completed = await pollPrediction(
      api,
      created.id,
      merged.pollIntervalMs ?? 1500,
      merged.timeoutMs ?? 5 * 60 * 1000
    );

    if (completed.status === "failed" || completed.status === "canceled") {
      throw new Error(
        `Replicate prediction ${completed.status}: ${completed.error ?? "unknown error"}${completed.logs ? `\nLogs: ${completed.logs.slice(-500)}` : ""}`
      );
    }

    return {
      output: completed.output,
      predictionId: completed.id,
      status: completed.status,
      logs: completed.logs ?? "",
      durationMs: Date.now() - startedAt,
    };
  });

  // ─────────────────────── replicate-image ───────────────────────
  /**
   * Convenience wrapper for image generation. Defaults to Flux Schnell —
   * Replicate's fastest/cheapest text-to-image model (~0.5s, ~$0.003/image).
   *
   * Inputs/config:
   *   apiToken         — Replicate API token (or env var)
   *   prompt           — Text prompt
   *   model            — Model override (default "black-forest-labs/flux-schnell")
   *   aspectRatio      — "1:1" | "16:9" | "9:16" | "4:5" | "3:4" | "4:3" | "21:9" (default "1:1")
   *   numOutputs       — How many images to generate (default 1)
   *   seed             — Optional seed for reproducibility
   *   outputFormat     — "webp" | "png" | "jpg" (default "webp")
   *   outputQuality    — 1–100 (default 80, only relevant for jpg/webp)
   *
   * Outputs:
   *   imageUrls        — Array of CDN URLs to the generated images
   *   firstImageUrl    — Convenience: imageUrls[0] for single-output workflows
   *   model            — Which model was used (for the receipt)
   *   durationMs       — Generation time
   */
  ctx.registerNodeType("replicate-image", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as {
      apiToken?: string;
      prompt: string;
      model?: string;
      aspectRatio?: string;
      numOutputs?: number;
      seed?: number;
      outputFormat?: string;
      outputQuality?: number;
    };
    if (!merged.prompt) throw new Error("replicate-image: `prompt` is required");

    const model = merged.model ?? "black-forest-labs/flux-schnell";
    const api = rpApi(getToken(merged));

    const input: Record<string, unknown> = {
      prompt: merged.prompt,
      aspect_ratio: merged.aspectRatio ?? "1:1",
      num_outputs: merged.numOutputs ?? 1,
      output_format: merged.outputFormat ?? "webp",
      output_quality: merged.outputQuality ?? 80,
    };
    if (merged.seed !== undefined) input.seed = merged.seed;

    const startedAt = Date.now();
    const created = (await api("POST", `/models/${model}/predictions`, { input })) as unknown as ReplicatePrediction;
    const completed = await pollPrediction(api, created.id, 1000, 5 * 60 * 1000);

    if (completed.status !== "succeeded") {
      throw new Error(`Replicate image generation ${completed.status}: ${completed.error ?? "unknown error"}`);
    }

    // Flux returns either a single URL string or an array. Normalize.
    const raw = completed.output;
    const imageUrls = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];

    return {
      imageUrls,
      firstImageUrl: imageUrls[0] ?? null,
      model,
      durationMs: Date.now() - startedAt,
    };
  });

  // ─────────────────────── Tool: replicate-generate-image ───────────────────────
  ctx.registerTool({
    name: "replicate-generate-image",
    description:
      "Generate an image from a text prompt using Replicate's Flux Schnell model. Fast (~0.5s) and cheap. Returns a CDN URL.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the image to generate." },
        aspectRatio: {
          type: "string",
          description: "Image aspect ratio. Defaults to 1:1. Options: 1:1, 16:9, 9:16, 4:5, 3:4, 4:3, 21:9.",
        },
      },
      required: ["prompt"],
    },
    handler: async (input) => {
      const token = process.env.REPLICATE_API_TOKEN;
      if (!token) throw new Error("REPLICATE_API_TOKEN not set");
      const api = rpApi(token);
      const created = (await api("POST", "/models/black-forest-labs/flux-schnell/predictions", {
        input: {
          prompt: input.prompt,
          aspect_ratio: input.aspectRatio ?? "1:1",
          num_outputs: 1,
          output_format: "webp",
        },
      })) as unknown as ReplicatePrediction;
      const completed = await pollPrediction(api, created.id, 1000, 2 * 60 * 1000);
      if (completed.status !== "succeeded") {
        throw new Error(`Replicate ${completed.status}: ${completed.error ?? "unknown"}`);
      }
      const out = completed.output;
      const url = Array.isArray(out) ? out[0] : out;
      return { imageUrl: url, predictionId: completed.id };
    },
  });
}

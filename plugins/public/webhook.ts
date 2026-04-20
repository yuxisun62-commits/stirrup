/**
 * Stirrup Plugin: Webhook (Outbound)
 * Node types: webhook-send, webhook-batch
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../../src/plugins/safeFetch.js";

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("webhook-send", async (config, execCtx) => {
    const {
      url, method, headers: customHeaders, payload, retries, timeoutMs, signingSecret,
    } = { ...execCtx.inputs, ...config } as {
      url: string; method?: string; headers?: Record<string, string>;
      payload: unknown; retries?: number; timeoutMs?: number; signingSecret?: string;
    };

    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const hdrs: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "stirrup-webhook/1.0",
      ...customHeaders,
    };

    // HMAC signing if secret provided
    if (signingSecret) {
      const { createHmac } = await import("node:crypto");
      const sig = createHmac("sha256", signingSecret).update(body).digest("hex");
      hdrs["X-Signature-256"] = `sha256=${sig}`;
    }

    const maxRetries = retries ?? 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs ?? 30000);
        const res = await safeFetch(url, {
          method: method ?? "POST",
          headers: hdrs,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const responseBody = await res.text();
        if (res.ok) {
          return {
            status: res.status,
            response: responseBody,
            attempts: attempt + 1,
          };
        }
        lastError = new Error(`Webhook returned ${res.status}: ${responseBody}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }

    throw lastError ?? new Error("Webhook failed");
  });

  ctx.registerNodeType("webhook-batch", async (config, execCtx) => {
    const { urls, payload, concurrency } = { ...execCtx.inputs, ...config } as {
      urls: string[]; payload: unknown; concurrency?: number;
    };

    const body = JSON.stringify(payload);
    const limit = concurrency ?? 5;
    const results: Array<{ url: string; status: number | null; error?: string }> = [];

    for (let i = 0; i < urls.length; i += limit) {
      const batch = urls.slice(i, i + limit);
      const batchResults = await Promise.allSettled(
        batch.map(async (url) => {
          const res = await safeFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          return { url, status: res.status };
        })
      );

      for (const r of batchResults) {
        if (r.status === "fulfilled") {
          results.push(r.value);
        } else {
          results.push({ url: batch[batchResults.indexOf(r)], status: null, error: r.reason?.message });
        }
      }
    }

    return {
      sent: results.filter((r) => r.status && r.status < 400).length,
      failed: results.filter((r) => !r.status || r.status >= 400).length,
      results,
    };
  });
}

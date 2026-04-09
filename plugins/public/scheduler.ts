/**
 * Stirrup Plugin: Scheduler Utilities
 * Node types: delay, rate-limit, batch, debounce
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("delay", async (config, execCtx) => {
    const { ms, seconds, reason } = { ...execCtx.inputs, ...config } as {
      ms?: number; seconds?: number; reason?: string;
    };
    const delayMs = ms ?? (seconds ? seconds * 1000 : 1000);
    const startedAt = new Date().toISOString();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      delayed: delayMs,
      reason: reason ?? "scheduled delay",
      startedAt,
      completedAt: new Date().toISOString(),
      passthrough: execCtx.inputs,
    };
  });

  ctx.registerNodeType("rate-limit", async (config, execCtx) => {
    const { items, ratePerSecond, action } = { ...execCtx.inputs, ...config } as {
      items: unknown[]; ratePerSecond: number; action?: string;
    };

    if (!Array.isArray(items)) return { results: [items], processed: 1 };

    const intervalMs = 1000 / ratePerSecond;
    const results: unknown[] = [];

    for (let i = 0; i < items.length; i++) {
      results.push(items[i]);
      if (i < items.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    return { results, processed: results.length, ratePerSecond };
  });

  ctx.registerNodeType("batch", async (config, execCtx) => {
    const { items, batchSize } = { ...execCtx.inputs, ...config } as {
      items: unknown[]; batchSize: number;
    };

    if (!Array.isArray(items)) return { batches: [[items]], batchCount: 1 };

    const size = batchSize ?? 10;
    const batches: unknown[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }

    return { batches, batchCount: batches.length, totalItems: items.length };
  });

  ctx.registerNodeType("debounce", async (config, execCtx) => {
    const { key, windowMs, value } = { ...execCtx.inputs, ...config } as {
      key: string; windowMs: number; value: unknown;
    };

    // Simple in-memory debounce using context
    const debounceKey = `_debounce_${key}`;
    const lastRun = execCtx.context[debounceKey] as number | undefined;
    const now = Date.now();

    if (lastRun && now - lastRun < windowMs) {
      return { debounced: true, skipped: true, key, msSinceLastRun: now - lastRun };
    }

    execCtx.context[debounceKey] = now;
    return { debounced: false, skipped: false, key, value };
  });
}

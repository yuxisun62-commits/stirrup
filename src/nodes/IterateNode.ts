import type { NodeHandler, NodeRegistry } from "./NodeRegistry.js";
import type { IterateConfig } from "../types/nodes.js";
import type { NodeExecutionContext } from "../types/execution.js";

/**
 * Factory for the `iterate` node handler. Closes over the registry so it
 * can look up the child node's handler at execution time.
 *
 * Why this exists: Stirrup's DAG is static at workflow design time. When
 * you need to run the same operation over an array whose length is only
 * known at runtime (e.g. "for each UAT scenario from the sprint plan, run
 * a browser test"), there's no way to express that with edges alone. The
 * iterate node runs the child handler N times inside a single scheduler
 * slot, so the scheduler sees one node but the workflow gets dynamic
 * fan-out semantics.
 *
 * Modes:
 *   - parallel (default): all iterations run concurrently, optionally
 *     capped by config.concurrency. Use for independent per-item work
 *     (per-scenario UAT, per-item enrichment).
 *   - sequential: iterations run one at a time. Each iteration sees the
 *     accumulated outputs of prior iterations in `inputs.priorResults`.
 *     Use for iterative code-gen where each sprint/pass builds on the last.
 */
export function createIterateHandler(registry: NodeRegistry): NodeHandler {
  return async (config, ctx) => {
    const cfg = config as unknown as IterateConfig;
    const items = ctx.inputs.items;

    if (!Array.isArray(items)) {
      throw new Error(
        `iterate: 'items' input must be an array, got ${typeof items}. ` +
        `Make sure you map an array-producing output (e.g. sprint-plan.outputs.response.sprints) to the 'items' input.`
      );
    }

    if (!cfg.childType) {
      throw new Error("iterate: config.childType is required (the node type to run per item)");
    }

    if (!registry.has(cfg.childType)) {
      throw new Error(
        `iterate: childType "${cfg.childType}" is not a registered node type. ` +
        `Available types depend on which plugins are loaded.`
      );
    }
    const childHandler = registry.get(cfg.childType);

    const mode = cfg.mode ?? "parallel";
    const continueOnError = cfg.continueOnIterationError ?? true;
    const childConfig = cfg.childConfig ?? {};

    ctx.logger.info(
      `iterate: running ${items.length} iterations of ${cfg.childType} in ${mode} mode`
    );

    const results: unknown[] = [];
    let successCount = 0;
    let failureCount = 0;

    /** Run one iteration with full error handling */
    const runOne = async (
      item: unknown,
      index: number,
      priorResults: unknown[],
    ): Promise<unknown> => {
      // Build the per-item execution context. The child sees the parent's
      // inputs plus `item`, `index`, and (in sequential mode) `priorResults`.
      const itemCtx: NodeExecutionContext = {
        ...ctx,
        inputs: {
          ...ctx.inputs,
          item,
          index,
          priorResults: mode === "sequential" ? priorResults : undefined,
        },
        logger: {
          info: (msg: string) => ctx.logger.info(`[iter:${index}] ${msg}`),
          warn: (msg: string) => ctx.logger.warn(`[iter:${index}] ${msg}`),
          error: (msg: string) => ctx.logger.error(`[iter:${index}] ${msg}`),
        },
      };

      try {
        const out = await childHandler(childConfig, itemCtx);
        successCount++;
        return out;
      } catch (err) {
        failureCount++;
        const message = err instanceof Error ? err.message : String(err);
        if (!continueOnError) {
          throw new Error(`iterate: iteration ${index} failed: ${message}`);
        }
        ctx.logger.warn(`iterate: iteration ${index} failed (continuing): ${message}`);
        return { error: message, index };
      }
    };

    if (mode === "sequential") {
      // One-at-a-time, each sees all prior outputs
      for (let i = 0; i < items.length; i++) {
        const out = await runOne(items[i], i, [...results]);
        results.push(out);
      }
    } else {
      // Parallel — optionally capped by concurrency
      const concurrency = Math.max(1, Number(cfg.concurrency ?? items.length));
      // Pre-size results so parallel completions can write by index
      results.length = items.length;
      for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchOuts = await Promise.all(
          batch.map((item, j) => runOne(item, i + j, [])),
        );
        for (let j = 0; j < batchOuts.length; j++) {
          results[i + j] = batchOuts[j];
        }
      }
    }

    return {
      results,
      count: items.length,
      successCount,
      failureCount,
    };
  };
}

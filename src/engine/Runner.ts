import type { WorkflowNode, RetryPolicy } from "../types/workflow.js";
import type { NodeExecutionContext, StepResult } from "../types/execution.js";
import type { NodeRegistry, NodeHandler } from "../nodes/NodeRegistry.js";

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 1,
  backoffMs: 1000,
  backoffMultiplier: 2,
};

/**
 * Build the `ExpressionContext` for evaluating n8n templates / compiled
 * conditions. `json` is the current item seen by `$json`; callers override
 * it per-iteration when running in per-item mode.
 */
function buildN8nContext(execCtx: NodeExecutionContext, json: unknown) {
  const nodeOutputs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(execCtx.inputs)) {
    if (k.startsWith("__n8nNode_")) {
      nodeOutputs[k.replace("__n8nNode_", "")] = v;
    }
  }
  return {
    json,
    nodeOutputs,
    parameter: execCtx.context,
    workflow: {
      id: (execCtx.context._workflowId as string) ?? "",
      name: (execCtx.context._workflowName as string) ?? "",
    },
    execution: { id: (execCtx.context._executionId as string) ?? "" },
  };
}

/**
 * Evaluate `{{ }}` templates in every config string and, if the config is
 * an imported condition, freeze its compiled JS result into a string
 * literal the ConditionNode can re-evaluate in its own sandbox. Returns a
 * fresh config object with n8n-only markers stripped.
 */
async function evaluateN8nConfig(
  config: Record<string, unknown>,
  execCtx: NodeExecutionContext,
  json: unknown,
): Promise<Record<string, unknown>> {
  const { evaluateConfig, evaluateRawJs } = await import("../import/n8nExpression.js");
  const n8nContext = buildN8nContext(execCtx, json);
  const hasTemplates = config._n8nExpressions === true;
  const hasCompiledCondition = config._n8nCondition === true;

  let resolved: Record<string, unknown> = hasTemplates
    ? (evaluateConfig(config, n8nContext) as Record<string, unknown>)
    : { ...config };

  if (hasCompiledCondition && typeof resolved.expression === "string") {
    const result = evaluateRawJs(resolved.expression, n8nContext);
    const asString = typeof result === "boolean" ? String(result) : String(result ?? "");
    resolved.expression = JSON.stringify(asString);
  }

  delete resolved._n8nExpressions;
  delete resolved._n8nCondition;
  delete resolved._n8nPerItem;
  delete resolved._n8nReferencedNodes;
  return resolved;
}

/**
 * Decide what the iteration list is, given the primary upstream mapping.
 * n8n workflows pass data as items — we treat both shapes as iterable:
 *
 *   - __n8nJson is an array                 → iterate each element
 *   - __n8nJson has an `items: [...]` field → iterate each element
 *     (this is the shape we emit when a previous node iterated, so per-item
 *     execution chains naturally across imported nodes)
 *
 * Anything else (scalar, plain object, undefined) collapses to a single
 * iteration with the whole value as `$json`.
 */
function extractItems(json: unknown): { items: unknown[]; iterated: boolean } {
  if (Array.isArray(json)) return { items: json, iterated: true };
  if (json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).items)) {
    return { items: (json as { items: unknown[] }).items, iterated: true };
  }
  return { items: [json], iterated: false };
}

/** Does this config need the n8n iteration / eval machinery at all? */
function hasN8nFlags(config: Record<string, unknown>): boolean {
  return (
    config._n8nExpressions === true ||
    config._n8nCondition === true ||
    config._n8nPerItem === true
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Runner {
  constructor(
    private registry: NodeRegistry,
    private defaultRetry: RetryPolicy = DEFAULT_RETRY
  ) {}

  async run(
    node: WorkflowNode,
    execCtx: NodeExecutionContext,
    onRetry?: (nodeId: string, attempt: number) => void
  ): Promise<StepResult> {
    const policy = node.retry ?? this.defaultRetry;
    const startedAt = new Date().toISOString();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      try {
        const handler = this.registry.get(node.type);
        const outputs = await this.executeWithN8nIteration(handler, node, execCtx);
        return {
          nodeId: node.id,
          status: "completed",
          outputs,
          startedAt,
          completedAt: new Date().toISOString(),
          attempts: attempt,
          selectedBranch: outputs.selectedBranch as string | undefined,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (policy.retryableErrors && policy.retryableErrors.length > 0) {
          const isRetryable = policy.retryableErrors.some(
            (pattern) => lastError!.message.includes(pattern)
          );
          if (!isRetryable) break;
        }

        if (attempt < policy.maxAttempts) {
          onRetry?.(node.id, attempt);
          const delay = policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt - 1);
          await sleep(delay);
        }
      }
    }

    return {
      nodeId: node.id,
      status: "failed",
      outputs: {},
      error: {
        message: lastError?.message ?? "Unknown error",
        stack: lastError?.stack,
        attempt: policy.maxAttempts,
      },
      startedAt,
      completedAt: new Date().toISOString(),
      attempts: policy.maxAttempts,
    };
  }

  /**
   * Dispatch one invocation of the handler, possibly looping per-item if
   * the node is imported from n8n and the primary upstream input is an
   * array. Native (non-imported) nodes skip the whole branch and call the
   * handler directly — zero overhead for workflows that don't import.
   */
  private async executeWithN8nIteration(
    handler: NodeHandler,
    node: WorkflowNode,
    execCtx: NodeExecutionContext,
  ): Promise<Record<string, unknown>> {
    const config = node.config as Record<string, unknown>;

    if (!hasN8nFlags(config)) {
      return handler(config, execCtx);
    }

    const perItem = config._n8nPerItem === true;
    if (!perItem) {
      // Single-shot n8n eval path — legacy behavior for condition nodes
      // and nodes with expressions but no per-item semantics.
      const resolved = await evaluateN8nConfig(config, execCtx, execCtx.inputs.__n8nJson ?? {});
      return handler(resolved, execCtx);
    }

    const { items, iterated } = extractItems(execCtx.inputs.__n8nJson);
    if (!iterated) {
      // Upstream didn't emit a list — single run, same context as a
      // regular n8n-expression node.
      const resolved = await evaluateN8nConfig(config, execCtx, items[0]);
      const output = await handler(resolved, execCtx);
      // Preserve the `{items: [...]}` convention even for a single pass,
      // so downstream per-item nodes chain predictably. Skip the wrap if
      // the handler already produced an items-shaped result (e.g. a
      // mongo-find returning { documents: [...] } — we trust the handler).
      if (output && typeof output === "object" && Array.isArray((output as any).items)) {
        return output;
      }
      return { items: [output], count: 1 };
    }

    // Real iteration.
    const results: Record<string, unknown>[] = [];
    for (const item of items) {
      const perItemCtx: NodeExecutionContext = {
        ...execCtx,
        // $json resolution inside evaluator reads from n8nContext.json
        // (passed explicitly); we also swap the input mapping so any
        // handler that peeks at `execCtx.inputs.__n8nJson` sees the
        // per-item value, matching what a user's Script-style handler
        // would expect.
        inputs: { ...execCtx.inputs, __n8nJson: item },
      };
      const resolved = await evaluateN8nConfig(config, perItemCtx, item);
      const output = await handler(resolved, perItemCtx);
      results.push(output);
    }
    return { items: results, count: results.length };
  }
}

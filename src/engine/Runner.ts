import type { WorkflowNode, RetryPolicy } from "../types/workflow.js";
import type { NodeExecutionContext, StepResult } from "../types/execution.js";
import type { NodeRegistry } from "../nodes/NodeRegistry.js";

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 1,
  backoffMs: 1000,
  backoffMultiplier: 2,
};

/**
 * If the node's config was produced by the n8n importer and flagged with
 * `_n8nExpressions: true`, evaluate every `{{ }}` token inside it before
 * the handler runs. The evaluator gets a context built from the node's
 * resolved inputs — specifically the `__n8nJson` (primary upstream) and
 * every `__n8nNode_<id>` mapping the importer emitted.
 *
 * Returns the resolved config. No-op for non-flagged nodes so native
 * workflows never pay the evaluator cost.
 */
async function maybeEvaluateN8nConfig(
  config: Record<string, unknown>,
  execCtx: NodeExecutionContext,
): Promise<Record<string, unknown>> {
  if (config._n8nExpressions !== true) return config;

  const { evaluateConfig } = await import("../import/n8nExpression.js");

  // Pull n8n-specific inputs out so they don't leak into the handler's
  // own input set. Everything else stays on inputs for handler use.
  const nodeOutputs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(execCtx.inputs)) {
    if (k.startsWith("__n8nNode_")) {
      // Strip the prefix to re-expose by original n8n node name. The
      // importer mapped `$node["X"]` → a key derived from X's Stirrup id,
      // so we can't recover the original name here — but we can expose
      // both the id-suffixed form and the bare id form. Real n8n workflows
      // use display names; ours uses the Stirrup id. The importer docs
      // note this so users writing new expressions know what to reference.
      nodeOutputs[k.replace("__n8nNode_", "")] = v;
    }
  }

  const primaryJson = execCtx.inputs.__n8nJson ?? {};

  const resolved = evaluateConfig(config, {
    json: primaryJson,
    nodeOutputs,
    parameter: execCtx.context,
    workflow: {
      id: (execCtx.context._workflowId as string) ?? "",
      name: (execCtx.context._workflowName as string) ?? "",
    },
    execution: { id: (execCtx.context._executionId as string) ?? "" },
  });

  const out = resolved as Record<string, unknown>;
  // Strip the marker so it doesn't confuse handlers that happen to
  // iterate their own config (ScriptNode, TransformNode).
  delete out._n8nExpressions;
  return out;
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
        const resolvedConfig = await maybeEvaluateN8nConfig(node.config, execCtx);
        const outputs = await handler(resolvedConfig, execCtx);
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
}

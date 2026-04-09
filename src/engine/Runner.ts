import type { WorkflowNode, RetryPolicy } from "../types/workflow.js";
import type { NodeExecutionContext, StepResult } from "../types/execution.js";
import type { NodeRegistry } from "../nodes/NodeRegistry.js";

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 1,
  backoffMs: 1000,
  backoffMultiplier: 2,
};

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
        const outputs = await handler(node.config, execCtx);
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

import type { NodeHandler } from "./NodeRegistry.js";
import type { WorkflowEngine } from "../engine/Engine.js";

const MAX_SUB_WORKFLOW_DEPTH = 10;

/**
 * Sub-workflow node: runs another workflow inline and waits for its result.
 *
 * Creates a factory that captures the engine reference so the handler can
 * dispatch into `engine.execute()`. n8n's ExecuteWorkflow node maps here.
 *
 * Output shape:
 *   { executionId, status, context, steps }
 *
 * Where `context` is the final shared context of the sub-execution (including
 * any values the sub-workflow wrote) and `steps` is the full per-node step
 * record. Downstream nodes can reach into either via input mappings.
 *
 * Depth guard: `_subWorkflowDepth` is threaded through the child execution's
 * context and incremented per level. Exceeding MAX_SUB_WORKFLOW_DEPTH throws
 * rather than stack-overflowing.
 */
export function makeSubWorkflowHandler(engine: WorkflowEngine): NodeHandler {
  return async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as {
      workflowId: string;
      inputs?: Record<string, unknown>;
    };

    if (!merged.workflowId) {
      throw new Error("sub-workflow requires `workflowId` in config or inputs");
    }

    const currentDepth = (execCtx.context._subWorkflowDepth as number | undefined) ?? 0;
    const nextDepth = currentDepth + 1;
    if (nextDepth > MAX_SUB_WORKFLOW_DEPTH) {
      throw new Error(
        `Sub-workflow nesting exceeded ${MAX_SUB_WORKFLOW_DEPTH} levels — likely a recursion cycle.`,
      );
    }

    const subContext: Record<string, unknown> = {
      ...(merged.inputs ?? {}),
      _subWorkflowDepth: nextDepth,
    };

    const subState = await engine.execute(merged.workflowId, subContext);

    if (subState.status !== "completed") {
      const failedNode = Object.values(subState.steps).find((s) => s.status === "failed");
      const detail = failedNode?.error?.message ?? subState.status;
      throw new Error(
        `Sub-workflow "${merged.workflowId}" did not complete (${subState.status}): ${detail}`,
      );
    }

    // Strip our own internal depth marker from the returned context so callers
    // who inspect it don't see Stirrup's bookkeeping.
    const { _subWorkflowDepth: _d, ...returnedContext } = subState.context;

    return {
      executionId: subState.executionId,
      status: subState.status,
      context: returnedContext,
      steps: subState.steps,
    };
  };
}

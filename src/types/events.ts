import type { NodeId } from "./workflow.js";
import type { ExecutionId } from "./execution.js";

export type EngineEvent =
  | { type: "execution:start"; executionId: ExecutionId }
  | { type: "execution:complete"; executionId: ExecutionId }
  | { type: "execution:fail"; executionId: ExecutionId; error: string }
  | { type: "execution:pause"; executionId: ExecutionId }
  | { type: "node:start"; executionId: ExecutionId; nodeId: NodeId }
  | { type: "node:complete"; executionId: ExecutionId; nodeId: NodeId; outputs: Record<string, unknown> }
  | { type: "node:fail"; executionId: ExecutionId; nodeId: NodeId; error: string; attempt: number }
  | { type: "node:retry"; executionId: ExecutionId; nodeId: NodeId; attempt: number }
  | { type: "node:skip"; executionId: ExecutionId; nodeId: NodeId; reason: string };

import type { NodeId, WorkflowId } from "./workflow.js";

export type ExecutionId = string;

export type ExecutionStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

/** Result of a single node execution */
export interface StepResult {
  nodeId: NodeId;
  status: StepStatus;
  outputs: Record<string, unknown>;
  error?: { message: string; stack?: string; attempt: number };
  startedAt: string;
  completedAt?: string;
  attempts: number;
  /** Which branch was selected (for condition/decision nodes) */
  selectedBranch?: string;
}

/** Full persisted state for one workflow execution */
export interface ExecutionState {
  executionId: ExecutionId;
  workflowId: WorkflowId;
  status: ExecutionStatus;
  context: Record<string, unknown>;
  steps: Record<NodeId, StepResult>;
  createdAt: string;
  updatedAt: string;
}

/** Context passed into each node handler at execution time */
export interface NodeExecutionContext {
  inputs: Record<string, unknown>;
  context: Record<string, unknown>;
  logger: {
    info(msg: string, data?: unknown): void;
    warn(msg: string, data?: unknown): void;
    error(msg: string, data?: unknown): void;
  };
}

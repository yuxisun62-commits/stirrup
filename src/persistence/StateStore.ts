import type { ExecutionId, ExecutionState } from "../types/execution.js";
import type { WorkflowId } from "../types/workflow.js";

export interface StateStore {
  save(state: ExecutionState): Promise<void>;
  load(executionId: ExecutionId): Promise<ExecutionState | null>;
  list(workflowId?: WorkflowId): Promise<ExecutionState[]>;
  delete(executionId: ExecutionId): Promise<void>;
}

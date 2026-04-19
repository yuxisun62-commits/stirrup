import type { WorkflowDefinition } from "../types/workflow.js";

export type TriggerKind = "http" | "webhook" | "cron" | "telegram";

export interface TriggerStatus {
  workflowId: string;
  kind: TriggerKind;
  /** Human-readable summary (cron expr, webhook source, bot name, etc.) */
  label: string;
  enabled: boolean;
  fireCount: number;
  lastFiredAt?: string;
  lastExecutionId?: string;
  lastError?: { message: string; at: string };
}

export interface TriggerRegistration {
  workflowId: string;
  kind: TriggerKind;
  label: string;
  /** Called by TriggerManager.stop() to release resources (timers, pollers) */
  stop?: () => void | Promise<void>;
}

/**
 * Dispatches a workflow execution for a trigger. Wraps engine.execute() so
 * individual triggers don't need to know about redaction, rehydration, etc.
 * Returns the executionId (non-blocking — execution runs on the server).
 */
export type TriggerDispatch = (
  workflowId: string,
  context: Record<string, unknown>,
) => Promise<{ executionId: string }>;

/** A trigger type implementation — one per kind (http, cron, telegram...) */
export interface TriggerHandler {
  kind: TriggerKind;
  /**
   * Build a registration from a workflow that declares this trigger type.
   * Returns null if the workflow has no trigger of this kind.
   */
  register(
    workflow: WorkflowDefinition,
    dispatch: TriggerDispatch,
    reportFire: (result: { executionId?: string; error?: Error }) => void,
  ): TriggerRegistration | null;
}

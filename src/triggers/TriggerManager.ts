import type { WorkflowEngine } from "../engine/Engine.js";
import type { WorkflowDefinition } from "../types/workflow.js";
import type {
  TriggerHandler,
  TriggerRegistration,
  TriggerStatus,
  TriggerDispatch,
  TriggerKind,
} from "./types.js";

interface ManagedTrigger {
  registration: TriggerRegistration;
  status: TriggerStatus;
}

/**
 * Owns the lifecycle of all non-manual trigger types (HTTP, webhook, cron,
 * telegram). Workflows declare triggers in YAML under a top-level `triggers:`
 * block; TriggerManager walks every registered workflow, asks each handler
 * whether it applies, and starts those that do.
 *
 * Each managed trigger tracks its own status (fireCount, lastFiredAt,
 * lastError) so the UI can surface what's live and whether anything is
 * broken. Stop() releases every underlying resource (timers, pollers,
 * webhook subscriptions).
 */
export class TriggerManager {
  private handlers: TriggerHandler[] = [];
  private managed: ManagedTrigger[] = [];
  private engine: WorkflowEngine;
  private running = false;

  constructor(engine: WorkflowEngine) {
    this.engine = engine;
  }

  addHandler(handler: TriggerHandler): void {
    this.handlers.push(handler);
  }

  /** Start all triggers across all currently-registered workflows. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const workflows = this.getRegisteredWorkflows();
    for (const workflow of workflows.values()) {
      this.registerWorkflow(workflow);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    for (const { registration } of this.managed) {
      try {
        await registration.stop?.();
      } catch (err) {
        console.error(`[triggers] stop failed for ${registration.workflowId}:`, err);
      }
    }
    this.managed = [];
  }

  /**
   * Re-scan a single workflow. Called when a workflow is saved through the
   * API so the UI's trigger edits take effect without a server restart.
   */
  refreshWorkflow(workflow: WorkflowDefinition): void {
    this.unregisterWorkflow(workflow.id);
    if (this.running) {
      this.registerWorkflow(workflow);
    }
  }

  unregisterWorkflow(workflowId: string): void {
    const kept: ManagedTrigger[] = [];
    for (const m of this.managed) {
      if (m.registration.workflowId === workflowId) {
        try {
          m.registration.stop?.();
        } catch (err) {
          console.error(`[triggers] stop failed for ${workflowId}:`, err);
        }
      } else {
        kept.push(m);
      }
    }
    this.managed = kept;
  }

  listStatuses(): TriggerStatus[] {
    return this.managed.map((m) => ({ ...m.status }));
  }

  getHandlerByKind(kind: TriggerKind): TriggerHandler | undefined {
    return this.handlers.find((h) => h.kind === kind);
  }

  /**
   * Report a trigger firing by (workflowId, kind) rather than by
   * registration reference. Needed for shared-ingress triggers (the
   * webhook route is one mount that fans out to N workflows) where the
   * per-registration reportFire callback isn't reachable at request time.
   */
  reportFireByWorkflow(
    workflowId: string,
    kind: TriggerKind,
    result: { executionId?: string; error?: Error },
  ): void {
    const entry = this.managed.find(
      (m) => m.registration.workflowId === workflowId && m.registration.kind === kind,
    );
    if (!entry) return;
    entry.status.fireCount++;
    entry.status.lastFiredAt = new Date().toISOString();
    if (result.executionId) {
      entry.status.lastExecutionId = result.executionId;
      entry.status.lastError = undefined;
    } else if (result.error) {
      entry.status.lastError = {
        message: result.error.message,
        at: entry.status.lastFiredAt,
      };
    }
  }

  private registerWorkflow(workflow: WorkflowDefinition): void {
    if (!workflow.triggers) return;

    const dispatch: TriggerDispatch = async (workflowId, context) => {
      const state = await this.engine.execute(workflowId, context);
      return { executionId: state.executionId };
    };

    for (const handler of this.handlers) {
      const managedRef: { current: ManagedTrigger | null } = { current: null };

      const reportFire = (result: { executionId?: string; error?: Error }) => {
        const m = managedRef.current;
        if (!m) return;
        m.status.fireCount++;
        m.status.lastFiredAt = new Date().toISOString();
        if (result.executionId) {
          m.status.lastExecutionId = result.executionId;
          m.status.lastError = undefined;
        } else if (result.error) {
          m.status.lastError = {
            message: result.error.message,
            at: m.status.lastFiredAt,
          };
        }
      };

      const registration = handler.register(workflow, dispatch, reportFire);
      if (!registration) continue;

      const entry: ManagedTrigger = {
        registration,
        status: {
          workflowId: registration.workflowId,
          kind: registration.kind,
          label: registration.label,
          enabled: true,
          fireCount: 0,
        },
      };
      managedRef.current = entry;
      this.managed.push(entry);
    }
  }

  private getRegisteredWorkflows(): Map<string, WorkflowDefinition> {
    // The engine keeps its workflow map private. We read it reflectively
    // rather than widen the engine's public surface for what is otherwise
    // an internal wiring concern. If this assumption breaks, the engine
    // could expose a `listWorkflows()` — but for now this keeps the change
    // surface minimal.
    return (this.engine as unknown as { workflows: Map<string, WorkflowDefinition> }).workflows;
  }
}

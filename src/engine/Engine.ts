import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import type { WorkflowDefinition } from "../types/workflow.js";
import type { ExecutionState, ExecutionId } from "../types/execution.js";
import type { EngineEvent } from "../types/events.js";
import type { StateStore } from "../persistence/StateStore.js";
import { FileStateStore } from "../persistence/FileStateStore.js";
import { NodeRegistry } from "../nodes/NodeRegistry.js";
import { Runner } from "./Runner.js";
import { Scheduler } from "./Scheduler.js";
import { loadWorkflowFile, loadWorkflowDirectory } from "../loader/WorkflowLoader.js";

/**
 * Strip service-backed credentials from context before persistence.
 *
 * Service tokens (GitHub, Anthropic, Launchmatic, etc.) are injected into
 * `state.context` at execute/resume time from the local token store. They
 * need to be there during execution so nodes can authenticate. But they
 * DON'T need to survive to disk — on resume, we re-inject them from the
 * token store (which is the authoritative source).
 *
 * Persisting them would leak credentials anywhere the state store ends up:
 * copied SQLite files, backups, log exports, shared dev environments.
 *
 * We return a shallow clone with service-backed param values cleared. The
 * in-memory state that the scheduler uses is untouched — only the snapshot
 * being written to disk is scrubbed.
 */
function redactTokensForPersistence(
  state: ExecutionState,
  workflow: WorkflowDefinition,
): ExecutionState {
  if (!workflow.params || workflow.params.length === 0) return state;
  const serviceParams = workflow.params.filter((p) => p.service);
  if (serviceParams.length === 0) return state;

  const redactedContext: Record<string, unknown> = { ...state.context };
  for (const param of serviceParams) {
    if (redactedContext[param.name] === undefined) continue;
    // Empty string, not null/undefined, so the resume-path re-injection
    // (which checks `existing !== "" && existing !== null`) triggers on
    // reload. This also matches how templates declare default context
    // (e.g. `lmToken: ""`) so format stays uniform.
    redactedContext[param.name] = "";
  }

  return { ...state, context: redactedContext };
}

/**
 * Inverse of redaction: re-inject service tokens from the local token store
 * into a loaded state's context. Used when resuming or debugging, where we
 * need the real credentials at hand even though they were scrubbed from disk.
 *
 * Mutates the state in place for simplicity — callers just loaded it and
 * own the reference.
 */
async function rehydrateTokens(
  state: ExecutionState,
  workflow: WorkflowDefinition,
): Promise<void> {
  if (!workflow.params) return;
  try {
    const { getToken } = await import("../auth/tokenStore.js");
    for (const param of workflow.params) {
      if (!param.service) continue;
      const existing = state.context[param.name];
      if (existing !== undefined && existing !== "" && existing !== null) continue;
      const stored = getToken(param.service);
      if (stored) {
        state.context[param.name] = stored.accessToken;
      }
    }
  } catch { /* token store optional */ }
}

export interface EngineOptions {
  definitionsDir?: string;
  stateDir?: string;
  stateStore?: StateStore;
}

export class WorkflowEngine extends EventEmitter {
  private stateStore: StateStore;
  private registry: NodeRegistry;
  private runner: Runner;
  private workflows = new Map<string, WorkflowDefinition>();
  private activeSchedulers = new Map<ExecutionId, Scheduler>();

  constructor(options: EngineOptions = {}) {
    super();
    this.stateStore = options.stateStore ?? new FileStateStore(options.stateDir ?? ".");
    this.registry = new NodeRegistry();
    this.runner = new Runner(this.registry);

    if (options.definitionsDir) {
      this.workflows = loadWorkflowDirectory(options.definitionsDir);
    }
  }

  /** Get the node registry for registering custom node handlers */
  getRegistry(): NodeRegistry {
    return this.registry;
  }

  /** Load a workflow from a file path */
  loadWorkflow(filePath: string): WorkflowDefinition {
    const workflow = loadWorkflowFile(filePath);
    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  /** Register a workflow definition directly */
  registerWorkflow(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
  }

  /** Start a new execution of a workflow */
  async execute(
    workflowId: string,
    initialContext?: Record<string, unknown>
  ): Promise<ExecutionState> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: "${workflowId}"`);
    }

    // Build context: defaults from params, then workflow context, then runtime overrides
    const paramDefaults: Record<string, unknown> = {};
    if (workflow.params) {
      for (const param of workflow.params) {
        if (param.default !== undefined) {
          paramDefaults[param.name] = param.default;
        }
      }
    }

    const mergedContext: Record<string, unknown> = { ...paramDefaults, ...(workflow.context ?? {}), ...(initialContext ?? {}) };

    // Auto-inject stored OAuth tokens for params with a declared service
    if (workflow.params) {
      try {
        const { getToken } = await import("../auth/tokenStore.js");
        for (const param of workflow.params) {
          if (mergedContext[param.name] !== undefined) continue;
          if (!param.service) continue;
          const stored = getToken(param.service);
          if (stored) {
            mergedContext[param.name] = stored.accessToken;
          }
        }
      } catch { /* token store optional */ }
    }

    // Validate required params are present
    if (workflow.params) {
      const missing = workflow.params
        .filter((p) => p.required && mergedContext[p.name] === undefined)
        .map((p) => p.name);
      if (missing.length > 0) {
        throw new Error(`Missing required parameters: ${missing.join(", ")}`);
      }
    }

    const executionId = uuidv4();
    const state: ExecutionState = {
      executionId,
      workflowId,
      status: "pending",
      context: mergedContext,
      steps: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const scheduler = new Scheduler(workflow, state, {
      runner: this.runner,
      emit: (event: EngineEvent) => this.emit(event.type, event),
      persist: (s: ExecutionState) => this.stateStore.save(redactTokensForPersistence(s, workflow)),
    });

    this.activeSchedulers.set(executionId, scheduler);

    try {
      const result = await scheduler.execute();
      return result;
    } finally {
      this.activeSchedulers.delete(executionId);
    }
  }

  /** Resume a paused or failed execution */
  async resume(executionId: ExecutionId): Promise<ExecutionState> {
    const state = await this.stateStore.load(executionId);
    if (!state) {
      throw new Error(`Execution not found: "${executionId}"`);
    }

    const workflow = this.workflows.get(state.workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: "${state.workflowId}"`);
    }

    // Re-inject stored service tokens — saved state has empty strings for
    // credentials (redacted before persistence). Without this, every resumed
    // node that needs a token fails with "token required".
    await rehydrateTokens(state, workflow);

    const scheduler = new Scheduler(workflow, state, {
      runner: this.runner,
      emit: (event: EngineEvent) => this.emit(event.type, event),
      persist: (s: ExecutionState) => this.stateStore.save(redactTokensForPersistence(s, workflow)),
    });

    this.activeSchedulers.set(executionId, scheduler);

    try {
      const result = await scheduler.execute();
      return result;
    } finally {
      this.activeSchedulers.delete(executionId);
    }
  }

  /** Pause a running execution after current nodes finish */
  pause(executionId: ExecutionId): void {
    const scheduler = this.activeSchedulers.get(executionId);
    if (!scheduler) {
      throw new Error(`No active execution: "${executionId}"`);
    }
    scheduler.pause();
  }

  /** Get execution state */
  async getState(executionId: ExecutionId): Promise<ExecutionState | null> {
    return this.stateStore.load(executionId);
  }

  /**
   * Debug a single node: re-run it in isolation using the current execution's
   * context, optionally with override inputs. Does not modify the parent execution state.
   * Returns the step result (success or failure with error + stack trace).
   */
  async debugNode(
    executionId: ExecutionId,
    nodeId: string,
    overrideInputs?: Record<string, unknown>,
    overrideConfig?: Record<string, unknown>,
  ): Promise<import("../types/execution.js").StepResult> {
    const state = await this.stateStore.load(executionId);
    if (!state) throw new Error(`Execution not found: "${executionId}"`);

    const workflow = this.workflows.get(state.workflowId);
    if (!workflow) throw new Error(`Workflow not found: "${state.workflowId}"`);

    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node not found: "${nodeId}"`);

    // Service tokens were redacted on persistence — re-inject from the token
    // store so debug runs can actually hit authenticated APIs.
    await rehydrateTokens(state, workflow);

    // Resolve the inputs the same way the scheduler would, using the current execution's state
    const { ContextManager } = await import("./ContextManager.js");
    const contextManager = new ContextManager(state.context, state.steps);
    const resolvedInputs = contextManager.resolveInputs(node.inputs);
    const finalInputs = { ...resolvedInputs, ...(overrideInputs ?? {}) };
    const finalConfig = overrideConfig ?? node.config;

    // Build a minimal execution context for the handler
    const execCtx: import("../types/execution.js").NodeExecutionContext = {
      inputs: finalInputs,
      context: state.context,
      logger: {
        info: (msg: string) => console.log(`[debug:${nodeId}]`, msg),
        warn: (msg: string) => console.warn(`[debug:${nodeId}]`, msg),
        error: (msg: string) => console.error(`[debug:${nodeId}]`, msg),
      },
    };

    // Run the node's handler directly (bypassing retry, scheduler)
    const startedAt = new Date().toISOString();
    try {
      const handler = this.registry.get(node.type);
      const outputs = await handler(finalConfig, execCtx);
      return {
        nodeId,
        status: "completed",
        outputs,
        startedAt,
        completedAt: new Date().toISOString(),
        attempts: 1,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        nodeId,
        status: "failed",
        outputs: {},
        error: {
          message: error.message,
          stack: error.stack,
          attempt: 1,
        },
        startedAt,
        completedAt: new Date().toISOString(),
        attempts: 1,
      };
    }
  }

  /** Get the resolved inputs a node would receive at a given execution state */
  async getNodeInputs(
    executionId: ExecutionId,
    nodeId: string,
  ): Promise<{ resolvedInputs: Record<string, unknown>; mappings: import("../types/workflow.js").InputMapping[]; config: Record<string, unknown> }> {
    const state = await this.stateStore.load(executionId);
    if (!state) throw new Error(`Execution not found: "${executionId}"`);
    const workflow = this.workflows.get(state.workflowId);
    if (!workflow) throw new Error(`Workflow not found: "${state.workflowId}"`);
    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node not found: "${nodeId}"`);

    const { ContextManager } = await import("./ContextManager.js");
    const contextManager = new ContextManager(state.context, state.steps);
    const resolvedInputs = contextManager.resolveInputs(node.inputs);

    return {
      resolvedInputs,
      mappings: node.inputs,
      config: node.config,
    };
  }

  /** List all executions, optionally filtered by workflow ID */
  async listExecutions(workflowId?: string): Promise<ExecutionState[]> {
    return this.stateStore.list(workflowId);
  }
}

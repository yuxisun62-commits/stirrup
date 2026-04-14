import type { WorkflowDefinition, WorkflowNode, WorkflowEdge, NodeId } from "../types/workflow.js";
import type { ExecutionState, StepResult, NodeExecutionContext } from "../types/execution.js";
import type { EngineEvent } from "../types/events.js";
import { ContextManager } from "./ContextManager.js";
import { Runner } from "./Runner.js";

export interface SchedulerOptions {
  runner: Runner;
  emit: (event: EngineEvent) => void;
  persist: (state: ExecutionState) => Promise<void>;
}

export class Scheduler {
  private adjacency = new Map<NodeId, WorkflowEdge[]>();
  private inDegree = new Map<NodeId, number>();
  private nodeMap = new Map<NodeId, WorkflowNode>();
  private running = new Map<NodeId, Promise<StepResult>>();
  private paused = false;

  constructor(
    private workflow: WorkflowDefinition,
    private state: ExecutionState,
    private options: SchedulerOptions
  ) {
    for (const node of workflow.nodes) {
      this.nodeMap.set(node.id, node);
      this.adjacency.set(node.id, []);
      this.inDegree.set(node.id, 0);
    }

    for (const edge of workflow.edges) {
      this.adjacency.get(edge.from)!.push(edge);
    }

    // Compute in-degrees (only from unconditional edges + all conditional edges initially)
    for (const edge of workflow.edges) {
      this.inDegree.set(edge.to, this.inDegree.get(edge.to)! + 1);
    }

    // Adjust for already-completed/skipped nodes
    for (const [nodeId, step] of Object.entries(state.steps)) {
      if (step.status === "completed" || step.status === "skipped") {
        this.satisfyNode(nodeId, step);
      } else if (step.status === "running" || step.status === "failed") {
        // Reset interrupted/failed nodes to pending for re-execution
        step.status = "pending";
      }
    }
  }

  /** Mark a node as satisfied and reduce successors' in-degrees */
  private satisfyNode(nodeId: NodeId, step: StepResult): void {
    const edges = this.adjacency.get(nodeId) ?? [];
    for (const edge of edges) {
      // For conditional edges, only satisfy if branch matches or node was skipped
      if (edge.condition && step.status === "completed") {
        if (step.selectedBranch !== edge.condition) {
          // Skip the target and its descendants
          this.skipSubgraph(edge.to);
          continue;
        }
      }
      this.inDegree.set(edge.to, Math.max(0, this.inDegree.get(edge.to)! - 1));
    }
  }

  /**
   * Skip a node (and potentially its descendants) because a conditional
   * branch was not taken. But ONLY skip if the node has no other live
   * incoming paths — if another edge from a non-skipped node still leads
   * here, the node should wait for that path instead of being killed.
   *
   * This is the key fix for fan-in after conditional fan-out: when
   * `branch-on-even` skips `odd-path`, we must NOT skip `report`
   * because `even-path` (the taken branch) also leads to `report`.
   *
   * The in-degree is reduced for the skipped edge, which lets the
   * scheduler's normal dispatch handle the rest — when all remaining
   * live edges complete, in-degree hits 0 and the node fires.
   */
  private skipSubgraph(nodeId: NodeId): void {
    if (this.state.steps[nodeId]?.status === "completed") return;
    if (this.state.steps[nodeId]?.status === "skipped") return;

    // Check if this node has other incoming edges that are still "live" —
    // meaning they come from a source that will actually route to this node.
    // An edge is live if:
    //   1. Its source is not skipped, AND
    //   2. Either the edge is unconditional, OR the source's selectedBranch
    //      matches the edge's condition (meaning the branch was taken).
    // This distinguishes "odd-path (skipped source)" from "even-path
    // (completed source via taken branch)" from "low-path (completed source
    // via NOT-taken branch)".
    const allIncoming = this.workflow.edges.filter((e) => e.to === nodeId);
    const liveIncoming = allIncoming.filter((e) => {
      const srcStep = this.state.steps[e.from];
      if (!srcStep || srcStep.status === "skipped") return false;
      // Unconditional edge from a non-skipped source → live
      if (!e.condition) return true;
      // Conditional edge → only live if the source took this branch
      if (srcStep.status === "completed" && srcStep.selectedBranch === e.condition) return true;
      // Source is pending/running → we don't know yet, assume live
      if (srcStep.status !== "completed") return true;
      return false;
    });

    if (liveIncoming.length > 0) {
      // Node has other live paths — don't skip, just reduce in-degree
      // so the scheduler counts one fewer predecessor to wait for.
      this.inDegree.set(nodeId, Math.max(0, this.inDegree.get(nodeId)! - 1));
      return;
    }

    // All incoming edges are from skipped nodes — this node is unreachable.
    this.state.steps[nodeId] = {
      nodeId,
      status: "skipped",
      outputs: {},
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      attempts: 0,
    };

    this.options.emit({
      type: "node:skip",
      executionId: this.state.executionId,
      nodeId,
      reason: "Branch not taken",
    });

    // Recurse into descendants — they may also need to be skipped or
    // have their in-degree reduced.
    const edges = this.adjacency.get(nodeId) ?? [];
    for (const edge of edges) {
      this.skipSubgraph(edge.to);
    }
  }

  /** Find all nodes ready to execute (in-degree 0, not completed/skipped/running) */
  private getReadyNodes(): NodeId[] {
    const ready: NodeId[] = [];
    for (const [nodeId, degree] of this.inDegree) {
      if (degree > 0) continue;
      const step = this.state.steps[nodeId];
      if (step?.status === "completed" || step?.status === "skipped") continue;
      if (this.running.has(nodeId)) continue;
      ready.push(nodeId);
    }
    return ready;
  }

  pause(): void {
    this.paused = true;
  }

  /** Execute the full DAG */
  async execute(): Promise<ExecutionState> {
    this.state.status = "running";
    this.options.emit({ type: "execution:start", executionId: this.state.executionId });

    const contextManager = new ContextManager(this.state.context, this.state.steps);

    while (true) {
      if (this.paused) {
        this.state.status = "paused";
        this.options.emit({ type: "execution:pause", executionId: this.state.executionId });
        await this.options.persist(this.state);
        return this.state;
      }

      // Dispatch all ready nodes
      const readyNodes = this.getReadyNodes();
      for (const nodeId of readyNodes) {
        const node = this.nodeMap.get(nodeId)!;
        const inputs = contextManager.resolveInputs(node.inputs);

        const execCtx: NodeExecutionContext = {
          inputs,
          context: this.state.context,
          logger: {
            info: (msg, data) => this.options.emit({
              type: "node:start", executionId: this.state.executionId, nodeId,
            }),
            warn: (msg) => {},
            error: (msg) => {},
          },
        };

        this.state.steps[nodeId] = {
          nodeId,
          status: "running",
          outputs: {},
          startedAt: new Date().toISOString(),
          attempts: 0,
        };

        this.options.emit({
          type: "node:start",
          executionId: this.state.executionId,
          nodeId,
        });

        const promise = this.options.runner.run(
          node,
          execCtx,
          (nId, attempt) => {
            this.options.emit({
              type: "node:retry",
              executionId: this.state.executionId,
              nodeId: nId,
              attempt,
            });
          }
        );

        this.running.set(nodeId, promise);
      }

      // If nothing is running and nothing is ready, we're done
      if (this.running.size === 0) break;

      // Wait for any node to complete
      const entries = [...this.running.entries()];
      const results = entries.map(([id, p]) => p.then((r) => ({ id, result: r })));
      const { id: completedId, result } = await Promise.race(results);

      this.running.delete(completedId);
      this.state.steps[completedId] = result;

      if (result.status === "completed") {
        this.options.emit({
          type: "node:complete",
          executionId: this.state.executionId,
          nodeId: completedId,
          outputs: result.outputs,
        });

        // Satisfy downstream dependencies
        this.satisfyNode(completedId, result);
      } else if (result.status === "failed") {
        this.options.emit({
          type: "node:fail",
          executionId: this.state.executionId,
          nodeId: completedId,
          error: result.error?.message ?? "Unknown error",
          attempt: result.attempts,
        });

        // Fail the entire execution
        this.state.status = "failed";
        this.options.emit({
          type: "execution:fail",
          executionId: this.state.executionId,
          error: `Node "${completedId}" failed: ${result.error?.message}`,
        });
        await this.options.persist(this.state);
        return this.state;
      }

      await this.options.persist(this.state);
    }

    // Check if all nodes are done
    const allDone = this.workflow.nodes.every((n) => {
      const step = this.state.steps[n.id];
      return step?.status === "completed" || step?.status === "skipped";
    });

    this.state.status = allDone ? "completed" : "failed";

    if (allDone) {
      this.options.emit({ type: "execution:complete", executionId: this.state.executionId });
    } else {
      this.options.emit({
        type: "execution:fail",
        executionId: this.state.executionId,
        error: "Not all nodes completed",
      });
    }

    await this.options.persist(this.state);
    return this.state;
  }
}

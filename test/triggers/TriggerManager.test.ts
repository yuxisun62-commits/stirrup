import { describe, it, expect, vi } from "vitest";
import { WorkflowEngine } from "../../src/engine/Engine.js";
import { NodeRegistry } from "../../src/nodes/NodeRegistry.js";
import { transformHandler } from "../../src/nodes/TransformNode.js";
import { TriggerManager } from "../../src/triggers/TriggerManager.js";
import { CronTriggerHandler } from "../../src/triggers/CronTrigger.js";
import { TelegramTriggerHandler } from "../../src/triggers/TelegramTrigger.js";
import type { WorkflowDefinition } from "../../src/types/workflow.js";
import type { TriggerHandler, TriggerRegistration } from "../../src/triggers/types.js";

function makeEngine(workflows: WorkflowDefinition[]): WorkflowEngine {
  const engine = new WorkflowEngine({ stateStore: new MemoryStore() });
  engine.getRegistry().register("transform", transformHandler);
  for (const wf of workflows) engine.registerWorkflow(wf);
  return engine;
}

// Minimal in-memory state store so tests don't touch disk. Engine's default
// FileStateStore would write to `./executions/*.json` and pollute the repo.
class MemoryStore {
  private states = new Map<string, import("../../src/types/execution.js").ExecutionState>();
  async save(s: import("../../src/types/execution.js").ExecutionState) {
    this.states.set(s.executionId, s);
  }
  async load(id: string) {
    return this.states.get(id) ?? null;
  }
  async list() {
    return [...this.states.values()];
  }
}

function triviallyWorkflow(id: string, extras: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id,
    name: id,
    version: "1",
    nodes: [
      {
        id: "out",
        type: "transform",
        name: "out",
        inputs: [],
        outputs: ["value"],
        config: { expression: "1" },
      },
    ],
    edges: [],
    ...extras,
  };
}

describe("TriggerManager", () => {
  it("only registers handlers for workflows that declare their kind", async () => {
    const workflows = [
      triviallyWorkflow("wf-with-cron", { triggers: { cron: { schedule: "0 0 * * *" } } }),
      triviallyWorkflow("wf-no-trigger"),
    ];
    const engine = makeEngine(workflows);
    const manager = new TriggerManager(engine);
    manager.addHandler(CronTriggerHandler());

    await manager.start();
    // Yield once so the CronTriggerHandler's dynamic import completes; it
    // kicks off via `void (async () => {})()` so we need a microtask tick.
    await new Promise((r) => setImmediate(r));

    const statuses = manager.listStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].workflowId).toBe("wf-with-cron");
    expect(statuses[0].kind).toBe("cron");

    await manager.stop();
  });

  it("refreshWorkflow tears down old triggers and registers new ones", async () => {
    const wf = triviallyWorkflow("wf", { triggers: { cron: { schedule: "0 0 * * *" } } });
    const engine = makeEngine([wf]);
    const manager = new TriggerManager(engine);
    const stopSpy = vi.fn();
    const handler: TriggerHandler = {
      kind: "cron",
      register(workflow): TriggerRegistration | null {
        if (!workflow.triggers?.cron) return null;
        return {
          workflowId: workflow.id,
          kind: "cron",
          label: workflow.triggers.cron.schedule,
          stop: stopSpy,
        };
      },
    };
    manager.addHandler(handler);

    await manager.start();
    expect(manager.listStatuses()).toHaveLength(1);

    // Update the workflow: remove the cron trigger. refreshWorkflow should
    // call the old registration's stop() and not create a replacement.
    wf.triggers = undefined;
    manager.refreshWorkflow(wf);

    expect(stopSpy).toHaveBeenCalledOnce();
    expect(manager.listStatuses()).toHaveLength(0);

    await manager.stop();
  });

  it("reportFireByWorkflow updates the matching registration", async () => {
    const wf = triviallyWorkflow("wf", { triggers: { webhook: { source: "custom" } } });
    const engine = makeEngine([wf]);
    const manager = new TriggerManager(engine);
    manager.addHandler({
      kind: "webhook",
      register: (workflow) =>
        workflow.triggers?.webhook
          ? { workflowId: workflow.id, kind: "webhook", label: "/webhook/custom" }
          : null,
    });

    await manager.start();
    manager.reportFireByWorkflow("wf", "webhook", { executionId: "exec-1" });
    const status = manager.listStatuses().find((s) => s.workflowId === "wf");
    expect(status?.fireCount).toBe(1);
    expect(status?.lastExecutionId).toBe("exec-1");

    manager.reportFireByWorkflow("wf", "webhook", { error: new Error("boom") });
    const updated = manager.listStatuses().find((s) => s.workflowId === "wf");
    expect(updated?.fireCount).toBe(2);
    expect(updated?.lastError?.message).toBe("boom");

    await manager.stop();
  });

  it("telegram handler produces a registration but defers network I/O", async () => {
    // We don't actually hit the Telegram API — TelegramPoller calls getMe
    // inside its loop, which runs asynchronously. As long as no token is
    // stored (the default in CI), the poller logs a warning and exits.
    // What we verify here is that register() returns a registration with
    // the right shape without waiting for the poller.
    const wf = triviallyWorkflow("wf", { triggers: { telegram: {} } });
    const engine = makeEngine([wf]);
    const manager = new TriggerManager(engine);
    manager.addHandler(TelegramTriggerHandler());

    await manager.start();
    const statuses = manager.listStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].kind).toBe("telegram");
    // Stopping aborts the in-flight getUpdates fetch cleanly.
    await manager.stop();
  });
});

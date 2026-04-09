import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStateStore } from "../../src/persistence/SqliteStateStore.js";
import type { ExecutionState } from "../../src/types/execution.js";

function makeState(overrides: Partial<ExecutionState> = {}): ExecutionState {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    status: "completed",
    context: { greeting: "hello" },
    steps: {
      "node-a": {
        nodeId: "node-a",
        status: "completed",
        outputs: { result: 42 },
        startedAt: "2024-01-01T00:00:00Z",
        completedAt: "2024-01-01T00:00:01Z",
        attempts: 1,
      },
      "node-b": {
        nodeId: "node-b",
        status: "skipped",
        outputs: {},
        startedAt: "2024-01-01T00:00:01Z",
        completedAt: "2024-01-01T00:00:01Z",
        attempts: 0,
        selectedBranch: "left",
      },
    },
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:01Z",
    ...overrides,
  };
}

describe("SqliteStateStore", () => {
  let store: SqliteStateStore;

  beforeEach(() => {
    store = new SqliteStateStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("saves and loads an execution state", async () => {
    const state = makeState();
    await store.save(state);
    const loaded = await store.load("exec-1");

    expect(loaded).not.toBeNull();
    expect(loaded!.executionId).toBe("exec-1");
    expect(loaded!.workflowId).toBe("wf-1");
    expect(loaded!.status).toBe("completed");
    expect(loaded!.context).toEqual({ greeting: "hello" });
    expect(loaded!.steps["node-a"].outputs.result).toBe(42);
    expect(loaded!.steps["node-b"].selectedBranch).toBe("left");
    expect(loaded!.steps["node-b"].status).toBe("skipped");
  });

  it("returns null for unknown execution", async () => {
    const loaded = await store.load("nonexistent");
    expect(loaded).toBeNull();
  });

  it("updates an existing execution", async () => {
    const state = makeState({ status: "running" });
    await store.save(state);

    state.status = "completed";
    state.steps["node-c"] = {
      nodeId: "node-c",
      status: "completed",
      outputs: { value: "new" },
      startedAt: "2024-01-01T00:00:02Z",
      completedAt: "2024-01-01T00:00:03Z",
      attempts: 1,
    };
    await store.save(state);

    const loaded = await store.load("exec-1");
    expect(loaded!.status).toBe("completed");
    expect(Object.keys(loaded!.steps)).toHaveLength(3);
    expect(loaded!.steps["node-c"].outputs.value).toBe("new");
  });

  it("lists all executions", async () => {
    await store.save(makeState({ executionId: "exec-1", workflowId: "wf-1" }));
    await store.save(makeState({ executionId: "exec-2", workflowId: "wf-2" }));

    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it("lists executions filtered by workflow ID", async () => {
    await store.save(makeState({ executionId: "exec-1", workflowId: "wf-1" }));
    await store.save(makeState({ executionId: "exec-2", workflowId: "wf-2" }));

    const filtered = await store.list("wf-1");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].workflowId).toBe("wf-1");
  });

  it("deletes an execution and its steps", async () => {
    await store.save(makeState());
    await store.delete("exec-1");
    const loaded = await store.load("exec-1");
    expect(loaded).toBeNull();
  });

  it("handles error field serialization", async () => {
    const state = makeState();
    state.steps["node-a"].error = {
      message: "Something failed",
      stack: "Error: Something failed\n  at ...",
      attempt: 2,
    };
    await store.save(state);

    const loaded = await store.load("exec-1");
    expect(loaded!.steps["node-a"].error).toEqual({
      message: "Something failed",
      stack: "Error: Something failed\n  at ...",
      attempt: 2,
    });
  });
});

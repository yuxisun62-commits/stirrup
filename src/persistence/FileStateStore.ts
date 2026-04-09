import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { ExecutionId, ExecutionState } from "../types/execution.js";
import type { WorkflowId } from "../types/workflow.js";
import type { StateStore } from "./StateStore.js";

export class FileStateStore implements StateStore {
  private dir: string;

  constructor(baseDir: string) {
    this.dir = resolve(baseDir, "executions");
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  private filePath(executionId: ExecutionId): string {
    return join(this.dir, `${executionId}.json`);
  }

  async save(state: ExecutionState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    writeFileSync(this.filePath(state.executionId), JSON.stringify(state, null, 2), "utf-8");
  }

  async load(executionId: ExecutionId): Promise<ExecutionState | null> {
    const path = this.filePath(executionId);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as ExecutionState;
  }

  async list(workflowId?: WorkflowId): Promise<ExecutionState[]> {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    const states: ExecutionState[] = [];
    for (const file of files) {
      const state = JSON.parse(readFileSync(join(this.dir, file), "utf-8")) as ExecutionState;
      if (!workflowId || state.workflowId === workflowId) {
        states.push(state);
      }
    }
    return states;
  }

  async delete(executionId: ExecutionId): Promise<void> {
    const path = this.filePath(executionId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}

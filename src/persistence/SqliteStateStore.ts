import Database from "better-sqlite3";
import type { ExecutionId, ExecutionState, StepResult } from "../types/execution.js";
import type { WorkflowId } from "../types/workflow.js";
import type { StateStore } from "./StateStore.js";
import { runMigrations } from "./migrations.js";

interface ExecutionRow {
  id: string;
  workflow_id: string;
  status: string;
  context: string;
  created_at: string;
  updated_at: string;
}

interface StepRow {
  execution_id: string;
  node_id: string;
  status: string;
  outputs: string;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  attempts: number;
  selected_branch: string | null;
}

export class SqliteStateStore implements StateStore {
  private db: Database.Database;

  private stmts: {
    upsertExecution: Database.Statement;
    upsertStep: Database.Statement;
    loadExecution: Database.Statement;
    loadSteps: Database.Statement;
    listExecutions: Database.Statement;
    listByWorkflow: Database.Statement;
    deleteExecution: Database.Statement;
    deleteSteps: Database.Statement;
  };

  constructor(dbPath: string = "stirrup.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    runMigrations(this.db);

    this.stmts = {
      upsertExecution: this.db.prepare(`
        INSERT OR REPLACE INTO executions (id, workflow_id, status, context, created_at, updated_at)
        VALUES (@id, @workflow_id, @status, @context, @created_at, @updated_at)
      `),
      upsertStep: this.db.prepare(`
        INSERT OR REPLACE INTO steps (execution_id, node_id, status, outputs, error, started_at, completed_at, attempts, selected_branch)
        VALUES (@execution_id, @node_id, @status, @outputs, @error, @started_at, @completed_at, @attempts, @selected_branch)
      `),
      loadExecution: this.db.prepare("SELECT * FROM executions WHERE id = ?"),
      loadSteps: this.db.prepare("SELECT * FROM steps WHERE execution_id = ?"),
      listExecutions: this.db.prepare("SELECT * FROM executions ORDER BY updated_at DESC"),
      listByWorkflow: this.db.prepare("SELECT * FROM executions WHERE workflow_id = ? ORDER BY updated_at DESC"),
      deleteExecution: this.db.prepare("DELETE FROM executions WHERE id = ?"),
      deleteSteps: this.db.prepare("DELETE FROM steps WHERE execution_id = ?"),
    };
  }

  async save(state: ExecutionState): Promise<void> {
    const now = new Date().toISOString();
    const saveAll = this.db.transaction(() => {
      this.stmts.upsertExecution.run({
        id: state.executionId,
        workflow_id: state.workflowId,
        status: state.status,
        context: JSON.stringify(state.context),
        created_at: state.createdAt,
        updated_at: now,
      });

      for (const [nodeId, step] of Object.entries(state.steps)) {
        this.stmts.upsertStep.run({
          execution_id: state.executionId,
          node_id: nodeId,
          status: step.status,
          outputs: JSON.stringify(step.outputs),
          error: step.error ? JSON.stringify(step.error) : null,
          started_at: step.startedAt,
          completed_at: step.completedAt ?? null,
          attempts: step.attempts,
          selected_branch: step.selectedBranch ?? null,
        });
      }
    });

    saveAll();
    state.updatedAt = now;
  }

  async load(executionId: ExecutionId): Promise<ExecutionState | null> {
    const row = this.stmts.loadExecution.get(executionId) as ExecutionRow | undefined;
    if (!row) return null;

    const stepRows = this.stmts.loadSteps.all(executionId) as StepRow[];
    return this.rowsToState(row, stepRows);
  }

  async list(workflowId?: WorkflowId): Promise<ExecutionState[]> {
    const execRows = workflowId
      ? (this.stmts.listByWorkflow.all(workflowId) as ExecutionRow[])
      : (this.stmts.listExecutions.all() as ExecutionRow[]);

    return execRows.map((row) => {
      const stepRows = this.stmts.loadSteps.all(row.id) as StepRow[];
      return this.rowsToState(row, stepRows);
    });
  }

  async delete(executionId: ExecutionId): Promise<void> {
    const deleteAll = this.db.transaction(() => {
      this.stmts.deleteSteps.run(executionId);
      this.stmts.deleteExecution.run(executionId);
    });
    deleteAll();
  }

  close(): void {
    this.db.close();
  }

  private rowsToState(row: ExecutionRow, stepRows: StepRow[]): ExecutionState {
    const steps: Record<string, StepResult> = {};
    for (const sr of stepRows) {
      steps[sr.node_id] = {
        nodeId: sr.node_id,
        status: sr.status as StepResult["status"],
        outputs: JSON.parse(sr.outputs),
        error: sr.error ? JSON.parse(sr.error) : undefined,
        startedAt: sr.started_at,
        completedAt: sr.completed_at ?? undefined,
        attempts: sr.attempts,
        selectedBranch: sr.selected_branch ?? undefined,
      };
    }

    return {
      executionId: row.id,
      workflowId: row.workflow_id,
      status: row.status as ExecutionState["status"],
      context: JSON.parse(row.context),
      steps,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

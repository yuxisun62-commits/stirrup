import type { InputMapping } from "../types/workflow.js";
import type { StepResult } from "../types/execution.js";

/** Get a nested value from an object using a dot-separated path */
export function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a nested value on an object using a dot-separated path */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** Resolves input mappings for a node from completed step outputs and shared context */
export class ContextManager {
  constructor(
    private context: Record<string, unknown>,
    private steps: Record<string, StepResult>
  ) {}

  getContext(): Record<string, unknown> {
    return this.context;
  }

  /** Resolve all InputMappings for a node into a flat inputs object */
  resolveInputs(mappings: InputMapping[]): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const { from, to } of mappings) {
      if (from.startsWith("context.")) {
        resolved[to] = getByPath(this.context, from.slice(8));
      } else if (from.startsWith("nodes.")) {
        // "nodes.<nodeId>.outputs.<field>" -> steps[nodeId].outputs[field]
        const parts = from.split(".");
        const nodeId = parts[1];
        const field = parts.slice(3).join(".");
        const step = this.steps[nodeId];
        if (step?.status === "completed") {
          resolved[to] = getByPath(step.outputs, field);
        }
      }
    }
    return resolved;
  }

  /** Update a value in the shared context */
  updateContext(path: string, value: unknown): void {
    setByPath(this.context, path, value);
  }
}

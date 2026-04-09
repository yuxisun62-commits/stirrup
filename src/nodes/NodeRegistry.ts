import type { NodeType } from "../types/workflow.js";
import type { NodeExecutionContext } from "../types/execution.js";

export type NodeHandler = (
  config: Record<string, unknown>,
  ctx: NodeExecutionContext
) => Promise<Record<string, unknown>>;

export class NodeRegistry {
  private handlers = new Map<string, NodeHandler>();

  register(type: NodeType | string, handler: NodeHandler): void {
    this.handlers.set(type, handler);
  }

  get(type: string): NodeHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler registered for node type: "${type}"`);
    }
    return handler;
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }
}

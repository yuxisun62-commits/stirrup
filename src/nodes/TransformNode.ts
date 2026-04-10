import type { NodeHandler } from "./NodeRegistry.js";
import type { TransformConfig } from "../types/nodes.js";
import { runInSandbox } from "./sandbox.js";

export const transformHandler: NodeHandler = async (config, ctx) => {
  const { expression } = config as unknown as TransformConfig;

  const result = runInSandbox(expression, {
    inputs: ctx.inputs,
    context: ctx.context,
  }, { timeout: 5000 });

  if (result && typeof result === "object") {
    return result as Record<string, unknown>;
  }

  return { result };
};

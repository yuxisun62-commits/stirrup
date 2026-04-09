import vm from "node:vm";
import type { NodeHandler } from "./NodeRegistry.js";
import type { TransformConfig } from "../types/nodes.js";

export const transformHandler: NodeHandler = async (config, ctx) => {
  const { expression } = config as unknown as TransformConfig;

  const sandbox = {
    inputs: ctx.inputs,
    context: ctx.context,
  };

  const result = vm.runInNewContext(expression, sandbox, { timeout: 5000 });

  if (result && typeof result === "object") {
    return result as Record<string, unknown>;
  }

  return { result };
};

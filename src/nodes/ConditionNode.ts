import type { NodeHandler } from "./NodeRegistry.js";
import type { ConditionConfig } from "../types/nodes.js";
import { runInSandbox } from "./sandbox.js";

export const conditionHandler: NodeHandler = async (config, ctx) => {
  const { expression } = config as unknown as ConditionConfig;

  const selectedBranch = runInSandbox(expression, {
    inputs: ctx.inputs,
    context: ctx.context,
  }, { timeout: 5000 });

  if (typeof selectedBranch !== "string") {
    throw new Error(
      `Condition expression must return a string branch name, got: ${typeof selectedBranch}`
    );
  }

  return { selectedBranch };
};

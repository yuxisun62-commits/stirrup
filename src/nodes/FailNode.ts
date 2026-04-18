import type { NodeHandler } from "./NodeRegistry.js";
import type { FailConfig } from "../types/nodes.js";

/**
 * Unconditionally throws. Use on a branch that represents an explicit
 * failure state — n8n's stopAndError, Make's "Break with error", or a
 * manual "this should never happen" guard. The thrown message surfaces
 * as the node's error in the execution state, identical to any other
 * node failure, so retry/continueOnError semantics apply.
 */
export const failHandler: NodeHandler = async (config) => {
  const { message } = (config ?? {}) as FailConfig;
  throw new Error(String(message ?? "Workflow explicitly failed"));
};

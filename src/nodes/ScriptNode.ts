import vm from "node:vm";
import type { NodeHandler } from "./NodeRegistry.js";
import type { ScriptConfig } from "../types/nodes.js";

export const scriptHandler: NodeHandler = async (config, ctx) => {
  const { code, timeoutMs } = config as unknown as ScriptConfig;

  const sandbox = {
    inputs: ctx.inputs,
    context: ctx.context,
    console: {
      log: (msg: string) => ctx.logger.info(msg),
      warn: (msg: string) => ctx.logger.warn(msg),
      error: (msg: string) => ctx.logger.error(msg),
    },
    result: undefined as unknown,
  };

  vm.runInNewContext(code, sandbox, { timeout: timeoutMs ?? 10000 });

  if (sandbox.result && typeof sandbox.result === "object") {
    return sandbox.result as Record<string, unknown>;
  }

  return { result: sandbox.result };
};

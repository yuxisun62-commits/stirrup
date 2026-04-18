import type { NodeHandler } from "./NodeRegistry.js";
import type { PassthroughConfig } from "../types/nodes.js";

/**
 * Forwards inputs → outputs verbatim, optionally merging in a `metadata`
 * object from config. Two primary use cases:
 *
 *   1. Structural connectors — n8n `noOp`, `manualTrigger`, and other
 *      pure-layout nodes that don't do anything but keep the DAG shape.
 *   2. Unmapped-import stubs — the n8n/Make importers drop a passthrough
 *      whenever they hit a node type they don't have a Stirrup equivalent
 *      for, preserving the original vendor params under `metadata.original`
 *      so a human can inspect and swap in a real node later.
 */
export const passthroughHandler: NodeHandler = async (config, ctx) => {
  const { metadata } = (config ?? {}) as PassthroughConfig;
  return {
    ...ctx.inputs,
    ...(metadata ?? {}),
  };
};

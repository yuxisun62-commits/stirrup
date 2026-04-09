import type { NodeHandler } from "../nodes/NodeRegistry.js";
import type { ToolDefinition } from "../ai/ToolManager.js";

/** What a plugin's package.json `workflowHarness` field looks like */
export interface PluginManifest {
  nodeTypes?: string[];
  tools?: string[];
}

/** Context passed to a plugin's register function */
export interface PluginContext {
  registerNodeType(type: string, handler: NodeHandler): void;
  registerTool(tool: ToolDefinition): void;
}

/** Metadata about a loaded plugin */
export interface PluginInfo {
  name: string;
  version: string;
  source: string;
  nodeTypes: string[];
  tools: string[];
}

/** The shape of a plugin's default export */
export type PluginRegisterFn = (ctx: PluginContext) => void | Promise<void>;

import type { PluginContext } from "../../src/plugins/PluginManifest.js";

export default function register(ctx: PluginContext): void {
  ctx.registerNodeType("test-echo", async (config, execCtx) => {
    const message = (config as { message?: string }).message ?? "echo";
    return { echo: message, inputs: execCtx.inputs };
  });

  ctx.registerTool({
    name: "test-reverse",
    description: "Reverses a string",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    handler: async (input) => {
      const text = input.text as string;
      return { reversed: text.split("").reverse().join("") };
    },
  });
}

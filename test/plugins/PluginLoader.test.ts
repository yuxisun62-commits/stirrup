import { describe, it, expect, beforeEach } from "vitest";
import { PluginLoader } from "../../src/plugins/PluginLoader.js";
import { NodeRegistry } from "../../src/nodes/NodeRegistry.js";
import { ToolManager } from "../../src/ai/ToolManager.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("PluginLoader", () => {
  let registry: NodeRegistry;
  let toolManager: ToolManager;
  let loader: PluginLoader;

  beforeEach(() => {
    registry = new NodeRegistry();
    toolManager = new ToolManager();
    loader = new PluginLoader(registry, toolManager);
  });

  it("loads a plugin and registers node types and tools", async () => {
    const pluginPath = resolve(__dirname, "test-plugin.ts");
    const info = await loader.load(pluginPath);

    expect(info.nodeTypes).toContain("test-echo");
    expect(info.tools).toContain("test-reverse");
    expect(registry.has("test-echo")).toBe(true);
    expect(toolManager.has("test-reverse")).toBe(true);
  });

  it("executes a plugin-registered node handler", async () => {
    const pluginPath = resolve(__dirname, "test-plugin.ts");
    await loader.load(pluginPath);

    const handler = registry.get("test-echo");
    const result = await handler(
      { message: "hello" },
      { inputs: { x: 1 }, context: {}, logger: { info: () => {}, warn: () => {}, error: () => {} } }
    );
    expect(result.echo).toBe("hello");
    expect(result.inputs).toEqual({ x: 1 });
  });

  it("executes a plugin-registered tool", async () => {
    const pluginPath = resolve(__dirname, "test-plugin.ts");
    await loader.load(pluginPath);

    const result = await toolManager.execute("test-reverse", { text: "abc" });
    expect(result).toEqual({ reversed: "cba" });
  });

  it("tracks loaded plugins", async () => {
    const pluginPath = resolve(__dirname, "test-plugin.ts");
    await loader.load(pluginPath);

    const plugins = loader.getLoadedPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0].nodeTypes).toContain("test-echo");
  });

  it("throws on invalid plugin", async () => {
    await expect(loader.load("nonexistent-plugin-xyz")).rejects.toThrow("Failed to import");
  });
});

import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import type { NodeRegistry } from "../nodes/NodeRegistry.js";
import type { ToolManager } from "../ai/ToolManager.js";
import type { PluginContext, PluginInfo, PluginRegisterFn } from "./PluginManifest.js";

export class PluginLoader {
  private plugins: PluginInfo[] = [];

  constructor(
    private registry: NodeRegistry,
    private toolManager: ToolManager
  ) {}

  /** Load all plugins listed in a config file or array of specifiers */
  async loadAll(specifiers: string[]): Promise<void> {
    for (const spec of specifiers) {
      await this.load(spec);
    }
  }

  /** Load a single plugin by npm package name or relative/absolute path */
  async load(specifier: string): Promise<PluginInfo> {
    const nodeTypes: string[] = [];
    const tools: string[] = [];

    const ctx: PluginContext = {
      registerNodeType: (type, handler) => {
        this.registry.register(type, handler);
        nodeTypes.push(type);
      },
      registerTool: (tool) => {
        this.toolManager.register(tool);
        tools.push(tool.name);
      },
    };

    // Resolve the module path
    const modulePath = this.resolveSpecifier(specifier);

    let mod: { default?: PluginRegisterFn };
    try {
      mod = await import(modulePath);
    } catch (err) {
      throw new Error(
        `Failed to import plugin "${specifier}": ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const registerFn = mod.default;
    if (typeof registerFn !== "function") {
      throw new Error(
        `Plugin "${specifier}" does not export a default function`
      );
    }

    await registerFn(ctx);

    // Try to read package.json for metadata
    let name = specifier;
    let version = "unknown";
    try {
      const pkgPath = this.findPackageJson(specifier);
      if (pkgPath) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        name = pkg.name ?? specifier;
        version = pkg.version ?? "unknown";
      }
    } catch {
      // Ignore — metadata is optional
    }

    const info: PluginInfo = { name, version, source: specifier, nodeTypes, tools };
    this.plugins.push(info);
    return info;
  }

  getLoadedPlugins(): PluginInfo[] {
    return [...this.plugins];
  }

  private resolveSpecifier(specifier: string): string {
    if (specifier.startsWith(".") || isAbsolute(specifier)) {
      return resolve(process.cwd(), specifier);
    }
    return specifier;
  }

  private findPackageJson(specifier: string): string | null {
    // For local paths
    if (specifier.startsWith(".") || isAbsolute(specifier)) {
      const dir = resolve(process.cwd(), specifier);
      const pkgPath = resolve(dir, "package.json");
      return existsSync(pkgPath) ? pkgPath : null;
    }
    // For npm packages, try node_modules
    const pkgPath = resolve(process.cwd(), "node_modules", specifier, "package.json");
    return existsSync(pkgPath) ? pkgPath : null;
  }
}

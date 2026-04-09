import type { CommandModule } from "yargs";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { loadConfig } from "../config.js";
import { createEngine } from "../createEngine.js";
import { PluginLoader } from "../../plugins/PluginLoader.js";
import { ToolManager } from "../../ai/ToolManager.js";
import { startServer } from "../../server/index.js";

interface UiArgs {
  port?: number;
  open?: boolean;
  "workflows-dir"?: string;
  "state-dir"?: string;
  verbose?: boolean;
  store?: string;
  db?: string;
}

export const uiCommand: CommandModule<{}, UiArgs> = {
  command: "ui",
  describe: "Launch the visual editor web UI",
  builder: (yargs) =>
    yargs
      .option("port", {
        alias: "p",
        type: "number",
        default: 3710,
        describe: "Port for the web server",
      })
      .option("open", {
        type: "boolean",
        default: true,
        describe: "Open browser automatically",
      }),
  handler: async (argv) => {
    const config = loadConfig({
      workflowsDir: argv["workflows-dir"],
      stateDir: argv["state-dir"],
      verbose: argv.verbose,
      store: argv.store as "sqlite" | "file" | undefined,
      dbPath: argv.db,
    });

    const engine = createEngine(config);
    const toolManager = new ToolManager();
    const pluginLoader = new PluginLoader(engine.getRegistry(), toolManager);

    if (config.plugins.length > 0) {
      await pluginLoader.loadAll(config.plugins);
    }

    const port = argv.port ?? 3710;
    await startServer({
      engine,
      pluginLoader,
      workflowsDir: resolve(config.workflowsDir),
      port,
    });

    if (argv.open) {
      const url = `http://localhost:${port}`;
      if (process.platform === "win32") {
        execFile("cmd", ["/c", "start", url]);
      } else if (process.platform === "darwin") {
        execFile("open", [url]);
      } else {
        execFile("xdg-open", [url]);
      }
    }
  },
};

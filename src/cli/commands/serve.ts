import type { CommandModule } from "yargs";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { createEngine } from "../createEngine.js";
import { PluginLoader } from "../../plugins/PluginLoader.js";
import { startServer } from "../../server/index.js";
import { heading, info } from "../output.js";

interface ServeArgs {
  port?: number;
  "workflows-dir"?: string;
  "state-dir"?: string;
  verbose?: boolean;
  store?: string;
  db?: string;
}

/**
 * `stirrup serve` — run the main server with triggers active.
 *
 * As of the Triggers subsystem (v0.7.0) there is no separate serve-only
 * binary: the UI server on port 3710 already runs the TriggerManager, and
 * the UI can be left untouched by simply ignoring it. This command is kept
 * because existing docs and habits reach for `stirrup serve`; it delegates
 * to the same startServer() that `stirrup ui` uses.
 */
export const serveCommand: CommandModule<{}, ServeArgs> = {
  command: "serve",
  describe: "Run workflows as an HTTP service with triggers active",
  builder: (yargs) =>
    yargs.option("port", {
      alias: "p",
      type: "number",
      default: 3710,
      describe: "Port to listen on",
    }),
  handler: async (argv) => {
    const config = loadConfig({
      workflowsDir: argv["workflows-dir"],
      stateDir: argv["state-dir"],
      verbose: argv.verbose,
      store: argv.store as "sqlite" | "file" | undefined,
      dbPath: argv.db,
    });

    const { engine, toolManager } = await createEngine(config);
    const pluginLoader = new PluginLoader(engine.getRegistry(), toolManager);
    if (config.plugins.length > 0) {
      await pluginLoader.loadAll(config.plugins);
    }

    heading("Stirrup Service");
    info(`Loading workflows from: ${config.workflowsDir}`);

    await startServer({
      engine,
      pluginLoader,
      toolManager,
      workflowsDir: resolve(config.workflowsDir),
      port: argv.port,
    });
  },
};

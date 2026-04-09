import type { CommandModule } from "yargs";
import { loadConfig } from "../config.js";
import { createEngine } from "../createEngine.js";
import { WorkflowServer } from "../../serve/WorkflowServer.js";
import { heading, info } from "../output.js";

interface ServeArgs {
  port?: number;
  "workflows-dir"?: string;
  "state-dir"?: string;
  verbose?: boolean;
  store?: string;
  db?: string;
}

export const serveCommand: CommandModule<{}, ServeArgs> = {
  command: "serve",
  describe: "Run workflows as a persistent HTTP service",
  builder: (yargs) =>
    yargs
      .option("port", {
        alias: "p",
        type: "number",
        default: 3711,
        describe: "Port for the workflow service",
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

    heading("Workflow Service");
    info(`Loading workflows from: ${config.workflowsDir}`);

    const server = new WorkflowServer({
      engine,
      port: argv.port,
    });

    // Graceful shutdown
    process.on("SIGINT", () => {
      console.log("\nShutting down...");
      server.stop();
      process.exit(0);
    });

    await server.start();
  },
};

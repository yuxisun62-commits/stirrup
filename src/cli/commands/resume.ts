import type { CommandModule } from "yargs";
import ora from "ora";
import { loadConfig } from "../config.js";
import { createEngine } from "../createEngine.js";
import { statusBadge, heading, success, error } from "../output.js";

interface ResumeArgs {
  "execution-id": string;
  "workflows-dir"?: string;
  "state-dir"?: string;
  verbose?: boolean;
  store?: string;
  db?: string;
}

export const resumeCommand: CommandModule<{}, ResumeArgs> = {
  command: "resume <execution-id>",
  describe: "Resume a paused or failed execution",
  builder: (yargs) =>
    yargs.positional("execution-id", {
      type: "string",
      describe: "Execution ID to resume",
      demandOption: true,
    }),
  handler: async (argv) => {
    const config = loadConfig({
      workflowsDir: argv["workflows-dir"],
      stateDir: argv["state-dir"],
      verbose: argv.verbose,
      store: argv.store as "sqlite" | "file" | undefined,
      dbPath: argv.db,
    });

    const { engine } = await createEngine(config);

    engine.on("node:start", (e) => {
      console.log(`  ${statusBadge("running")} ${e.nodeId}`);
    });
    engine.on("node:complete", (e) => {
      console.log(`  ${statusBadge("completed")} ${e.nodeId}`);
    });
    engine.on("node:fail", (e) => {
      console.log(`  ${statusBadge("failed")} ${e.nodeId}: ${e.error}`);
    });
    engine.on("node:skip", (e) => {
      console.log(`  ${statusBadge("skipped")} ${e.nodeId}`);
    });

    heading(`Resuming execution: ${argv["execution-id"]}`);

    const spinner = ora("Resuming...").start();
    try {
      const result = await engine.resume(argv["execution-id"]);
      spinner.stop();

      console.log(`  Status: ${statusBadge(result.status)}`);
      if (result.status === "completed") {
        success("Workflow resumed and completed successfully");
      } else {
        error(`Workflow ${result.status}`);
        process.exit(1);
      }
    } catch (err) {
      spinner.stop();
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

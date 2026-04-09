import type { CommandModule } from "yargs";
import { loadConfig } from "../config.js";
import { createEngine } from "../createEngine.js";
import { statusBadge, heading, info, table } from "../output.js";

interface StatusArgs {
  "execution-id"?: string;
  "workflows-dir"?: string;
  "state-dir"?: string;
  verbose?: boolean;
  store?: string;
  db?: string;
}

export const statusCommand: CommandModule<{}, StatusArgs> = {
  command: "status [execution-id]",
  describe: "Show execution state(s)",
  builder: (yargs) =>
    yargs.positional("execution-id", {
      type: "string",
      describe: "Specific execution ID to inspect",
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

    if (argv["execution-id"]) {
      const state = await engine.getState(argv["execution-id"]);
      if (!state) {
        info(`Execution not found: ${argv["execution-id"]}`);
        return;
      }

      heading(`Execution: ${state.executionId}`);
      console.log(`  Workflow:  ${state.workflowId}`);
      console.log(`  Status:    ${statusBadge(state.status)}`);
      console.log(`  Created:   ${state.createdAt}`);
      console.log(`  Updated:   ${state.updatedAt}`);
      console.log();

      const rows = [["NODE", "STATUS", "ATTEMPTS"]];
      for (const [nodeId, step] of Object.entries(state.steps)) {
        rows.push([nodeId, statusBadge(step.status), String(step.attempts)]);
      }
      table(rows);

      if (config.verbose) {
        console.log("\nContext:", JSON.stringify(state.context, null, 2));
      }
    } else {
      const executions = await engine.listExecutions();
      if (executions.length === 0) {
        info("No executions found.");
        return;
      }

      heading("Executions");
      const rows = [["ID", "WORKFLOW", "STATUS", "UPDATED"]];
      for (const exec of executions) {
        rows.push([
          exec.executionId.slice(0, 8) + "...",
          exec.workflowId,
          statusBadge(exec.status),
          exec.updatedAt,
        ]);
      }
      table(rows);
    }
  },
};

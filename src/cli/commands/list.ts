import type { CommandModule } from "yargs";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { loadWorkflowDirectory } from "../../loader/WorkflowLoader.js";
import { heading, info, table } from "../output.js";

export const listCommand: CommandModule = {
  command: "list",
  describe: "List available workflow definitions",
  handler: (argv) => {
    const config = loadConfig({
      workflowsDir: (argv as Record<string, string>)["workflows-dir"],
    });

    const dir = resolve(config.workflowsDir);
    if (!existsSync(dir)) {
      info(`No workflows directory found at: ${dir}`);
      return;
    }

    const workflows = loadWorkflowDirectory(dir);

    if (workflows.size === 0) {
      info("No workflows found.");
      return;
    }

    heading("Available Workflows");
    const rows = [["ID", "NAME", "VERSION", "NODES"]];
    for (const [id, wf] of workflows) {
      rows.push([id, wf.name, wf.version, String(wf.nodes.length)]);
    }
    table(rows);
  },
};

import type { CommandModule } from "yargs";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { validateWorkflow, WorkflowValidationError } from "../../validation/WorkflowValidator.js";
import { loadWorkflowFile } from "../../loader/WorkflowLoader.js";
import { success, error, info } from "../output.js";

interface ValidateArgs {
  file: string;
}

export const validateCommand: CommandModule<{}, ValidateArgs> = {
  command: "validate <file>",
  describe: "Validate a workflow YAML/JSON file",
  builder: (yargs) =>
    yargs.positional("file", {
      type: "string",
      describe: "Path to workflow file",
      demandOption: true,
    }),
  handler: (argv) => {
    const filePath = resolve(argv.file);
    if (!existsSync(filePath)) {
      error(`File not found: ${filePath}`);
      process.exit(1);
    }

    try {
      const workflow = loadWorkflowFile(filePath);
      success(`Valid workflow: "${workflow.name}" (${workflow.id})`);
      info(`  ${workflow.nodes.length} nodes, ${workflow.edges.length} edges`);
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        error(`Validation failed: ${err.message}`);
        for (const detail of err.details) {
          console.log(`  - ${detail}`);
        }
      } else {
        error(err instanceof Error ? err.message : String(err));
      }
      process.exit(1);
    }
  },
};

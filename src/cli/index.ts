import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";
import { statusCommand } from "./commands/status.js";
import { resumeCommand } from "./commands/resume.js";
import { validateCommand } from "./commands/validate.js";
import { uiCommand } from "./commands/ui.js";
import { initCommand } from "./commands/init.js";
import { pluginCommand } from "./commands/plugin.js";
import { serveCommand } from "./commands/serve.js";
import { exportCommand } from "./commands/export.js";
import { configCommand } from "./commands/config.js";
import { authCommand } from "./commands/auth.js";
import { importCommand } from "./commands/import.js";

yargs(hideBin(process.argv))
  .scriptName("stirrup")
  .usage("$0 <command> [options]")
  .command(runCommand)
  .command(listCommand)
  .command(statusCommand)
  .command(resumeCommand)
  .command(validateCommand)
  .command(uiCommand)
  .command(initCommand)
  .command(pluginCommand)
  .command(serveCommand)
  .command(configCommand)
  .command(exportCommand)
  .command(authCommand)
  .command(importCommand)
  .option("workflows-dir", {
    alias: "w",
    type: "string",
    default: "./workflows",
    describe: "Directory containing workflow definitions",
  })
  .option("state-dir", {
    alias: "s",
    type: "string",
    default: ".",
    describe: "Directory for state storage (file mode)",
  })
  .option("verbose", {
    alias: "v",
    type: "boolean",
    default: false,
    describe: "Enable verbose output",
  })
  .option("store", {
    type: "string",
    default: "sqlite",
    choices: ["sqlite", "file"],
    describe: "State store backend",
  })
  .option("db", {
    type: "string",
    default: "./stirrup.db",
    describe: "SQLite database path",
  })
  .demandCommand(1, "Please specify a command")
  .strict()
  .help()
  .parse();

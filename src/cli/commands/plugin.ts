import type { CommandModule } from "yargs";

export const pluginCommand: CommandModule = {
  command: "plugin <subcommand>",
  describe: "Manage plugins",
  builder: (yargs) =>
    yargs
      .command({
        command: "list",
        describe: "List installed plugins",
        handler: () => {
          console.log("(Plugin system not yet implemented — coming in Phase C)");
        },
      })
      .command({
        command: "add <package>",
        describe: "Install and register a plugin",
        builder: (y) =>
          y.positional("package", {
            type: "string",
            describe: "npm package name or local path",
            demandOption: true,
          }),
        handler: (argv) => {
          console.log(`Would install plugin: ${(argv as Record<string, unknown>).package}`);
          console.log("(Plugin system not yet implemented — coming in Phase C)");
        },
      })
      .command({
        command: "remove <package>",
        describe: "Unregister and uninstall a plugin",
        builder: (y) =>
          y.positional("package", {
            type: "string",
            describe: "Plugin package name",
            demandOption: true,
          }),
        handler: (argv) => {
          console.log(`Would remove plugin: ${(argv as Record<string, unknown>).package}`);
          console.log("(Plugin system not yet implemented — coming in Phase C)");
        },
      })
      .demandCommand(1),
  handler: () => {},
};

import type { CommandModule } from "yargs";
import { loadConfigFile, saveConfigFile, getConfigPath, type ConfigFile } from "../config.js";
import { success, error, info, heading } from "../output.js";

const KNOWN_KEYS: Record<string, { description: string; secret?: boolean }> = {
  anthropicApiKey: { description: "Anthropic API key for AI nodes", secret: true },
  apiToken: { description: "Bearer token for API authentication (STIRRUP_API_TOKEN)", secret: true },
  workflowsDir: { description: "Default workflows directory" },
  stateStore: { description: "State store backend (sqlite | file)" },
  dbPath: { description: "SQLite database path" },
};

export const configCommand: CommandModule = {
  command: "config <subcommand>",
  describe: "Manage Stirrup configuration",
  builder: (yargs) =>
    yargs
      .command({
        command: "set <key> <value>",
        describe: "Set a config value",
        builder: (y) =>
          y
            .positional("key", { type: "string", describe: "Config key", demandOption: true })
            .positional("value", { type: "string", describe: "Config value", demandOption: true }),
        handler: (argv) => {
          const key = argv.key as string;
          const value = argv.value as string;

          if (!KNOWN_KEYS[key]) {
            error(`Unknown config key: "${key}". Valid keys: ${Object.keys(KNOWN_KEYS).join(", ")}`);
            process.exit(1);
          }

          const config = loadConfigFile();
          (config as Record<string, unknown>)[key] = value;
          saveConfigFile(config);

          const meta = KNOWN_KEYS[key];
          const display = meta?.secret ? value.slice(0, 8) + "..." + value.slice(-4) : value;
          success(`Set ${key} = ${display}`);
          info(`  Saved to ${getConfigPath()}`);
        },
      })
      .command({
        command: "get [key]",
        describe: "Get a config value (or show all)",
        builder: (y) =>
          y.positional("key", { type: "string", describe: "Config key (omit to show all)" }),
        handler: (argv) => {
          const config = loadConfigFile();
          const key = argv.key as string | undefined;

          if (key) {
            const value = (config as Record<string, unknown>)[key];
            if (value === undefined) {
              info(`${key}: (not set)`);
            } else {
              const meta = KNOWN_KEYS[key];
              const display = meta?.secret ? String(value).slice(0, 8) + "..." + String(value).slice(-4) : String(value);
              console.log(display);
            }
          } else {
            heading("Stirrup Configuration");
            info(`Config file: ${getConfigPath()}`);
            console.log();

            const allKeys = new Set([...Object.keys(KNOWN_KEYS), ...Object.keys(config)]);
            for (const k of allKeys) {
              const value = (config as Record<string, unknown>)[k];
              const meta = KNOWN_KEYS[k];
              const desc = meta?.description ? ` — ${meta.description}` : "";

              if (value === undefined) {
                console.log(`  ${k}: (not set)${desc}`);
              } else {
                const display = meta?.secret ? String(value).slice(0, 8) + "..." + String(value).slice(-4) : String(value);
                console.log(`  ${k}: ${display}${desc}`);
              }
            }

            // Show env var status
            console.log();
            info("Environment:");
            const envKey = process.env.ANTHROPIC_API_KEY;
            if (envKey) {
              console.log(`  ANTHROPIC_API_KEY: ${envKey.slice(0, 8)}...${envKey.slice(-4)} (from env)`);
            } else {
              console.log(`  ANTHROPIC_API_KEY: (not set)`);
            }
          }
        },
      })
      .command({
        command: "unset <key>",
        describe: "Remove a config value",
        builder: (y) =>
          y.positional("key", { type: "string", describe: "Config key", demandOption: true }),
        handler: (argv) => {
          const key = argv.key as string;
          const config = loadConfigFile();
          delete (config as Record<string, unknown>)[key];
          saveConfigFile(config);
          success(`Removed ${key}`);
        },
      })
      .command({
        command: "path",
        describe: "Show the config file path",
        handler: () => {
          console.log(getConfigPath());
        },
      })
      .demandCommand(1),
  handler: () => {},
};

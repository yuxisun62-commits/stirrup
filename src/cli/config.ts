import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface AppConfig {
  workflowsDir: string;
  stateDir: string;
  store: "sqlite" | "file";
  dbPath: string;
  verbose: boolean;
  plugins: string[];
  anthropicApiKey?: string;
}

export interface ConfigFile {
  workflowsDir?: string;
  stateStore?: "sqlite" | "file";
  dbPath?: string;
  plugins?: string[];
  anthropicApiKey?: string;
}

const CONFIG_FILE = ".stirrup.json";

export function getConfigPath(): string {
  return resolve(process.cwd(), CONFIG_FILE);
}

export function loadConfigFile(): ConfigFile {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, "utf-8")) as ConfigFile;
  }
  return {};
}

export function saveConfigFile(config: ConfigFile): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
}

export function loadConfig(cliArgs: Partial<AppConfig> = {}): AppConfig {
  const fileConfig = loadConfigFile();

  // API key: CLI arg > config file > env var
  const anthropicApiKey =
    cliArgs.anthropicApiKey ??
    fileConfig.anthropicApiKey ??
    process.env.ANTHROPIC_API_KEY ??
    undefined;

  // If we resolved a key from config, set it in env so the SDK picks it up
  if (anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = anthropicApiKey;
  }

  return {
    workflowsDir: cliArgs.workflowsDir ?? fileConfig.workflowsDir ?? "./workflows",
    stateDir: cliArgs.stateDir ?? ".",
    store: cliArgs.store ?? fileConfig.stateStore ?? "sqlite",
    dbPath: cliArgs.dbPath ?? fileConfig.dbPath ?? "./stirrup.db",
    verbose: cliArgs.verbose ?? false,
    plugins: fileConfig.plugins ?? [],
    anthropicApiKey,
  };
}

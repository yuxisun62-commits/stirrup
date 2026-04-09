import type { CommandModule } from "yargs";
import { resolve, extname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { input, confirm } from "@inquirer/prompts";
import ora from "ora";
import { loadConfig } from "../config.js";
import { createEngine } from "../createEngine.js";
import { statusBadge, heading, success, error, info } from "../output.js";
import type { WorkflowParam } from "../../types/workflow.js";

interface RunArgs {
  workflow: string;
  context?: string;
  "context-file"?: string;
  set?: string[];
  watch?: boolean;
  interactive?: boolean;
  "workflows-dir"?: string;
  "state-dir"?: string;
  verbose?: boolean;
  store?: string;
  db?: string;
}

export const runCommand: CommandModule<{}, RunArgs> = {
  command: "run <workflow>",
  describe: "Execute a workflow (ID or file path)",
  builder: (yargs) =>
    yargs
      .positional("workflow", {
        type: "string",
        describe: "Workflow ID or path to workflow file",
        demandOption: true,
      })
      .option("set", {
        type: "array",
        string: true,
        describe: "Set a parameter: --set repo=owner/repo --set prNumber=123",
      })
      .option("context", {
        alias: "c",
        type: "string",
        describe: "JSON string of context values",
      })
      .option("context-file", {
        type: "string",
        describe: "Path to a JSON file with context values",
      })
      .option("interactive", {
        alias: "i",
        type: "boolean",
        default: true,
        describe: "Prompt for missing required parameters",
      })
      .option("watch", {
        type: "boolean",
        default: true,
        describe: "Stream events to terminal as they occur",
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
    const workflow = argv.workflow;

    // Load workflow
    const ext = extname(workflow).toLowerCase();
    let workflowId: string;
    if (ext === ".yaml" || ext === ".yml" || ext === ".json") {
      const filePath = resolve(workflow);
      if (!existsSync(filePath)) {
        error(`File not found: ${filePath}`);
        process.exit(1);
      }
      const def = engine.loadWorkflow(filePath);
      workflowId = def.id;
    } else {
      workflowId = workflow;
    }

    // Build context from multiple sources
    let initialContext: Record<string, unknown> = {};

    // 1. From --context-file
    if (argv["context-file"]) {
      const cfPath = resolve(argv["context-file"]);
      if (!existsSync(cfPath)) {
        error(`Context file not found: ${cfPath}`);
        process.exit(1);
      }
      try {
        initialContext = { ...initialContext, ...JSON.parse(readFileSync(cfPath, "utf-8")) };
      } catch {
        error("Invalid JSON in context file");
        process.exit(1);
      }
    }

    // 2. From --context JSON string
    if (argv.context) {
      try {
        initialContext = { ...initialContext, ...JSON.parse(argv.context) };
      } catch {
        error("Invalid JSON for --context");
        process.exit(1);
      }
    }

    // 3. From --set key=value pairs
    if (argv.set) {
      for (const pair of argv.set) {
        const eqIdx = pair.indexOf("=");
        if (eqIdx === -1) {
          error(`Invalid --set format: "${pair}" (expected key=value)`);
          process.exit(1);
        }
        const key = pair.slice(0, eqIdx);
        const rawValue = pair.slice(eqIdx + 1);
        initialContext[key] = parseParamValue(rawValue);
      }
    }

    // 4. Interactive prompting for missing required params
    const wfDef = (engine as any).workflows.get(workflowId);
    const params: WorkflowParam[] = wfDef?.params ?? [];

    if (params.length > 0 && argv.interactive) {
      const allContext = { ...(wfDef?.context ?? {}), ...initialContext };

      // Show what params exist
      const missingRequired = params.filter(
        (p) => p.required && allContext[p.name] === undefined
      );
      const missingOptional = params.filter(
        (p) => !p.required && allContext[p.name] === undefined && p.default === undefined
      );

      if (missingRequired.length > 0 || missingOptional.length > 0) {
        heading("Workflow Parameters");
        if (params.length > 0) {
          for (const p of params) {
            const hasValue = allContext[p.name] !== undefined;
            const marker = p.required ? " (required)" : "";
            if (hasValue) {
              info(`  ${p.name}${marker}: ${JSON.stringify(allContext[p.name])}`);
            }
          }
        }
      }

      // Prompt for missing required params
      for (const param of missingRequired) {
        const description = param.description ? ` — ${param.description}` : "";
        if (param.type === "boolean") {
          initialContext[param.name] = await confirm({
            message: `${param.name}${description}:`,
            default: param.default as boolean | undefined,
          });
        } else {
          const answer = await input({
            message: `${param.name} (${param.type})${description}:`,
            default: param.default !== undefined ? String(param.default) : undefined,
          });
          initialContext[param.name] = coerceValue(answer, param.type);
        }
      }

      // Offer to fill optional params
      if (missingOptional.length > 0) {
        const fillOptional = await confirm({
          message: `Set ${missingOptional.length} optional parameter(s)?`,
          default: false,
        });
        if (fillOptional) {
          for (const param of missingOptional) {
            const description = param.description ? ` — ${param.description}` : "";
            const answer = await input({
              message: `${param.name} (${param.type}, optional)${description}:`,
            });
            if (answer.trim()) {
              initialContext[param.name] = coerceValue(answer, param.type);
            }
          }
        }
      }
    }

    // Set up event listeners
    if (argv.watch) {
      engine.on("node:start", (e) => {
        console.log(`  ${statusBadge("running")} ${e.nodeId}`);
      });
      engine.on("node:complete", (e) => {
        console.log(`  ${statusBadge("completed")} ${e.nodeId}`);
        if (config.verbose) {
          console.log(`    outputs: ${JSON.stringify(e.outputs)}`);
        }
      });
      engine.on("node:fail", (e) => {
        console.log(`  ${statusBadge("failed")} ${e.nodeId}: ${e.error}`);
      });
      engine.on("node:skip", (e) => {
        console.log(`  ${statusBadge("skipped")} ${e.nodeId}: ${e.reason}`);
      });
      engine.on("node:retry", (e) => {
        console.log(`  ↻ Retrying ${e.nodeId} (attempt ${e.attempt + 1})`);
      });
    }

    heading(`Running workflow: ${workflowId}`);

    const spinner = ora("Executing...").start();
    try {
      const result = await engine.execute(workflowId, initialContext);
      spinner.stop();

      console.log(`\n  Execution: ${result.executionId}`);
      console.log(`  Status:    ${statusBadge(result.status)}`);

      if (result.status === "completed") {
        success("Workflow completed successfully");
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

function parseParamValue(raw: string): unknown {
  // Try JSON first (for objects, arrays, numbers, booleans)
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function coerceValue(raw: string, type: string): unknown {
  switch (type) {
    case "number":
      return Number(raw);
    case "boolean":
      return raw.toLowerCase() === "true" || raw === "1";
    case "json":
      try { return JSON.parse(raw); } catch { return raw; }
    default:
      return raw;
  }
}

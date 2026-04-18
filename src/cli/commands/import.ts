import type { CommandModule } from "yargs";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { stringify as yamlStringify } from "yaml";
import { importN8nWorkflow } from "../../import/n8n.js";
import { importMakeBlueprint } from "../../import/make.js";
import { validateWorkflow } from "../../validation/WorkflowValidator.js";
import { loadConfig } from "../config.js";
import { success, error, info } from "../output.js";

interface ImportArgs {
  file: string;
  format?: string;
  "workflows-dir"?: string;
  "dry-run"?: boolean;
}

export const importCommand: CommandModule<{}, ImportArgs> = {
  command: "import <file>",
  describe: "Import a workflow from n8n (more formats coming)",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "Path to the source workflow JSON",
        demandOption: true,
      })
      .option("format", {
        type: "string",
        default: "n8n",
        choices: ["n8n", "make"],
        describe: "Source format to import from",
      })
      .option("workflows-dir", {
        type: "string",
        describe: "Directory to save the imported workflow (defaults to loaded config)",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "Print the report without writing the .yaml",
      }),
  handler: (argv) => {
    const filePath = resolve(argv.file);
    if (!existsSync(filePath)) {
      error(`File not found: ${filePath}`);
      process.exit(1);
    }

    let source: unknown;
    try {
      source = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (err) {
      error(`Failed to parse JSON: ${(err as Error).message}`);
      process.exit(1);
    }

    const { workflow, report } = argv.format === "make"
      ? importMakeBlueprint(source as any)
      : importN8nWorkflow(source as any);

    try {
      validateWorkflow(workflow);
    } catch (err) {
      error(`Imported workflow failed schema validation: ${(err as Error).message}`);
      process.exit(1);
    }

    info(`Source: ${report.sourceName}`);
    info(`  Nodes: ${report.nodeCount} | Edges: ${report.edgeCount}`);
    const mappedTotal = Object.values(report.mapped).reduce((a, b) => a + b, 0);
    const stubbedTotal = Object.values(report.stubbed).reduce((a, b) => a + b, 0);
    const droppedTotal = Object.values(report.dropped).reduce((a, b) => a + b, 0);
    info(`  Mapped: ${mappedTotal} | Stubbed: ${stubbedTotal} | Dropped: ${droppedTotal}`);

    if (stubbedTotal > 0) {
      info(`  Stubbed types (need manual mapping):`);
      for (const [t, c] of Object.entries(report.stubbed).sort((a, b) => b[1] - a[1])) {
        info(`    ${String(c).padStart(3)}  ${t}`);
      }
    }

    if (report.warnings.length > 0) {
      info(`  Warnings:`);
      for (const w of report.warnings.slice(0, 10)) info(`    ! ${w}`);
      if (report.warnings.length > 10) info(`    (${report.warnings.length - 10} more…)`);
    }

    if (argv["dry-run"]) {
      info(`\nDry run — not writing file.`);
      return;
    }

    const config = loadConfig({ workflowsDir: argv["workflows-dir"] });
    const outDir = resolve(config.workflowsDir);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, `${workflow.id}.yaml`);
    writeFileSync(outPath, yamlStringify(workflow), "utf-8");

    success(`Wrote ${outPath}`);
    info(`  Workflow id: ${workflow.id}`);
    if (stubbedTotal > 0) {
      info(`  Open in the UI to replace ${stubbedTotal} passthrough stubs with real node types.`);
    }
  },
};

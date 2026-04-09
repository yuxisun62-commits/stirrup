import { readFileSync, readdirSync } from "node:fs";
import { resolve, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateWorkflow } from "../validation/WorkflowValidator.js";
import type { WorkflowDefinition } from "../types/workflow.js";

/** Load and validate a single workflow file (JSON or YAML) */
export function loadWorkflowFile(filePath: string): WorkflowDefinition {
  const content = readFileSync(filePath, "utf-8");
  const ext = extname(filePath).toLowerCase();

  let parsed: unknown;
  if (ext === ".yaml" || ext === ".yml") {
    parsed = parseYaml(content);
  } else if (ext === ".json") {
    parsed = JSON.parse(content);
  } else {
    throw new Error(`Unsupported workflow file extension: ${ext}`);
  }

  validateWorkflow(parsed);
  return parsed;
}

/** Load all workflow files from a directory, indexed by workflow ID */
export function loadWorkflowDirectory(dirPath: string): Map<string, WorkflowDefinition> {
  const workflows = new Map<string, WorkflowDefinition>();
  const files = readdirSync(dirPath);

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext !== ".yaml" && ext !== ".yml" && ext !== ".json") continue;

    const fullPath = resolve(dirPath, file);
    try {
      const workflow = loadWorkflowFile(fullPath);
      workflows.set(workflow.id, workflow);
    } catch (err) {
      throw new Error(
        `Failed to load workflow from ${file}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return workflows;
}

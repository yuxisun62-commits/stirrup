import Ajv, { type ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkflowDefinition } from "../types/workflow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "../../schemas/workflow.schema.json");

let cachedValidate: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (!cachedValidate) {
    const ajv = new Ajv.default({ allErrors: true });
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    cachedValidate = ajv.compile(schema);
  }
  return cachedValidate;
}

export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public readonly details: string[]
  ) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

/** Validate a workflow definition against the JSON schema and check for DAG cycles */
export function validateWorkflow(workflow: unknown): asserts workflow is WorkflowDefinition {
  validateSchema(workflow);
  const def = workflow as WorkflowDefinition;
  validateUniqueNodeIds(def);
  validateEdgeReferences(def);
  validateNoCycles(def);
}

function validateSchema(workflow: unknown): void {
  const validate = getValidator();
  if (!validate(workflow)) {
    const details = (validate.errors ?? []).map(
      (e: { instancePath?: string; message?: string }) => `${e.instancePath || "/"}: ${e.message}`
    );
    throw new WorkflowValidationError("Workflow schema validation failed", details);
  }
}

function validateUniqueNodeIds(def: WorkflowDefinition): void {
  const ids = new Set<string>();
  const duplicates: string[] = [];
  for (const node of def.nodes) {
    if (ids.has(node.id)) duplicates.push(node.id);
    ids.add(node.id);
  }
  if (duplicates.length > 0) {
    throw new WorkflowValidationError(
      "Duplicate node IDs found",
      duplicates.map((id) => `Duplicate node ID: "${id}"`)
    );
  }
}

function validateEdgeReferences(def: WorkflowDefinition): void {
  const nodeIds = new Set(def.nodes.map((n) => n.id));
  const errors: string[] = [];
  for (const edge of def.edges) {
    if (!nodeIds.has(edge.from)) errors.push(`Edge references unknown node: "${edge.from}"`);
    if (!nodeIds.has(edge.to)) errors.push(`Edge references unknown node: "${edge.to}"`);
  }
  if (errors.length > 0) {
    throw new WorkflowValidationError("Invalid edge references", errors);
  }
}

/** Kahn's algorithm for cycle detection */
function validateNoCycles(def: WorkflowDefinition): void {
  const nodeIds = def.nodes.map((n) => n.id);
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of def.edges) {
    adjacency.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, inDegree.get(edge.to)! + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited++;
    for (const neighbor of adjacency.get(current)!) {
      const newDegree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (visited !== nodeIds.length) {
    const cycleNodes = nodeIds.filter((id) => inDegree.get(id)! > 0);
    throw new WorkflowValidationError(
      "Workflow contains a cycle",
      [`Nodes involved in cycle: ${cycleNodes.join(", ")}`]
    );
  }
}

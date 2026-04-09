import { WorkflowEngine } from "../src/engine/Engine.js";
import { transformHandler } from "../src/nodes/TransformNode.js";
import { conditionHandler } from "../src/nodes/ConditionNode.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const engine = new WorkflowEngine({
    stateDir: resolve(__dirname, ".."),
  });

  // Register deterministic node handlers
  const registry = engine.getRegistry();
  registry.register("transform", transformHandler);
  registry.register("condition", conditionHandler);

  // Load and run the hello-world workflow
  engine.loadWorkflow(resolve(__dirname, "hello-world.yaml"));

  // Listen for events
  engine.on("node:start", (e) => console.log(`  [START] ${e.nodeId}`));
  engine.on("node:complete", (e) => console.log(`  [DONE]  ${e.nodeId}`, e.outputs));
  engine.on("node:skip", (e) => console.log(`  [SKIP]  ${e.nodeId}: ${e.reason}`));

  console.log("Running hello-world workflow...\n");
  const result = await engine.execute("hello-world");

  console.log("\nExecution status:", result.status);
  console.log("Final context:", result.context);

  // Show results for non-skipped nodes
  for (const [nodeId, step] of Object.entries(result.steps)) {
    if (step.status === "completed") {
      console.log(`  ${nodeId}: ${JSON.stringify(step.outputs)}`);
    }
  }
}

main().catch(console.error);

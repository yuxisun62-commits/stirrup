import { stringify as yamlStringify } from "yaml";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  WorkflowParam,
  WorkflowTrigger,
  InputMapping,
  RetryPolicy,
} from "../types/workflow.js";

/**
 * Fluent API for building workflows programmatically.
 * Designed for use by AI agents and scripts.
 *
 * @example
 * ```ts
 * const workflow = new WorkflowBuilder("my-workflow", "My Workflow")
 *   .param("input", "string", { required: true, description: "The input data" })
 *   .transform("process", "Process Data", {
 *     expression: '({ result: inputs.data.toUpperCase() })',
 *     inputs: [{ from: "context.input", to: "data" }],
 *   })
 *   .llmPrompt("summarize", "Summarize", {
 *     promptTemplate: "Summarize: {{text}}",
 *     inputs: [{ from: "nodes.process.outputs.result", to: "text" }],
 *   })
 *   .edge("process", "summarize")
 *   .build();
 * ```
 */
export class WorkflowBuilder {
  private nodes: WorkflowNode[] = [];
  private edges: WorkflowEdge[] = [];
  private params: WorkflowParam[] = [];
  private context: Record<string, unknown> = {};
  private triggers?: WorkflowTrigger;
  private description?: string;
  private version = "1.0";
  private defaults?: { retry?: RetryPolicy };

  constructor(
    private id: string,
    private name: string
  ) {}

  setDescription(desc: string): this {
    this.description = desc;
    return this;
  }

  setVersion(v: string): this {
    this.version = v;
    return this;
  }

  /** Add a declared parameter */
  param(
    name: string,
    type: WorkflowParam["type"],
    opts: { required?: boolean; description?: string; default?: unknown } = {}
  ): this {
    this.params.push({ name, type, ...opts });
    return this;
  }

  /** Set initial context values */
  setContext(ctx: Record<string, unknown>): this {
    this.context = { ...this.context, ...ctx };
    return this;
  }

  /** Configure triggers */
  setTriggers(triggers: WorkflowTrigger): this {
    this.triggers = triggers;
    return this;
  }

  /** Set default retry policy */
  setRetryDefaults(retry: RetryPolicy): this {
    this.defaults = { retry };
    return this;
  }

  /** Add a generic node */
  node(
    id: string,
    type: string,
    name: string,
    config: Record<string, unknown>,
    opts: {
      inputs?: InputMapping[];
      outputs?: string[];
      branches?: Record<string, string[]>;
      retry?: RetryPolicy;
      description?: string;
    } = {}
  ): this {
    this.nodes.push({
      id,
      type: type as WorkflowNode["type"],
      name,
      config,
      inputs: opts.inputs ?? [],
      outputs: opts.outputs ?? ["result"],
      branches: opts.branches,
      retry: opts.retry,
      description: opts.description,
    });
    return this;
  }

  // --- Shorthand methods for each node type ---

  transform(
    id: string,
    name: string,
    opts: { expression: string; inputs?: InputMapping[]; outputs?: string[] }
  ): this {
    return this.node(id, "transform", name, { expression: opts.expression }, {
      inputs: opts.inputs,
      outputs: opts.outputs ?? ["result"],
    });
  }

  condition(
    id: string,
    name: string,
    opts: { expression: string; branches: Record<string, string[]>; inputs?: InputMapping[] }
  ): this {
    return this.node(id, "condition", name, { expression: opts.expression }, {
      inputs: opts.inputs,
      outputs: ["selectedBranch"],
      branches: opts.branches,
    });
  }

  http(
    id: string,
    name: string,
    opts: { url: string; method: string; headers?: Record<string, string>; body?: unknown; inputs?: InputMapping[] }
  ): this {
    return this.node(id, "http", name, {
      url: opts.url, method: opts.method, headers: opts.headers, body: opts.body,
    }, { inputs: opts.inputs, outputs: ["status", "headers", "body"] });
  }

  script(
    id: string,
    name: string,
    opts: { code: string; inputs?: InputMapping[]; outputs?: string[]; timeoutMs?: number }
  ): this {
    return this.node(id, "script", name, { code: opts.code, timeoutMs: opts.timeoutMs }, {
      inputs: opts.inputs,
      outputs: opts.outputs ?? ["result"],
    });
  }

  llmPrompt(
    id: string,
    name: string,
    opts: {
      promptTemplate: string;
      systemPrompt?: string;
      model?: string;
      responseFormat?: "text" | "json";
      maxTokens?: number;
      temperature?: number;
      inputs?: InputMapping[];
    }
  ): this {
    const { inputs, ...config } = opts;
    return this.node(id, "llm-prompt", name, config, {
      inputs,
      outputs: ["response"],
    });
  }

  agentToolUse(
    id: string,
    name: string,
    opts: {
      systemPrompt: string;
      taskTemplate: string;
      tools: string[];
      maxIterations?: number;
      maxTokens?: number;
      inputs?: InputMapping[];
    }
  ): this {
    const { inputs, ...config } = opts;
    return this.node(id, "agent-tool-use", name, config, {
      inputs,
      outputs: ["response", "iterations"],
    });
  }

  decisionRouting(
    id: string,
    name: string,
    opts: {
      promptTemplate: string;
      branches: Record<string, string>;
      nodeBranches: Record<string, string[]>;
      maxTokens?: number;
      inputs?: InputMapping[];
    }
  ): this {
    const { inputs, nodeBranches, ...config } = opts;
    return this.node(id, "decision-routing", name, config, {
      inputs,
      outputs: ["selectedBranch"],
      branches: nodeBranches,
    });
  }

  codeGeneration(
    id: string,
    name: string,
    opts: {
      promptTemplate: string;
      language: "typescript" | "javascript" | "python";
      execute?: boolean;
      sandboxTimeoutMs?: number;
      maxTokens?: number;
      inputs?: InputMapping[];
    }
  ): this {
    const { inputs, ...config } = opts;
    return this.node(id, "code-generation", name, { ...config, execute: config.execute ?? false }, {
      inputs,
      outputs: ["code", "executed", "executionResult"],
    });
  }

  /** Add an edge between two nodes */
  edge(from: string, to: string, condition?: string): this {
    const e: WorkflowEdge = { from, to };
    if (condition) e.condition = condition;
    this.edges.push(e);
    return this;
  }

  /** Build the final WorkflowDefinition */
  build(): WorkflowDefinition {
    const wf: WorkflowDefinition = {
      id: this.id,
      name: this.name,
      version: this.version,
      nodes: this.nodes,
      edges: this.edges,
    };
    if (this.description) wf.description = this.description;
    if (this.params.length > 0) wf.params = this.params;
    if (Object.keys(this.context).length > 0) wf.context = this.context;
    if (this.triggers) wf.triggers = this.triggers;
    if (this.defaults) wf.defaults = this.defaults;
    return wf;
  }

  /** Build and return as YAML string */
  toYaml(): string {
    return yamlStringify(this.build());
  }

  /** Build and return as JSON string */
  toJson(pretty = true): string {
    return JSON.stringify(this.build(), null, pretty ? 2 : undefined);
  }
}

/** Config for "llm-prompt" nodes */
export interface LlmPromptConfig {
  model?: string;
  promptTemplate: string;
  systemPrompt?: string;
  responseFormat?: "text" | "json";
  responseSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

/** Config for "agent-tool-use" nodes */
export interface AgentToolUseConfig {
  model?: string;
  systemPrompt: string;
  taskTemplate: string;
  tools: string[];
  maxIterations?: number;
  maxTokens?: number;
}

/** Config for "decision-routing" nodes */
export interface DecisionRoutingConfig {
  model?: string;
  promptTemplate: string;
  branches: Record<string, string>;
  maxTokens?: number;
}

/** Config for "code-generation" nodes */
export interface CodeGenerationConfig {
  model?: string;
  promptTemplate: string;
  language: "typescript" | "javascript" | "python";
  execute: boolean;
  sandboxTimeoutMs?: number;
  maxTokens?: number;
}

/** Config for "http" nodes */
export interface HttpNodeConfig {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  responseMapping?: Record<string, string>;
  /** If true, skip SSRF protection and allow requests to private/internal URLs */
  allowInternal?: boolean;
}

/** Config for "transform" nodes */
export interface TransformConfig {
  expression: string;
}

/** Config for "condition" nodes */
export interface ConditionConfig {
  expression: string;
}

/** Config for "script" nodes */
export interface ScriptConfig {
  code: string;
  timeoutMs?: number;
}

/**
 * Config for "iterate" nodes — runs a child node handler N times over an
 * array input. Enables dynamic fan-out where the item count is only known
 * at runtime.
 *
 * Each iteration sees `{ item, index, ...parentInputs, priorResults }` as
 * its inputs (where priorResults is only populated in sequential mode).
 *
 * Output is `{ results: [...per-item outputs], count, successCount, failureCount }`.
 */
export interface IterateConfig {
  /** Which node type to invoke per item (must be a registered handler) */
  childType: string;
  /** Config passed to each child invocation (template strings see {{item}}, {{index}}) */
  childConfig: Record<string, unknown>;
  /**
   * parallel: all iterations run concurrently (up to `concurrency`).
   * sequential: iterations run one at a time, each seeing prior results.
   * Default: parallel.
   */
  mode?: "parallel" | "sequential";
  /** Max concurrent iterations in parallel mode. Default: unlimited. */
  concurrency?: number;
  /**
   * If true, individual iteration failures don't abort the whole iterate node.
   * Failed iterations produce `{ error: string }` in the results array.
   * If false, the first iteration failure throws. Default: true.
   */
  continueOnIterationError?: boolean;
}

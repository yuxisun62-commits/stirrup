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

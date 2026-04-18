/** Unique string identifier for a node within a workflow */
export type NodeId = string;

/** Unique string identifier for a workflow */
export type WorkflowId = string;

/** All supported node types */
export type NodeType =
  | "transform"
  | "condition"
  | "http"
  | "script"
  | "llm-prompt"
  | "agent-tool-use"
  | "decision-routing"
  | "code-generation"
  | "iterate"
  | "passthrough"
  | "fail";

/** Retry policy for a node */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

/** Maps an upstream node output field to this node's input field */
export interface InputMapping {
  /** Source: "nodes.<nodeId>.outputs.<field>" or "context.<path>" */
  from: string;
  /** Target input field name on this node */
  to: string;
}

/** A single node in the workflow DAG */
export interface WorkflowNode {
  id: NodeId;
  type: NodeType;
  name: string;
  description?: string;
  inputs: InputMapping[];
  outputs: string[];
  config: Record<string, unknown>;
  retry?: RetryPolicy;
  /** For condition/decision-routing: named branches mapping to downstream node IDs */
  branches?: Record<string, NodeId[]>;
  /**
   * When true, a failed node (after retries exhausted) lets the execution
   * continue instead of aborting the whole workflow. Downstream nodes can
   * inspect the failed step's `error` field to handle the failure gracefully.
   * Use for non-critical work (screenshots, supplementary analysis) where a
   * failure shouldn't block the rest of the DAG.
   */
  continueOnError?: boolean;
}

/** An edge in the DAG */
export interface WorkflowEdge {
  from: NodeId;
  to: NodeId;
  /** Only traverse this edge when the named branch is selected */
  condition?: string;
}

/** A declared parameter that the workflow accepts at runtime */
export interface WorkflowParam {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  description?: string;
  required?: boolean;
  default?: unknown;
  /** Service this param belongs to — enables OAuth auto-injection (e.g., "github", "slack") */
  service?: string;
  /**
   * If set, the Run Workflow dialog renders a typed picker UI instead of a
   * plain text input. UI-only field; ignored by the engine. Currently:
   * 'github-repo' shows a searchable dropdown of the user's accessible repos.
   */
  picker?: "github-repo";
}

/** Trigger configuration — how a workflow gets invoked in serve mode */
export interface WorkflowTrigger {
  /** HTTP endpoint trigger */
  http?: {
    /** Path for the endpoint (e.g., "/pr-review") — defaults to "/<workflow-id>" */
    path?: string;
    method?: "POST" | "GET";
  };
  /** Webhook trigger — matches incoming webhook payloads */
  webhook?: {
    /** Source type for matching (e.g., "github", "slack") */
    source: string;
    /** Event type filter (e.g., "pull_request.opened") */
    events?: string[];
    /** Secret for webhook signature verification */
    secret?: string;
  };
  /** Cron schedule trigger */
  cron?: {
    /** Cron expression (e.g., "0 0 * * *" for daily) */
    schedule: string;
    /** Timezone (e.g., "America/New_York") */
    timezone?: string;
  };
  /** File watch trigger */
  watch?: {
    /** Glob patterns to watch */
    paths: string[];
    /** Events to trigger on */
    events?: Array<"create" | "change" | "delete">;
  };
}

/** Top-level workflow definition (stored as YAML/JSON) */
export interface WorkflowDefinition {
  id: WorkflowId;
  name: string;
  version: string;
  description?: string;
  /** Declared parameters — values supplied at runtime via CLI or UI */
  params?: WorkflowParam[];
  /** Trigger configuration for serve mode */
  triggers?: WorkflowTrigger;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Initial shared context values (can reference params) */
  context?: Record<string, unknown>;
  defaults?: {
    retry?: RetryPolicy;
  };
}

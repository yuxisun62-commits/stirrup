/**
 * n8n workflow importer.
 *
 * Takes a raw n8n workflow export (JSON) and emits a Stirrup
 * WorkflowDefinition plus a report describing what was mapped, what
 * became a passthrough stub, and what was skipped entirely. The goal
 * isn't 1:1 fidelity — it's letting a user bring an existing n8n
 * workflow over, see the shape on our canvas, and fill in the unmapped
 * bits by hand.
 *
 * Design notes:
 *
 * - n8n references nodes by their `name` (human-readable string) in the
 *   connections map. Those names aren't guaranteed unique across the
 *   workflow, so we resolve collisions and build a name→id index.
 *
 * - n8n stores branch fanout as a 2D array: `connections[src].main[outputIndex]`
 *   is an array of dests. `outputIndex` is 0/1 for If-style nodes (true/false)
 *   and larger for switch. We turn those into `branches` on Stirrup condition
 *   nodes and label the edges with the branch name.
 *
 * - For every node type we don't have a first-class mapping for, we emit a
 *   `passthrough` node with the original vendor params embedded under
 *   `metadata.original` so a user can see what was there. Node types that
 *   are decorative only (`stickyNote`) are dropped entirely.
 */
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  NodeType,
  InputMapping,
  WorkflowTrigger,
} from "../types/workflow.js";
import { configHasExpressions, collectNodeReferences } from "./n8nExpression.js";
import { compileN8nCondition, compileN8nSwitch } from "./n8nConditions.js";

export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: [number, number];
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  notes?: string;
  notesInFlow?: boolean;
  disabled?: boolean;
  retryOnFail?: boolean;
}

export interface N8nConnectionTarget {
  node: string;
  type: string;
  index: number;
}

export interface N8nWorkflow {
  name?: string;
  description?: string;
  nodes?: N8nNode[];
  connections?: Record<
    string,
    { main?: Array<Array<N8nConnectionTarget> | null | undefined> }
  >;
  settings?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  tags?: unknown;
  pinData?: unknown;
}

export interface ImportReport {
  sourceName: string;
  nodeCount: number;
  edgeCount: number;
  mapped: Record<string, number>;
  stubbed: Record<string, number>;
  dropped: Record<string, number>;
  /**
   * Count of nodes that will execute arbitrary code at run-time (type:
   * "script"). Surfaces in the UI as a "review before running" warning
   * — importing a foreign workflow can bring in hostile code, and our
   * vm sandbox provides only scope isolation, not privilege isolation.
   */
  scriptNodeCount: number;
  /**
   * Service credentials the imported workflow references (derived from
   * n8n credential refs + service-mapper hints). The UI uses this list
   * to prompt the user: "connect Slack, GitHub, and OpenAI before running."
   */
  credentialsNeeded: string[];
  warnings: string[];
}

export interface ImportResult {
  workflow: WorkflowDefinition;
  report: ImportReport;
}

/**
 * Strip the vendor prefix (`n8n-nodes-base.` for built-ins,
 * `@n8n/n8n-nodes-langchain.` for the LangChain bundle) so NODE_MAPPINGS
 * keys can ignore which package a node comes from.
 */
function bareType(t: string): string {
  return t
    .replace(/^n8n-nodes-base\./, "")
    .replace(/^@n8n\/n8n-nodes-langchain\./, "");
}

/**
 * Stable ID generator. Prefers the n8n `id` field (usually a cuid), falls
 * back to a slug of the display name. Dedupes against prior ids so the
 * emitted workflow is always unique-keyed even when the source has naming
 * collisions.
 */
function makeIdResolver(): (n: N8nNode) => string {
  const used = new Set<string>();
  return (n) => {
    const raw = (n.id && /^[A-Za-z0-9_-]+$/.test(n.id)) ? n.id : slugify(n.name);
    let id = raw;
    let i = 2;
    while (used.has(id)) {
      id = `${raw}-${i++}`;
    }
    used.add(id);
    return id;
  };
}

function slugify(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "node";
}

/**
 * Mapping from a bare n8n type → how to translate it into a Stirrup node.
 *
 * `builder` receives the original n8n node and returns partial WorkflowNode
 * fields (type + config + anything else). If a mapping isn't defined here
 * the node falls through to a generic passthrough stub.
 */
type MapResult = {
  type: NodeType;
  config?: Record<string, unknown>;
  outputs?: string[];
  branches?: Record<string, string[]>;
  /** If true, the node is purely decorative and should be dropped. */
  drop?: boolean;
};

type MapBuilder = (n: N8nNode) => MapResult;

const NODE_MAPPINGS: Record<string, MapBuilder> = {
  // Visual-only — don't emit anything
  stickyNote: () => ({ type: "passthrough", drop: true }),

  // Structural
  noOp: () => ({ type: "passthrough", config: { label: "No-op" } }),
  manualTrigger: () => ({
    type: "passthrough",
    config: { label: "Manual trigger", metadata: { triggerKind: "manual" } },
  }),
  webhook: (n) => ({
    type: "passthrough",
    config: {
      label: "Webhook trigger (stub)",
      metadata: {
        triggerKind: "webhook",
        path: (n.parameters as any)?.path,
        httpMethod: (n.parameters as any)?.httpMethod,
        responseMode: (n.parameters as any)?.responseMode,
      },
    },
  }),
  scheduleTrigger: (n) => ({
    type: "passthrough",
    config: {
      label: "Schedule trigger (stub)",
      metadata: { triggerKind: "schedule", rule: (n.parameters as any)?.rule },
    },
  }),
  cron: (n) => ({
    type: "passthrough",
    config: {
      label: "Cron trigger (stub)",
      metadata: { triggerKind: "cron", cronExpression: (n.parameters as any)?.cronExpression },
    },
  }),
  formTrigger: (n) => ({
    type: "passthrough",
    config: {
      label: "Form trigger (stub)",
      metadata: { triggerKind: "form", formFields: (n.parameters as any)?.formFields },
    },
  }),
  executeWorkflowTrigger: () => ({
    type: "passthrough",
    config: { label: "Sub-workflow entry", metadata: { triggerKind: "sub-workflow" } },
  }),
  respondToWebhook: (n) => ({
    type: "passthrough",
    config: {
      label: "Respond to webhook (stub)",
      metadata: { kind: "webhook-response", response: n.parameters },
    },
  }),

  // Core primitives that map cleanly
  httpRequest: (n) => {
    const p = (n.parameters ?? {}) as any;
    return {
      type: "http",
      config: {
        url: p.url ?? "",
        method: (p.method ?? "GET").toUpperCase(),
        headers: p.headerParameters?.parameters ? arrayToObject(p.headerParameters.parameters) : undefined,
        body: p.bodyParameters?.parameters ? arrayToObject(p.bodyParameters.parameters) : p.body,
      },
    };
  },
  set: (n) => ({
    type: "transform",
    config: {
      // Best-effort: emit a passthrough that merges the set fields into input.
      // n8n's set has a complex UI; we preserve the parameters and let the
      // user rewrite as a real expression if they need different semantics.
      expression: "({...inputs})",
      metadata: { original: n.parameters },
    },
  }),
  code: (n) => ({
    type: "script",
    config: {
      code: (n.parameters as any)?.jsCode ?? (n.parameters as any)?.code ?? "",
      language: "javascript",
    },
  }),
  function: (n) => ({
    type: "script",
    config: {
      code: (n.parameters as any)?.functionCode ?? "",
      language: "javascript",
    },
  }),
  functionItem: (n) => ({
    type: "script",
    config: {
      code: (n.parameters as any)?.functionCode ?? "",
      language: "javascript",
    },
  }),
  if: (n) => {
    const compiled = compileN8nCondition(n.parameters);
    return {
      type: "condition",
      config: {
        expression: compiled.expression,
        _n8nCondition: true,
        _n8nReferencedNodes: compiled.referencedNodes,
        metadata: { original: n.parameters, warnings: compiled.warnings },
      },
      branches: { true: [], false: [] },
    };
  },
  filter: (n) => {
    const compiled = compileN8nCondition(n.parameters);
    return {
      type: "condition",
      config: {
        expression: compiled.expression,
        _n8nCondition: true,
        _n8nReferencedNodes: compiled.referencedNodes,
        metadata: { original: n.parameters, kind: "filter", warnings: compiled.warnings },
      },
      branches: { true: [], false: [] },
    };
  },
  switch: (n) => {
    const compiled = compileN8nSwitch(n.parameters);
    const branches: Record<string, string[]> = {};
    for (const name of compiled.branches) branches[name] = [];
    return {
      type: "condition",
      config: {
        expression: compiled.expression,
        _n8nCondition: true,
        _n8nReferencedNodes: compiled.referencedNodes,
        metadata: { original: n.parameters, warnings: compiled.warnings },
      },
      branches,
    };
  },
  merge: () => ({
    type: "passthrough",
    config: { label: "Merge (awaits upstream inputs)" },
  }),
  splitInBatches: (n) => ({
    type: "passthrough",
    config: {
      label: "Split in batches (stub)",
      metadata: { kind: "split-in-batches", original: n.parameters },
    },
  }),
  splitOut: (n) => ({
    type: "passthrough",
    config: {
      label: "Split out (stub)",
      metadata: { kind: "split-out", original: n.parameters },
    },
  }),
  wait: (n) => {
    const p = (n.parameters ?? {}) as any;
    const seconds = typeof p.amount === "number"
      ? p.amount * ({ seconds: 1, minutes: 60, hours: 3600 }[p.unit as string] ?? 1)
      : undefined;
    return {
      type: "passthrough",
      config: {
        label: `Wait${seconds ? ` ~${seconds}s` : ""}`,
        metadata: { kind: "wait", seconds, original: n.parameters },
      },
    };
  },
  aggregate: (n) => ({
    type: "transform",
    config: {
      expression: "({items: Array.isArray(inputs) ? inputs : [inputs]})",
      metadata: { original: n.parameters },
    },
  }),
  itemLists: (n) => ({
    type: "transform",
    config: {
      expression: "({...inputs})",
      metadata: { original: n.parameters },
    },
  }),
  dateTime: (n) => ({
    type: "transform",
    config: {
      expression: "({now: new Date().toISOString(), ...inputs})",
      metadata: { original: n.parameters },
    },
  }),
  stopAndError: (n) => ({
    type: "fail",
    config: { message: (n.parameters as any)?.message ?? "Workflow explicitly failed" },
  }),

  // Email — we have the email plugin as a peer-dep. For now stub it so
  // users who install nodemailer can rewire trivially.
  emailSend: (n) => ({
    type: "passthrough",
    config: {
      label: "Email send (stub — install nodemailer + replace with email-send)",
      metadata: { kind: "email-send", original: n.parameters },
    },
  }),

  // ── Service integrations ──────────────────────────────────────────
  // Every service mapper below follows the same pattern: translate the
  // n8n operation → the closest Stirrup plugin node, forward the params
  // n8n already extracted under its own field names, and leave a token
  // placeholder that the user fills via the Connections panel. Service
  // tokens are auto-injected at execute time for any param whose
  // declared `service` matches an authenticated entry in the token store.

  slack: (n) => {
    const p = (n.parameters ?? {}) as any;
    const op = String(p.operation ?? p.resource ?? "postMessage");
    if (op === "postMessage" || op === "message" || p.resource === "message") {
      return {
        type: "slack-send" as NodeType,
        config: {
          channel: p.channel ?? p.channelId ?? "#general",
          text: p.text ?? p.messageText ?? "",
          threadTs: p.thread_ts ?? p.otherOptions?.thread_ts,
          metadata: { credentials: "slack", original: p },
        },
      };
    }
    return {
      type: "passthrough",
      config: {
        label: `Slack ${op} (stub — only postMessage is mapped)`,
        metadata: { credentials: "slack", original: p },
      },
    };
  },

  // OpenAI direct and LangChain OpenAI variants. Chat-completion style
  // calls become llm-prompt; everything else falls through with a
  // credentials hint.
  openAi: (n) => mapOpenAi(n),
  // n8n packages the LangChain nodes under a different package prefix;
  // we look them up by bareType which strips both prefixes.

  anthropic: (n) => ({
    type: "llm-prompt" as NodeType,
    config: {
      prompt: (n.parameters as any)?.prompt ?? (n.parameters as any)?.messages ?? "",
      model: (n.parameters as any)?.model ?? "claude-sonnet-4-6",
      metadata: { credentials: "anthropic", original: n.parameters },
    },
  }),

  postgres: (n) => {
    const p = (n.parameters ?? {}) as any;
    const op = String(p.operation ?? "executeQuery").toLowerCase();
    if (op === "executequery" || op === "query") {
      return {
        type: "pg-query" as NodeType,
        config: {
          query: p.query ?? p.sql ?? "",
          params: p.additionalFields?.queryParams ?? p.queryParams,
          connectionString: p.connectionString ?? undefined,
          metadata: { credentials: "postgres", original: p },
        },
      };
    }
    if (op === "insert") {
      return {
        type: "pg-insert" as NodeType,
        config: {
          table: p.table ?? p.schema ?? "",
          data: p.columns ?? p.data ?? p.additionalFields,
          metadata: { credentials: "postgres", original: p },
        },
      };
    }
    return {
      type: "passthrough",
      config: {
        label: `Postgres ${op} (stub)`,
        metadata: { credentials: "postgres", original: p },
      },
    };
  },

  redis: (n) => {
    const p = (n.parameters ?? {}) as any;
    const op = String(p.operation ?? "get").toLowerCase();
    if (op === "get") {
      return {
        type: "redis-get" as NodeType,
        config: { key: p.key, metadata: { credentials: "redis", original: p } },
      };
    }
    if (op === "set") {
      return {
        type: "redis-set" as NodeType,
        config: {
          key: p.key,
          value: p.value,
          expire: p.expire ?? p.ttl,
          metadata: { credentials: "redis", original: p },
        },
      };
    }
    if (op === "publish") {
      return {
        type: "redis-publish" as NodeType,
        config: {
          channel: p.channel,
          message: p.messageData ?? p.message,
          metadata: { credentials: "redis", original: p },
        },
      };
    }
    return {
      type: "passthrough",
      config: {
        label: `Redis ${op} (stub)`,
        metadata: { credentials: "redis", original: p },
      },
    };
  },

  awsS3: (n) => mapS3(n),
  s3: (n) => mapS3(n),

  github: (n) => {
    const p = (n.parameters ?? {}) as any;
    const resource = String(p.resource ?? "").toLowerCase();
    const op = String(p.operation ?? "").toLowerCase();
    if (resource === "issue" && (op === "create" || op === "")) {
      return {
        type: "github-create-issue" as NodeType,
        config: {
          owner: p.owner,
          repo: p.repository,
          title: p.title,
          body: p.body,
          labels: p.labels,
          metadata: { credentials: "github", original: p },
        },
      };
    }
    if (resource === "issue" && op === "createcomment") {
      return {
        type: "github-post-comment" as NodeType,
        config: {
          owner: p.owner,
          repo: p.repository,
          issueNumber: p.issueNumber,
          body: p.body,
          metadata: { credentials: "github", original: p },
        },
      };
    }
    if (resource === "pullrequest" && op === "get") {
      return {
        type: "github-get-pr" as NodeType,
        config: {
          owner: p.owner,
          repo: p.repository,
          prNumber: p.pullRequestNumber,
          metadata: { credentials: "github", original: p },
        },
      };
    }
    if (resource === "repository" && op === "create") {
      return {
        type: "github-create-repo" as NodeType,
        config: {
          name: p.name ?? p.repoName,
          description: p.description,
          private: p.private ?? false,
          reuseIfExists: true,
          metadata: { credentials: "github", original: p },
        },
      };
    }
    return {
      type: "passthrough",
      config: {
        label: `GitHub ${resource}.${op} (stub)`,
        metadata: { credentials: "github", original: p },
      },
    };
  },

  telegram: (n) => {
    // n8n's Telegram "send message" node → a raw HTTP call to Telegram Bot API.
    // We emit an http node with the URL interpolated; the user's stored
    // token (service: telegram) fills in at execute time.
    const p = (n.parameters ?? {}) as any;
    const op = String(p.operation ?? "sendMessage");
    if (op === "sendMessage" || p.resource === "message") {
      return {
        type: "http" as NodeType,
        config: {
          url: "={{ 'https://api.telegram.org/bot' + $parameter.telegramToken + '/sendMessage' }}",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: {
            chat_id: p.chatId,
            text: p.text ?? p.message,
            parse_mode: p.parse_mode ?? p.additionalFields?.parse_mode,
          },
          _n8nExpressions: true,
          metadata: { credentials: "telegram", original: p },
        },
      };
    }
    return {
      type: "passthrough",
      config: {
        label: `Telegram ${op} (stub)`,
        metadata: { credentials: "telegram", original: p },
      },
    };
  },

  telegramTrigger: (n) => ({
    type: "passthrough",
    config: {
      label: "Telegram trigger — wired via workflow.triggers.telegram",
      metadata: {
        triggerKind: "telegram",
        credentials: "telegram",
        original: n.parameters,
      },
    },
  }),

  discord: (n) => ({
    type: "webhook-send" as NodeType,
    config: {
      url: (n.parameters as any)?.webhookUri ?? "",
      method: "POST",
      payload: {
        content: (n.parameters as any)?.text ?? (n.parameters as any)?.content,
        username: (n.parameters as any)?.options?.username,
      },
      metadata: { credentials: "discord", original: n.parameters },
    },
  }),
};

function mapOpenAi(n: N8nNode): MapResult {
  const p = (n.parameters ?? {}) as any;
  const resource = String(p.resource ?? "").toLowerCase();
  const op = String(p.operation ?? "").toLowerCase();

  // Chat completions — by far the most common pattern.
  if (
    resource === "chat" ||
    resource === "text" ||
    op === "message" ||
    op === "complete" ||
    op === "" // LangChain wrapper often omits resource/operation
  ) {
    const messages = p.messages?.values ?? p.messages ?? p.prompt;
    return {
      type: "llm-prompt" as NodeType,
      config: {
        prompt:
          typeof messages === "string"
            ? messages
            : Array.isArray(messages)
            ? messages.map((m: any) => `${m.role ?? "user"}: ${m.content ?? m.message ?? ""}`).join("\n")
            : "",
        model: p.model ?? p.modelId ?? "gpt-4o-mini",
        temperature: p.temperature ?? p.options?.temperature,
        maxTokens: p.maxTokens ?? p.options?.maxTokens,
        metadata: { credentials: "openai", original: p },
      },
    };
  }
  return {
    type: "passthrough",
    config: {
      label: `OpenAI ${resource}.${op} (stub — only chat/text is mapped)`,
      metadata: { credentials: "openai", original: p },
    },
  };
}

function mapS3(n: N8nNode): MapResult {
  const p = (n.parameters ?? {}) as any;
  const op = String(p.operation ?? "").toLowerCase();
  if (op === "upload" || op === "put") {
    return {
      type: "s3-put" as NodeType,
      config: {
        bucket: p.bucketName ?? p.bucket,
        key: p.fileKey ?? p.key ?? p.objectKey,
        body: p.fileContent ?? p.body,
        contentType: p.contentType,
        metadata: { credentials: "aws", original: p },
      },
    };
  }
  if (op === "download" || op === "get") {
    return {
      type: "s3-get" as NodeType,
      config: {
        bucket: p.bucketName ?? p.bucket,
        key: p.fileKey ?? p.key,
        metadata: { credentials: "aws", original: p },
      },
    };
  }
  if (op === "list" || op === "getall") {
    return {
      type: "s3-list" as NodeType,
      config: {
        bucket: p.bucketName ?? p.bucket,
        prefix: p.prefix,
        metadata: { credentials: "aws", original: p },
      },
    };
  }
  if (op === "delete") {
    return {
      type: "s3-delete" as NodeType,
      config: {
        bucket: p.bucketName ?? p.bucket,
        key: p.fileKey ?? p.key,
        metadata: { credentials: "aws", original: p },
      },
    };
  }
  return {
    type: "passthrough",
    config: {
      label: `S3 ${op} (stub)`,
      metadata: { credentials: "aws", original: p },
    },
  };
}

// Aliases — after bareType() strips both vendor prefixes, LangChain's
// openAi arrives under the same key as the base. These cover the other
// chat-model variants that appear in real workflows.
NODE_MAPPINGS.lmChatOpenAi = NODE_MAPPINGS.openAi;
NODE_MAPPINGS.openAiChat = NODE_MAPPINGS.openAi;
NODE_MAPPINGS.lmChatAnthropic = NODE_MAPPINGS.anthropic;

function arrayToObject(arr: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(arr)) return undefined;
  const out: Record<string, unknown> = {};
  for (const item of arr) {
    if (item && typeof item === "object" && "name" in item && "value" in item) {
      out[(item as any).name] = (item as any).value;
    }
  }
  return out;
}

/**
 * Narrow helper — pulls `metadata` off a Stirrup node config, returns
 * undefined if absent. Used when probing a mapper's emitted metadata
 * for credential hints, without repeating the cast pattern everywhere.
 */
function mappedConfig(config: Record<string, unknown>): { metadata?: Record<string, any> } | undefined {
  if (!config) return undefined;
  const md = config.metadata;
  if (md && typeof md === "object") return { metadata: md as Record<string, any> };
  return undefined;
}

/**
 * Map an n8n credential type name to a Stirrup service key. Returns
 * undefined when there's no direct mapping — the importer falls back
 * to whatever `metadata.credentials` hint the service mapper emitted.
 *
 * Keep this list aligned with ENV_FALLBACKS in tokenStore.ts so users
 * who already have the right env var set don't need to re-authenticate.
 */
function n8nCredentialToService(credType: string): string | undefined {
  const c = credType.toLowerCase();
  if (c.startsWith("slack")) return "slack";
  if (c.startsWith("github")) return "github";
  if (c.startsWith("openai") || c.startsWith("openaiapi")) return "openai";
  if (c.startsWith("anthropic")) return "anthropic";
  if (c.startsWith("gemini") || c.startsWith("googlepalm")) return "gemini";
  if (c.startsWith("postgres")) return "postgres";
  if (c.startsWith("redis")) return "redis";
  if (c.startsWith("aws") || c === "s3") return "aws";
  if (c.startsWith("telegram")) return "telegram";
  if (c.startsWith("discord")) return "discord";
  if (c.startsWith("stripe")) return "stripe";
  if (c.startsWith("linkedin")) return "linkedin";
  if (c.startsWith("gmail") || c.startsWith("smtp") || c.startsWith("email")) return "email";
  return undefined;
}

/**
 * Main entry. Accepts the parsed n8n JSON and returns the Stirrup workflow
 * plus a report. The report is what the UI surfaces to the user — "imported
 * 12 nodes cleanly, 3 became stubs, 1 was dropped" — so they know what to
 * look at.
 */
export function importN8nWorkflow(src: N8nWorkflow, opts: { workflowId?: string } = {}): ImportResult {
  const report: ImportReport = {
    sourceName: src.name ?? "Imported n8n workflow",
    nodeCount: 0,
    edgeCount: 0,
    mapped: {},
    stubbed: {},
    dropped: {},
    scriptNodeCount: 0,
    credentialsNeeded: [],
    warnings: [],
  };

  const resolveId = makeIdResolver();
  const nameToId = new Map<string, string>();
  const nodes: WorkflowNode[] = [];
  const droppedNames = new Set<string>();
  const credentialsNeeded = new Set<string>();

  for (const n of src.nodes ?? []) {
    const bare = bareType(n.type);
    const builder = NODE_MAPPINGS[bare];
    const mapped = builder ? builder(n) : null;

    if (mapped?.drop) {
      report.dropped[bare] = (report.dropped[bare] ?? 0) + 1;
      droppedNames.add(n.name);
      continue;
    }

    const id = resolveId(n);
    nameToId.set(n.name, id);

    if (mapped) {
      report.mapped[bare] = (report.mapped[bare] ?? 0) + 1;
    } else {
      report.stubbed[bare] = (report.stubbed[bare] ?? 0) + 1;
    }

    const stirrupNode: WorkflowNode = {
      id,
      type: mapped?.type ?? "passthrough",
      name: n.name,
      description: n.notes,
      inputs: [],
      outputs: mapped?.outputs ?? [],
      config: mapped?.config ?? {
        label: `⚠ Unmapped: ${n.type}`,
        metadata: {
          originalType: n.type,
          typeVersion: n.typeVersion,
          original: n.parameters,
          credentials: n.credentials,
        },
      },
      ...(mapped?.branches ? { branches: mapped.branches } : {}),
    };

    if (n.disabled) {
      stirrupNode.continueOnError = true;
      report.warnings.push(`Node "${n.name}" was disabled in n8n; set continueOnError=true`);
    }

    if (stirrupNode.type === "script") {
      report.scriptNodeCount += 1;
    }

    // Record which n8n credentials this node referenced so the import
    // report can tell the user which Connections to wire up. n8n stores
    // them as `credentials: { githubApi: {id, name} }` — the KEY is the
    // credential type. We normalize those to our service names.
    if (n.credentials && typeof n.credentials === "object") {
      const mapped = mappedConfig(stirrupNode.config);
      const serviceFromConfig = mapped?.metadata?.credentials;
      for (const credType of Object.keys(n.credentials)) {
        const svc = n8nCredentialToService(credType) ?? serviceFromConfig;
        if (svc) credentialsNeeded.add(svc);
      }
    } else {
      // Even without an explicit credentials ref, a service mapper's
      // metadata.credentials hint counts toward the needed-credentials set.
      const mapped = mappedConfig(stirrupNode.config);
      const svc = mapped?.metadata?.credentials;
      if (svc) credentialsNeeded.add(svc);
    }

    // Flag configs with n8n `{{ }}` expressions so the Runner evaluates
    // them before the handler sees them. We also collect `$node["X"]`
    // references here — they become input mappings later, once every
    // node's id has been allocated (second pass below).
    if (configHasExpressions(stirrupNode.config)) {
      (stirrupNode.config as Record<string, unknown>)._n8nExpressions = true;
    }
    // Compiled conditions (if/filter/switch) reference $json / $node
    // directly from raw JS — they also need the input mappings that
    // the second pass emits for $node["X"].
    // _n8nCondition is set by the compileN8nCondition / compileN8nSwitch
    // mappings above.

    nodes.push(stirrupNode);
  }

  // Translate connections → edges. n8n keys by source NAME; if a source was
  // dropped (e.g. stickyNote), its edges disappear. If a target was dropped,
  // we warn and skip that specific edge.
  const edges: WorkflowEdge[] = [];
  for (const [srcName, conns] of Object.entries(src.connections ?? {})) {
    if (droppedNames.has(srcName)) continue;
    const srcId = nameToId.get(srcName);
    if (!srcId) {
      report.warnings.push(`Connection from unknown source "${srcName}" — skipped`);
      continue;
    }
    const mains = Array.isArray(conns?.main) ? conns!.main : [];
    for (let outIdx = 0; outIdx < mains.length; outIdx++) {
      const targets = mains[outIdx];
      if (!Array.isArray(targets)) continue;
      for (const t of targets) {
        if (droppedNames.has(t.node)) continue;
        const dstId = nameToId.get(t.node);
        if (!dstId) {
          report.warnings.push(`Connection to unknown target "${t.node}" — skipped`);
          continue;
        }
        const srcNode = nodes.find((x) => x.id === srcId);
        // If the source is a condition with multiple branches, attach the
        // branch label. n8n convention: main[0] = true/first, main[1] = false/next.
        let condition: string | undefined;
        if (srcNode?.branches) {
          const keys = Object.keys(srcNode.branches);
          condition = keys[outIdx] ?? keys[keys.length - 1];
          // Also record the branch mapping so the scheduler honors it
          const arr = (srcNode.branches as any)[condition] ?? [];
          if (!arr.includes(dstId)) arr.push(dstId);
          (srcNode.branches as any)[condition] = arr;
        }
        edges.push(condition ? { from: srcId, to: dstId, condition } : { from: srcId, to: dstId });
      }
    }
  }

  // Second pass: for nodes that have n8n expressions, emit input mappings
  // so the engine materializes the referenced upstream outputs BEFORE the
  // runtime evaluator runs. Two kinds of mapping:
  //   1. `$json`        → output of the primary (first incoming) edge source
  //   2. `$node["X"]`   → output of the node whose display name is "X"
  //
  // The Runner reads these mapped values off execCtx.inputs, rebuilds the
  // n8n expression context, and replaces `{{ }}` tokens with their results
  // before invoking the handler. Handlers never see raw expression strings.
  for (const node of nodes) {
    const config = node.config as Record<string, unknown>;
    const hasTemplates = config._n8nExpressions === true;
    const hasCompiledCondition = config._n8nCondition === true;
    if (!hasTemplates && !hasCompiledCondition) continue;

    // For compiled conditions, referenced nodes were collected at compile
    // time and stashed under _n8nReferencedNodes — use those. For template
    // configs, rescan the (possibly deep) config for {{ $node["X"] }} refs.
    const referenced = hasCompiledCondition
      ? ((config._n8nReferencedNodes as string[]) ?? [])
      : collectNodeReferences(config);

    const existingMappings = new Set(node.inputs.map((m) => m.to));
    const newMappings: InputMapping[] = [];

    // Primary upstream for $json — first edge that targets this node.
    // If there's no upstream, $json resolves to undefined at eval time,
    // which matches n8n's behavior for trigger nodes.
    const primaryEdge = edges.find((e) => e.to === node.id);
    if (primaryEdge && !existingMappings.has("__n8nJson")) {
      newMappings.push({
        from: `nodes.${primaryEdge.from}.outputs`,
        to: "__n8nJson",
      });
    }

    // $node["X"] — we stored every node name in nameToId earlier.
    for (const referencedName of referenced) {
      const refId = nameToId.get(referencedName);
      if (!refId) {
        report.warnings.push(
          `Node "${node.name}" references $node["${referencedName}"] but that node wasn't imported — expression will resolve to undefined`,
        );
        continue;
      }
      const key = `__n8nNode_${refId}`;
      if (existingMappings.has(key)) continue;
      newMappings.push({ from: `nodes.${refId}.outputs`, to: key });
    }

    node.inputs = [...node.inputs, ...newMappings];
  }

  // Third pass: extract trigger configurations. n8n represents triggers as
  // nodes (webhook / scheduleTrigger / cron); Stirrup represents them as a
  // workflow-level `triggers:` block consumed by the TriggerManager. We
  // keep the original nodes as passthrough entry points so downstream
  // data flow still works, but the actual firing is driven by the
  // trigger subsystem.
  const triggers = extractTriggers(src.nodes ?? [], nameToId, report);

  report.nodeCount = nodes.length;
  report.edgeCount = edges.length;
  report.credentialsNeeded = [...credentialsNeeded].sort();
  if (report.scriptNodeCount > 0) {
    report.warnings.push(
      `${report.scriptNodeCount} script node(s) contain executable code from the imported source; review before running.`,
    );
  }
  if (report.credentialsNeeded.length > 0) {
    report.warnings.push(
      `Connect ${report.credentialsNeeded.join(", ")} in the Connections panel before running.`,
    );
  }

  const workflow: WorkflowDefinition = {
    id: opts.workflowId ?? `n8n-${slugify(src.name ?? "imported")}-${Date.now().toString(36)}`,
    name: src.name ?? "Imported n8n workflow",
    version: "1.0",
    description: src.description ?? `Imported from n8n. Original type count: ${Object.keys(report.mapped).length + Object.keys(report.stubbed).length}.`,
    nodes: nodes.length > 0 ? nodes : [
      // Workflow schema requires at least one node
      {
        id: "placeholder",
        type: "passthrough",
        name: "Empty import",
        inputs: [],
        outputs: [],
        config: { label: "Source workflow had no nodes" },
      },
    ],
    edges,
    ...(triggers ? { triggers } : {}),
  };

  return { workflow, report };
}

/**
 * Build a WorkflowTrigger from whichever trigger-style n8n nodes are
 * present. Returns undefined when there are none. Supports:
 *
 *  - webhook           → triggers.http (path + method come from params)
 *  - scheduleTrigger   → triggers.cron (from rule.interval[0])
 *  - cron (legacy)     → triggers.cron (from cronExpression)
 *
 * Multiple trigger nodes of the same kind: we take the first and warn.
 * formTrigger / executeWorkflowTrigger / manualTrigger: no mapping; they
 * stay as passthrough entry nodes.
 */
function extractTriggers(
  n8nNodes: N8nNode[],
  _nameToId: Map<string, string>,
  report: ImportReport,
): WorkflowTrigger | undefined {
  const result: WorkflowTrigger = {};
  let found = false;

  for (const n of n8nNodes) {
    const bare = bareType(n.type);
    const params = (n.parameters ?? {}) as Record<string, unknown>;

    if (bare === "webhook") {
      if (result.http) {
        report.warnings.push(`Multiple webhook triggers found; using first only`);
      } else {
        const rawPath = String(params.path ?? n.name ?? "webhook");
        const httpMethod = String(params.httpMethod ?? "POST").toUpperCase();
        const method = httpMethod === "GET" ? "GET" : "POST";
        result.http = {
          path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
          method,
        };
        found = true;
      }
    } else if (bare === "scheduleTrigger") {
      if (result.cron) {
        report.warnings.push(`Multiple schedule triggers found; using first only`);
      } else {
        const schedule = scheduleTriggerToCron(params, report);
        if (schedule) {
          result.cron = { schedule };
          found = true;
        }
      }
    } else if (bare === "cron") {
      if (result.cron) {
        report.warnings.push(`Multiple cron triggers found; using first only`);
      } else {
        const expr = String(params.cronExpression ?? "").trim();
        if (expr) {
          result.cron = { schedule: expr };
          found = true;
        } else {
          report.warnings.push(`Cron trigger "${n.name}" has no cronExpression; skipping`);
        }
      }
    }
  }

  return found ? result : undefined;
}

/**
 * n8n's scheduleTrigger has two param shapes:
 *   1. `{rule: {interval: [{field: "cronExpression", expression: "..."}]}}`
 *   2. `{rule: {interval: [{field: "hours", hoursInterval: 2}]}}`
 *      — numeric intervals for seconds/minutes/hours/days.
 * We translate (1) verbatim and (2) into a cron string. Anything else
 * (weekly on specific weekdays, etc.) falls through with a warning.
 */
function scheduleTriggerToCron(
  params: Record<string, unknown>,
  report: ImportReport,
): string | null {
  const rule = params.rule as { interval?: unknown[] } | undefined;
  const intervals = Array.isArray(rule?.interval) ? rule!.interval : [];
  if (intervals.length === 0) return null;

  const first = intervals[0] as Record<string, unknown>;
  const field = String(first.field ?? "");

  if (field === "cronExpression" && typeof first.expression === "string") {
    return first.expression;
  }
  if (field === "seconds" && typeof first.secondsInterval === "number") {
    report.warnings.push(
      "Second-level schedules approximated as every-minute cron (node-cron minimum granularity)",
    );
    return "* * * * *";
  }
  if (field === "minutes" && typeof first.minutesInterval === "number") {
    const n = first.minutesInterval as number;
    return n === 1 ? "* * * * *" : `*/${n} * * * *`;
  }
  if (field === "hours" && typeof first.hoursInterval === "number") {
    const n = first.hoursInterval as number;
    return n === 1 ? "0 * * * *" : `0 */${n} * * *`;
  }
  if (field === "days" && typeof first.daysInterval === "number") {
    const n = first.daysInterval as number;
    return n === 1 ? "0 0 * * *" : `0 0 */${n} * *`;
  }

  report.warnings.push(
    `scheduleTrigger interval field "${field}" not translated; schedule skipped`,
  );
  return null;
}

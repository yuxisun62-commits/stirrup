/**
 * Make.com (Integromat) blueprint importer.
 *
 * Make blueprints differ structurally from n8n exports:
 *
 *   - Connections are implicit. `blueprint.flow` is a linear array of
 *     modules executed in order; each element has a successor that is
 *     simply the next index. We emit those as explicit Stirrup edges.
 *
 *   - Branching is nested, not flat. A `builtin:BasicRouter` module
 *     carries a `routes: [{ flow: [...] }, ...]` sub-array — each entry
 *     is its own sub-flow that begins at the router and runs to
 *     completion independently. We translate the router into a
 *     Stirrup `condition` node with one branch per route, and recurse
 *     into each sub-flow so every nested module becomes a top-level
 *     Stirrup node with the appropriate incoming edge.
 *
 *   - Filters are inline, attached to any module via `filter: { ... }`.
 *     For v1 we leave the filter metadata embedded in the node config
 *     and don't try to translate Make's condition DSL; the user can
 *     rewrite the filter as a Stirrup condition node in the UI.
 *
 *   - Module names follow `app:Action` (e.g. `http:ActionSendData`,
 *     `slack:CreateMessage`). Mapping keys strip nothing — we match
 *     against the full dotted module id.
 *
 * Like the n8n importer, unknown modules become `passthrough` stubs with
 * the original `module`/`parameters`/`mapper` preserved under
 * `metadata.original` so the user has enough to replace them manually.
 */
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  NodeType,
  InputMapping,
  WorkflowTrigger,
} from "../types/workflow.js";
import {
  configHasMakeExpressions,
  collectMakeModuleReferences,
} from "./makeExpression.js";
import { compileMakeCondition } from "./makeConditions.js";

export interface MakeModule {
  id: number;
  module: string;
  version?: number;
  parameters?: Record<string, unknown>;
  mapper?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  notes?: unknown[];
  filter?: Record<string, unknown>;
  routes?: Array<{ flow?: MakeModule[]; parameters?: Record<string, unknown> }>;
  onerror?: MakeModule[];
}

export interface MakeBlueprint {
  name?: string;
  flow?: MakeModule[];
  metadata?: Record<string, unknown>;
  // Many blueprints export as just the single root module (a router) —
  // we accept that too by treating it as a one-element flow.
  module?: string;
  routes?: Array<{ flow?: MakeModule[]; parameters?: Record<string, unknown> }>;
  id?: number;
}

export interface MakeImportReport {
  sourceName: string;
  nodeCount: number;
  edgeCount: number;
  mapped: Record<string, number>;
  stubbed: Record<string, number>;
  dropped: Record<string, number>;
  /** Nodes that will execute arbitrary code at run-time. See n8n importer. */
  scriptNodeCount: number;
  /**
   * Service credentials referenced by the scenario. Empty until Make-side
   * credential inspection lands — kept here so the UI ImportReport shape
   * stays uniform across importers.
   */
  credentialsNeeded: string[];
  warnings: string[];
}

export interface MakeImportResult {
  workflow: WorkflowDefinition;
  report: MakeImportReport;
}

type MapResult = {
  type: NodeType;
  config?: Record<string, unknown>;
  outputs?: string[];
  branches?: Record<string, string[]>;
  drop?: boolean;
};

type MapBuilder = (m: MakeModule) => MapResult;

const MODULE_MAPPINGS: Record<string, MapBuilder> = {
  // Triggers
  "gateway:CustomWebHook": (m) => ({
    type: "passthrough",
    config: {
      label: "Webhook trigger (stub)",
      metadata: {
        triggerKind: "webhook",
        hook: (m.parameters as any)?.hook,
        original: m.parameters,
      },
    },
  }),
  "webhook:CustomWebHook": (m) => ({
    type: "passthrough",
    config: {
      label: "Webhook trigger (stub)",
      metadata: { triggerKind: "webhook", original: m.parameters },
    },
  }),
  "gateway:WebhookRespond": (m) => ({
    type: "passthrough",
    config: {
      label: "Webhook respond (stub)",
      metadata: { kind: "webhook-response", body: m.mapper, original: m.parameters },
    },
  }),

  // Core primitives
  "http:ActionSendData": (m) => ({
    type: "http",
    config: {
      url: (m.mapper as any)?.url ?? (m.parameters as any)?.url ?? "",
      method: String((m.mapper as any)?.method ?? (m.parameters as any)?.method ?? "POST").toUpperCase(),
      headers: mapperListToObject((m.mapper as any)?.headers),
      body: (m.mapper as any)?.body,
    },
  }),
  "http:ActionSendRequest": (m) => ({
    type: "http",
    config: {
      url: (m.mapper as any)?.url ?? "",
      method: String((m.mapper as any)?.method ?? "GET").toUpperCase(),
      headers: mapperListToObject((m.mapper as any)?.headers),
      body: (m.mapper as any)?.body,
    },
  }),
  "http:ActionGetFile": () => ({ type: "http", config: { method: "GET" } }),

  // Flow control
  "builtin:BasicRouter": (m) => {
    // Each route can carry its own filter. We compile them into one IIFE
    // that short-circuits to the first satisfied route, else "fallback".
    // Routes with no filter match unconditionally (just like Make).
    const routes = Array.isArray(m.routes) ? m.routes : [];
    const branches: Record<string, string[]> = {};
    const warnings: string[] = [];
    const refs = new Set<number>();
    const clauses: string[] = [];
    routes.forEach((route, idx) => {
      const name = `route${idx}`;
      branches[name] = [];
      const filter = (route as any).filter ?? (route.parameters as any)?.filter;
      if (filter) {
        const compiled = compileMakeCondition(filter);
        compiled.referencedModules.forEach((r) => refs.add(r));
        warnings.push(...compiled.warnings);
        clauses.push(`if (${compiled.expression}) return ${JSON.stringify(name)};`);
      } else {
        // Unconditional route — first one wins in n8n semantics if we hit
        // an else. In Make, routers fan out to every matched filter; our
        // condition node picks one. For imports that use several
        // unconditional routes, only the first runs.
        clauses.push(`return ${JSON.stringify(name)};`);
      }
    });
    branches.fallback = [];
    return {
      type: "condition",
      config: {
        expression: `(function(){ ${clauses.join(" ")} return "fallback"; })()`,
        _makeCondition: true,
        _makeReferencedModules: [...refs],
        metadata: { kind: "router", warnings },
      },
      branches,
    };
  },
  "builtin:BasicFilter": (m) => {
    const compiled = compileMakeCondition(m.filter ?? {});
    return {
      type: "condition",
      config: {
        expression: compiled.expression,
        _makeCondition: true,
        _makeReferencedModules: compiled.referencedModules,
        metadata: { kind: "filter", warnings: compiled.warnings, original: m.filter ?? m.parameters },
      },
      branches: { true: [], false: [] },
    };
  },
  "builtin:Iterator": (m) => ({
    type: "passthrough",
    config: {
      label: "Iterator (stub — rewire as iterate node)",
      metadata: { kind: "iterator", array: (m.mapper as any)?.array, original: m.parameters },
    },
  }),
  "builtin:BasicAggregator": (m) => ({
    type: "transform",
    config: {
      expression: "({items: Array.isArray(inputs) ? inputs : [inputs]})",
      metadata: { kind: "aggregator", original: m.parameters, mapper: m.mapper },
    },
  }),
  "util:ArrayAggregator": (m) => ({
    type: "transform",
    config: {
      expression: "({items: Array.isArray(inputs) ? inputs : [inputs]})",
      metadata: { kind: "array-aggregator", original: m.parameters, mapper: m.mapper },
    },
  }),

  // Data transformation
  "json:ParseJSON": () => ({
    type: "transform",
    config: { expression: "(typeof inputs.json === 'string' ? JSON.parse(inputs.json) : inputs.json)" },
  }),
  "json:CreateJSON": (m) => ({
    type: "transform",
    config: {
      expression: "({...inputs})",
      metadata: { kind: "create-json", original: m.parameters },
    },
  }),
  "util:SetVariables": (m) => ({
    type: "transform",
    config: {
      expression: "({...inputs})",
      metadata: { kind: "set-variables", mapper: m.mapper, original: m.parameters },
    },
  }),
  "util:SetVariable": (m) => ({
    type: "transform",
    config: {
      expression: "({...inputs})",
      metadata: { kind: "set-variable", mapper: m.mapper, original: m.parameters },
    },
  }),
  "util:GetVariables": () => ({
    type: "transform",
    config: { expression: "({...inputs})" },
  }),
  "util:GetVariable": () => ({
    type: "transform",
    config: { expression: "({...inputs})" },
  }),
  "util:ComposeString": (m) => ({
    type: "transform",
    config: {
      expression: "({text: ''})",
      metadata: { kind: "compose-string", template: (m.mapper as any)?.text, original: m.parameters },
    },
  }),
  "util:TextAggregator": (m) => ({
    type: "transform",
    config: {
      expression: "({text: ''})",
      metadata: { kind: "text-aggregator", mapper: m.mapper },
    },
  }),

  // Timing
  "util:FunctionSleep": (m) => {
    const seconds = (m.mapper as any)?.duration ?? (m.parameters as any)?.duration;
    return {
      type: "passthrough",
      config: {
        label: `Sleep${seconds ? ` ~${seconds}s` : ""}`,
        metadata: { kind: "sleep", seconds, original: m.parameters },
      },
    };
  },
  "sleep:ActionSleep": (m) => {
    const seconds = (m.mapper as any)?.delay ?? (m.parameters as any)?.delay;
    return {
      type: "passthrough",
      config: {
        label: `Sleep${seconds ? ` ~${seconds}s` : ""}`,
        metadata: { kind: "sleep", seconds, original: m.parameters },
      },
    };
  },

  // Error handling
  "builtin:Break": (m) => ({
    type: "fail",
    config: { message: (m.parameters as any)?.message ?? "Make break" },
  }),
  "builtin:Commit": () => ({ type: "passthrough", config: { label: "Commit" } }),
  "builtin:Rollback": () => ({ type: "fail", config: { message: "Rollback" } }),
  "builtin:Resume": () => ({ type: "passthrough", config: { label: "Resume" } }),

  // Visual / no-op
  "placeholder:Placeholder": () => ({ type: "passthrough", drop: true }),
  "builtin:Ignore": () => ({ type: "passthrough", config: { label: "Ignore (discards bundle)" } }),
  "builtin:NoOp": () => ({ type: "passthrough", config: { label: "No-op" } }),

  // ── Service integrations ──────────────────────────────────────────
  // Each mapper attaches `metadata.credentials: "<service>"` so the
  // import report can prompt users to wire up the right tokens.

  "slack:CreateMessage": (m) => ({
    type: "slack-send" as NodeType,
    config: {
      channel: (m.mapper as any)?.channel ?? (m.mapper as any)?.channelUid ?? "#general",
      text: (m.mapper as any)?.text ?? "",
      threadTs: (m.mapper as any)?.thread_ts,
      metadata: { credentials: "slack", original: m.mapper },
    },
  }),
  "slack:PostMessage": (m) => ({
    type: "slack-send" as NodeType,
    config: {
      channel: (m.mapper as any)?.channel ?? "#general",
      text: (m.mapper as any)?.text ?? "",
      metadata: { credentials: "slack", original: m.mapper },
    },
  }),

  "gmail:ActionSendEmail": (m) => ({
    type: "gmail-send" as NodeType,
    config: {
      to: (m.mapper as any)?.to ?? (m.mapper as any)?.recipients,
      subject: (m.mapper as any)?.subject,
      body: (m.mapper as any)?.html ?? (m.mapper as any)?.content ?? (m.mapper as any)?.text,
      html: Boolean((m.mapper as any)?.html) || (m.mapper as any)?.type === "html",
      cc: (m.mapper as any)?.cc,
      bcc: (m.mapper as any)?.bcc,
      metadata: { credentials: "gmail", original: m.mapper },
    },
  }),
  "gmail:ListEmails": (m) => ({
    type: "gmail-list-messages" as NodeType,
    config: {
      query: (m.mapper as any)?.query ?? (m.mapper as any)?.searchQuery,
      maxResults: (m.mapper as any)?.limit ?? 10,
      metadata: { credentials: "gmail", original: m.mapper },
    },
  }),

  "google-sheets:addRow": (m) => ({
    type: "sheets-append" as NodeType,
    config: {
      spreadsheetId: (m.mapper as any)?.spreadsheetId ?? (m.mapper as any)?.sheet,
      range: (m.mapper as any)?.sheetId ?? (m.mapper as any)?.sheet ?? "A:Z",
      values: [(m.mapper as any)?.values ?? []],
      metadata: { credentials: "google-sheets", original: m.mapper },
    },
  }),
  "google-sheets:getAllValues": (m) => ({
    type: "sheets-read" as NodeType,
    config: {
      spreadsheetId: (m.mapper as any)?.spreadsheetId,
      range: (m.mapper as any)?.range ?? "A:Z",
      metadata: { credentials: "google-sheets", original: m.mapper },
    },
  }),

  "airtable:ActionSearchRecords": (m) => ({
    type: "airtable-list" as NodeType,
    config: {
      baseId: (m.mapper as any)?.base ?? (m.mapper as any)?.baseId,
      tableId: (m.mapper as any)?.table ?? (m.mapper as any)?.tableId,
      filterByFormula: (m.mapper as any)?.formula,
      maxRecords: (m.mapper as any)?.maxRecords,
      metadata: { credentials: "airtable", original: m.mapper },
    },
  }),
  "airtable:ActionCreateRecord": (m) => ({
    type: "airtable-create" as NodeType,
    config: {
      baseId: (m.mapper as any)?.base ?? (m.mapper as any)?.baseId,
      tableId: (m.mapper as any)?.table ?? (m.mapper as any)?.tableId,
      records: (m.mapper as any)?.record ?? (m.mapper as any)?.fields,
      typecast: (m.mapper as any)?.typecast,
      metadata: { credentials: "airtable", original: m.mapper },
    },
  }),
  "airtable:ActionUpdateRecord": (m) => ({
    type: "airtable-update" as NodeType,
    config: {
      baseId: (m.mapper as any)?.base,
      tableId: (m.mapper as any)?.table,
      recordId: (m.mapper as any)?.recordId,
      fields: (m.mapper as any)?.record ?? (m.mapper as any)?.fields,
      metadata: { credentials: "airtable", original: m.mapper },
    },
  }),

  "notion:createPage": (m) => ({
    type: "notion-create-page" as NodeType,
    config: {
      parentDatabaseId: (m.mapper as any)?.databaseId,
      parentPageId: (m.mapper as any)?.parentPageId,
      title: (m.mapper as any)?.title,
      properties: (m.mapper as any)?.properties,
      metadata: { credentials: "notion", original: m.mapper },
    },
  }),
  "notion:searchObjects": (m) => ({
    type: "notion-search" as NodeType,
    config: {
      query: (m.mapper as any)?.query,
      metadata: { credentials: "notion", original: m.mapper },
    },
  }),
  "notion:queryDatabase": (m) => ({
    type: "notion-query-database" as NodeType,
    config: {
      databaseId: (m.mapper as any)?.databaseId,
      filter: (m.mapper as any)?.filter,
      sorts: (m.mapper as any)?.sorts,
      pageSize: (m.mapper as any)?.pageSize ?? 100,
      metadata: { credentials: "notion", original: m.mapper },
    },
  }),

  "openai-gpt-3:CreateCompletion": (m) => ({
    type: "llm-prompt" as NodeType,
    config: {
      prompt: (m.mapper as any)?.prompt ?? "",
      model: (m.mapper as any)?.model ?? "gpt-4o-mini",
      temperature: (m.mapper as any)?.temperature,
      maxTokens: (m.mapper as any)?.max_tokens,
      metadata: { credentials: "openai", original: m.mapper },
    },
  }),
  "openai-gpt-3:CreateChatCompletion": (m) => ({
    type: "llm-prompt" as NodeType,
    config: {
      prompt: Array.isArray((m.mapper as any)?.messages)
        ? ((m.mapper as any).messages as any[])
            .map((x) => `${x.role ?? "user"}: ${x.content ?? ""}`)
            .join("\n")
        : ((m.mapper as any)?.prompt ?? ""),
      model: (m.mapper as any)?.model ?? "gpt-4o-mini",
      temperature: (m.mapper as any)?.temperature,
      maxTokens: (m.mapper as any)?.max_tokens,
      metadata: { credentials: "openai", original: m.mapper },
    },
  }),
  "openai:CreateChatCompletion": (m) => ({
    type: "llm-prompt" as NodeType,
    config: {
      prompt: Array.isArray((m.mapper as any)?.messages)
        ? ((m.mapper as any).messages as any[])
            .map((x) => `${x.role ?? "user"}: ${x.content ?? ""}`)
            .join("\n")
        : ((m.mapper as any)?.prompt ?? ""),
      model: (m.mapper as any)?.model ?? "gpt-4o-mini",
      metadata: { credentials: "openai", original: m.mapper },
    },
  }),
  "anthropic-claude:CreateChatCompletion": (m) => ({
    type: "llm-prompt" as NodeType,
    config: {
      prompt: (m.mapper as any)?.prompt ?? "",
      model: (m.mapper as any)?.model ?? "claude-sonnet-4-6",
      metadata: { credentials: "anthropic", original: m.mapper },
    },
  }),

  "stripe:createCustomer": (m) => ({
    type: "stripe-create-customer" as NodeType,
    config: {
      email: (m.mapper as any)?.email,
      name: (m.mapper as any)?.name,
      description: (m.mapper as any)?.description,
      metadata: { credentials: "stripe", original: m.mapper },
    },
  }),
  "stripe:createCharge": (m) => ({
    type: "stripe-create-charge" as NodeType,
    config: {
      amount: (m.mapper as any)?.amount,
      currency: (m.mapper as any)?.currency,
      customer: (m.mapper as any)?.customer,
      description: (m.mapper as any)?.description,
      metadata: { credentials: "stripe", original: m.mapper },
    },
  }),

  "postgres:executeQuery": (m) => ({
    type: "pg-query" as NodeType,
    config: {
      query: (m.mapper as any)?.query ?? (m.mapper as any)?.sql,
      params: (m.mapper as any)?.params,
      metadata: { credentials: "postgres", original: m.mapper },
    },
  }),

  "mongodb:findDocument": (m) => ({
    type: "mongo-find" as NodeType,
    config: {
      database: (m.mapper as any)?.database,
      collection: (m.mapper as any)?.collection,
      filter: (m.mapper as any)?.filter ?? (m.mapper as any)?.query,
      metadata: { credentials: "mongodb", original: m.mapper },
    },
  }),
  "mongodb:insertDocument": (m) => ({
    type: "mongo-insert" as NodeType,
    config: {
      database: (m.mapper as any)?.database,
      collection: (m.mapper as any)?.collection,
      documents: (m.mapper as any)?.document ?? (m.mapper as any)?.documents,
      metadata: { credentials: "mongodb", original: m.mapper },
    },
  }),

  "discord:sendMessage": (m) => ({
    type: "discord-send" as NodeType,
    config: {
      channelId: (m.mapper as any)?.channelId,
      content: (m.mapper as any)?.content ?? (m.mapper as any)?.text,
      metadata: { credentials: "discord", original: m.mapper },
    },
  }),
  "telegram-bot:sendTextMessage": (m) => ({
    type: "telegram-send" as NodeType,
    config: {
      chatId: (m.mapper as any)?.chatId,
      text: (m.mapper as any)?.text ?? (m.mapper as any)?.message,
      parseMode: (m.mapper as any)?.parseMode,
      metadata: { credentials: "telegram", original: m.mapper },
    },
  }),
  "sendgrid:sendMail": (m) => ({
    type: "sendgrid-send" as NodeType,
    config: {
      from: (m.mapper as any)?.from,
      to: (m.mapper as any)?.to,
      subject: (m.mapper as any)?.subject,
      text: (m.mapper as any)?.text,
      html: (m.mapper as any)?.html,
      metadata: { credentials: "sendgrid", original: m.mapper },
    },
  }),
  "twilio:ActionSendSMS": (m) => ({
    type: "twilio-sms" as NodeType,
    config: {
      from: (m.mapper as any)?.from,
      to: (m.mapper as any)?.to,
      body: (m.mapper as any)?.body ?? (m.mapper as any)?.message,
      metadata: { credentials: "twilio", original: m.mapper },
    },
  }),
  "github:createIssue": (m) => ({
    type: "github-create-issue" as NodeType,
    config: {
      owner: (m.mapper as any)?.owner,
      repo: (m.mapper as any)?.repo,
      title: (m.mapper as any)?.title,
      body: (m.mapper as any)?.body,
      labels: (m.mapper as any)?.labels,
      metadata: { credentials: "github", original: m.mapper },
    },
  }),
  "github:createRepo": (m) => ({
    type: "github-create-repo" as NodeType,
    config: {
      name: (m.mapper as any)?.name,
      description: (m.mapper as any)?.description,
      private: (m.mapper as any)?.private,
      reuseIfExists: true,
      metadata: { credentials: "github", original: m.mapper },
    },
  }),
  "redis:get": (m) => ({
    type: "redis-get" as NodeType,
    config: { key: (m.mapper as any)?.key, metadata: { credentials: "redis", original: m.mapper } },
  }),
  "redis:set": (m) => ({
    type: "redis-set" as NodeType,
    config: {
      key: (m.mapper as any)?.key,
      value: (m.mapper as any)?.value,
      expire: (m.mapper as any)?.expire,
      metadata: { credentials: "redis", original: m.mapper },
    },
  }),
  "aws-s3:UploadFile": (m) => ({
    type: "s3-put" as NodeType,
    config: {
      bucket: (m.mapper as any)?.bucket,
      key: (m.mapper as any)?.key,
      body: (m.mapper as any)?.data,
      contentType: (m.mapper as any)?.contentType,
      metadata: { credentials: "aws", original: m.mapper },
    },
  }),
  "aws-s3:DownloadAFile": (m) => ({
    type: "s3-get" as NodeType,
    config: {
      bucket: (m.mapper as any)?.bucket,
      key: (m.mapper as any)?.key,
      metadata: { credentials: "aws", original: m.mapper },
    },
  }),
};

function mapperListToObject(list: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(list)) return undefined;
  const out: Record<string, unknown> = {};
  for (const item of list) {
    if (item && typeof item === "object" && "name" in item && "value" in item) {
      out[(item as any).name] = (item as any).value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function slugify(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "node";
}

function makeId(m: MakeModule, used: Set<string>): string {
  const base = typeof m.id === "number" ? `m${m.id}` : slugify(m.module);
  let id = base;
  let i = 2;
  while (used.has(id)) id = `${base}-${i++}`;
  used.add(id);
  return id;
}

/**
 * Walk a Make flow (linear + nested) into a flat list of Stirrup nodes plus
 * the edges connecting them. The `parentId` / `branchKey` args are used
 * when recursing into a router's routes — they let us attach the first node
 * of each sub-flow to the router via a branch-labeled edge.
 */
function walkFlow(
  flow: MakeModule[],
  ctx: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    idsByModule: Map<MakeModule, string>;
    usedIds: Set<string>;
    credentialsNeeded: Set<string>;
    report: MakeImportReport;
  },
  parentId?: string,
  branchKey?: string,
): string | null {
  let lastId: string | null = null;
  let prevId: string | null = null;

  for (let i = 0; i < flow.length; i++) {
    const m = flow[i];
    if (!m || typeof m !== "object") continue;

    const builder = MODULE_MAPPINGS[m.module];
    const mapped = builder ? builder(m) : null;

    if (mapped?.drop) {
      ctx.report.dropped[m.module] = (ctx.report.dropped[m.module] ?? 0) + 1;
      continue;
    }

    const id = makeId(m, ctx.usedIds);
    ctx.idsByModule.set(m, id);

    if (mapped) {
      ctx.report.mapped[m.module] = (ctx.report.mapped[m.module] ?? 0) + 1;
    } else {
      ctx.report.stubbed[m.module] = (ctx.report.stubbed[m.module] ?? 0) + 1;
    }

    const stirrupNode: WorkflowNode = {
      id,
      type: mapped?.type ?? "passthrough",
      name: moduleLabel(m),
      inputs: [],
      outputs: mapped?.outputs ?? [],
      config: mapped?.config ?? {
        label: `⚠ Unmapped: ${m.module}`,
        metadata: {
          originalModule: m.module,
          version: m.version,
          parameters: m.parameters,
          mapper: m.mapper,
        },
      },
      ...(mapped?.branches ? { branches: mapped.branches } : {}),
    };

    // Inline filter: preserve as metadata so the user can rebuild it as a
    // separate condition node. We don't short-circuit the flow on filter
    // match — that's a bigger fidelity task.
    if (m.filter) {
      (stirrupNode.config.metadata as any) = {
        ...(stirrupNode.config.metadata as any),
        filter: m.filter,
      };
      ctx.report.warnings.push(`Module "${moduleLabel(m)}" has an inline filter; preserved in metadata`);
    }

    if (stirrupNode.type === "script") {
      ctx.report.scriptNodeCount += 1;
    }

    // Flag configs that contain Make `{{ N.field }}` references so the
    // Runner evaluates them against the module-output map at runtime.
    // Compiled condition nodes already set _makeCondition in their mapper.
    if (configHasMakeExpressions(stirrupNode.config)) {
      (stirrupNode.config as Record<string, unknown>)._makeExpressions = true;
    }

    // Credentials hint: every service mapper above attaches
    // `metadata.credentials: "<service>"`. Harvest that so the import
    // report can nudge the user to wire up Connections before running.
    const credHint = (stirrupNode.config as any)?.metadata?.credentials;
    if (typeof credHint === "string") {
      ctx.credentialsNeeded.add(credHint);
    }

    ctx.nodes.push(stirrupNode);

    // Edge from the previous node in this linear sub-flow to this one
    if (prevId) {
      ctx.edges.push({ from: prevId, to: id });
    } else if (parentId && branchKey) {
      // First node in a router sub-flow: attach to the router with the branch label
      ctx.edges.push({ from: parentId, to: id, condition: branchKey });
      // Also record in the parent's branches map so scheduler routing works
      const parent = ctx.nodes.find((n) => n.id === parentId);
      if (parent?.branches) {
        const arr = (parent.branches as any)[branchKey] ?? [];
        if (!arr.includes(id)) arr.push(id);
        (parent.branches as any)[branchKey] = arr;
      }
    } else if (parentId) {
      ctx.edges.push({ from: parentId, to: id });
    }

    prevId = id;
    lastId = id;

    // Recurse into routes (router's nested sub-flows). Each route starts its
    // own branch from THIS node (the router) — not from the previous linear
    // sibling — so we pass `id` as the parent for each recursion.
    if (Array.isArray(m.routes) && m.routes.length > 0) {
      const branchNames = Object.keys(stirrupNode.branches ?? {});
      for (let r = 0; r < m.routes.length; r++) {
        const route = m.routes[r];
        const branchKey = branchNames[r] ?? `route${r}`;
        if (Array.isArray(route.flow)) {
          walkFlow(route.flow, ctx, id, branchKey);
        }
      }
      // After a router, the linear flow doesn't continue — routes are terminal.
      prevId = null;
    }

    // Error branch (onerror): attach as a labeled branch but don't try to
    // merge back into the main flow.
    if (Array.isArray(m.onerror) && m.onerror.length > 0) {
      if (!stirrupNode.branches) stirrupNode.branches = { success: [], error: [] };
      walkFlow(m.onerror, ctx, id, "error");
      ctx.report.warnings.push(`Module "${moduleLabel(m)}" has an onerror handler — attached as branch "error"`);
    }
  }

  return lastId;
}

function moduleLabel(m: MakeModule): string {
  const app = (m.metadata as any)?.restore?.name as string | undefined;
  if (app) return app;
  // "http:ActionSendData" → "http ActionSendData"
  return String(m.module).replace(/[:._-]/g, " ");
}

/**
 * Main entry. Parses a Make blueprint and emits Stirrup workflow + report.
 */
export function importMakeBlueprint(
  src: MakeBlueprint,
  opts: { workflowId?: string } = {},
): MakeImportResult {
  const report: MakeImportReport = {
    sourceName: src.name ?? "Imported Make scenario",
    nodeCount: 0,
    edgeCount: 0,
    mapped: {},
    stubbed: {},
    dropped: {},
    scriptNodeCount: 0,
    credentialsNeeded: [],
    warnings: [],
  };

  const ctx = {
    nodes: [] as WorkflowNode[],
    edges: [] as WorkflowEdge[],
    idsByModule: new Map<MakeModule, string>(),
    usedIds: new Set<string>(),
    credentialsNeeded: new Set<string>(),
    report,
  };

  // Some blueprints are a bare single module (e.g., a top-level router).
  // Normalize either shape into a flow array.
  const flow: MakeModule[] = Array.isArray(src.flow)
    ? src.flow
    : (src.module
      ? [{ id: src.id ?? 0, module: src.module, routes: src.routes } as MakeModule]
      : []);

  if (flow.length === 0) {
    report.warnings.push("Blueprint had no flow array — importing as empty workflow");
  }

  walkFlow(flow, ctx);

  // Second pass: wire up `__makeModule_<id>` input mappings for every
  // Stirrup node whose config contains `{{ N.field }}` or a compiled
  // condition that references module N. The Runner reads those inputs at
  // eval time to resolve `module[N].field`.
  //
  // Map by numeric Make module id → Stirrup node id using the id string
  // convention (`m<number>`), which makeId() generates for modules with
  // integer ids. Fall back to scanning the nodes list if the convention
  // was overridden (rare — only when a slug collision pushed the id to
  // something else).
  const nodeIdByModuleNum = new Map<number, string>();
  for (const [m, id] of ctx.idsByModule.entries()) {
    if (typeof m.id === "number") nodeIdByModuleNum.set(m.id, id);
  }

  for (const node of ctx.nodes) {
    const config = node.config as Record<string, unknown>;
    const hasExpr = config._makeExpressions === true;
    const hasCond = config._makeCondition === true;
    if (!hasExpr && !hasCond) continue;

    const referenced = hasCond
      ? ((config._makeReferencedModules as number[]) ?? [])
      : collectMakeModuleReferences(config);

    const existing = new Set(node.inputs.map((m) => m.to));
    const newMappings: InputMapping[] = [];

    for (const moduleNum of referenced) {
      const refId = nodeIdByModuleNum.get(moduleNum);
      if (!refId) {
        report.warnings.push(
          `Module ${moduleNum} referenced via {{ ${moduleNum}.* }} but wasn't imported — expression will resolve to undefined`,
        );
        continue;
      }
      const key = `__makeModule_${moduleNum}`;
      if (existing.has(key)) continue;
      newMappings.push({ from: `nodes.${refId}.outputs`, to: key });
    }
    node.inputs = [...node.inputs, ...newMappings];
  }

  // Third pass: lift webhook / schedule trigger modules into
  // `workflow.triggers` so the TriggerManager can fire the workflow
  // automatically. The trigger entry node stays in place as a passthrough
  // — downstream data flow still works — but actual firing is now driven
  // by the subsystem shipped in 0.7.0.
  const triggers = extractMakeTriggers(flow, report);

  report.nodeCount = ctx.nodes.length;
  report.edgeCount = ctx.edges.length;
  report.credentialsNeeded = [...ctx.credentialsNeeded].sort();
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
    id: opts.workflowId ?? `make-${slugify(src.name ?? "imported")}-${Date.now().toString(36)}`,
    name: src.name ?? "Imported Make scenario",
    version: "1.0",
    description: `Imported from Make.com. ${Object.keys(report.mapped).length} module types mapped, ${Object.keys(report.stubbed).length} stubbed.`,
    nodes: ctx.nodes.length > 0 ? ctx.nodes : [
      {
        id: "placeholder",
        type: "passthrough",
        name: "Empty import",
        inputs: [],
        outputs: [],
        config: { label: "Source blueprint had no modules" },
      },
    ],
    edges: ctx.edges,
    ...(triggers ? { triggers } : {}),
  };

  return { workflow, report };
}

/**
 * Walk the (possibly nested) flow looking for trigger modules and lift
 * them into a WorkflowTrigger. Supports:
 *   - gateway:CustomWebHook / webhook:CustomWebHook → triggers.http
 *     (path from the hook's name or id, method defaults to POST)
 *   - scheduler:*, schedule:* modules — approximate into cron
 *
 * Triggers nested inside routers are uncommon; we scan the top level
 * only, which matches how Make scenarios are built in practice.
 */
function extractMakeTriggers(
  flow: MakeModule[],
  report: MakeImportReport,
): WorkflowTrigger | undefined {
  const result: WorkflowTrigger = {};
  let found = false;

  for (const m of flow) {
    const mod = String(m.module ?? "");
    if (mod === "gateway:CustomWebHook" || mod === "webhook:CustomWebHook") {
      if (result.http) {
        report.warnings.push("Multiple webhook triggers found; using first only");
        continue;
      }
      const p = (m.parameters ?? {}) as Record<string, unknown>;
      const hook = (p.hook as Record<string, unknown> | undefined) ?? {};
      const rawPath = String(
        (p.path as string | undefined) ??
          (hook.name as string | undefined) ??
          `make-${m.id}`,
      );
      result.http = {
        path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
        method: "POST",
      };
      found = true;
    } else if (mod.startsWith("scheduler:") || mod === "util:Sleep") {
      if (result.cron) continue;
      const p = (m.parameters ?? {}) as Record<string, unknown>;
      // Make's scheduling parameters are poorly standardized across module
      // versions; if we can't translate to cron cleanly we warn and skip.
      const interval = (p.interval as number | undefined) ?? (p.minutes as number | undefined);
      if (typeof interval === "number") {
        result.cron = {
          schedule: interval === 1 ? "* * * * *" : `*/${interval} * * * *`,
        };
        found = true;
      } else {
        report.warnings.push(
          `Scheduler module "${mod}" uses unsupported parameters; cron schedule skipped`,
        );
      }
    }
  }

  return found ? result : undefined;
}

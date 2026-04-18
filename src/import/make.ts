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
} from "../types/workflow.js";

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
    const routeCount = Array.isArray(m.routes) ? m.routes.length : 2;
    const branches: Record<string, string[]> = {};
    for (let i = 0; i < routeCount; i++) branches[`route${i}`] = [];
    return {
      type: "condition",
      config: {
        // Router evaluates every route in sequence; for a literal translation
        // we default to the first branch and preserve route filters below.
        expression: "'route0'",
        metadata: {
          kind: "router",
          routes: (m.routes ?? []).map((r) => r.parameters ?? {}),
        },
      },
      branches,
    };
  },
  "builtin:BasicFilter": (m) => ({
    type: "condition",
    config: {
      expression: "true",
      metadata: { kind: "filter", original: m.filter ?? m.parameters },
    },
    branches: { true: [], false: [] },
  }),
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
    warnings: [],
  };

  const ctx = {
    nodes: [] as WorkflowNode[],
    edges: [] as WorkflowEdge[],
    idsByModule: new Map<MakeModule, string>(),
    usedIds: new Set<string>(),
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

  report.nodeCount = ctx.nodes.length;
  report.edgeCount = ctx.edges.length;

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
  };

  return { workflow, report };
}

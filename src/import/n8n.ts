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
} from "../types/workflow.js";
import { configHasExpressions, collectNodeReferences } from "./n8nExpression.js";

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
  warnings: string[];
}

export interface ImportResult {
  workflow: WorkflowDefinition;
  report: ImportReport;
}

/** Strip the `n8n-nodes-base.` prefix so mapping keys are readable. */
function bareType(t: string): string {
  return t.replace(/^n8n-nodes-base\./, "");
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
  if: (n) => ({
    type: "condition",
    config: {
      // n8n conditions are structural (value1, value2, operation). We can't
      // always translate them to a JS expression without the runtime data
      // shape, so we embed the original rules and default to passing-through.
      expression: "true",
      metadata: { original: n.parameters },
    },
    branches: { true: [], false: [] },
  }),
  filter: (n) => ({
    type: "condition",
    config: {
      expression: "true",
      metadata: { original: n.parameters, kind: "filter" },
    },
    branches: { true: [], false: [] },
  }),
  switch: (n) => {
    const p = (n.parameters ?? {}) as any;
    const ruleCount = Array.isArray(p.rules?.values) ? p.rules.values.length : 2;
    const branches: Record<string, string[]> = {};
    for (let i = 0; i < ruleCount; i++) branches[`branch${i}`] = [];
    branches.fallback = [];
    return {
      type: "condition",
      config: { expression: "'branch0'", metadata: { original: n.parameters } },
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
};

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
    warnings: [],
  };

  const resolveId = makeIdResolver();
  const nameToId = new Map<string, string>();
  const nodes: WorkflowNode[] = [];
  const droppedNames = new Set<string>();

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

    // Flag configs with n8n `{{ }}` expressions so the Runner evaluates
    // them before the handler sees them. We also collect `$node["X"]`
    // references here — they become input mappings later, once every
    // node's id has been allocated (second pass below).
    if (configHasExpressions(stirrupNode.config)) {
      (stirrupNode.config as Record<string, unknown>)._n8nExpressions = true;
    }

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
    if (config._n8nExpressions !== true) continue;

    const referenced = collectNodeReferences(config);
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

  report.nodeCount = nodes.length;
  report.edgeCount = edges.length;
  if (report.scriptNodeCount > 0) {
    report.warnings.push(
      `${report.scriptNodeCount} script node(s) contain executable code from the imported source; review before running.`,
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
  };

  return { workflow, report };
}

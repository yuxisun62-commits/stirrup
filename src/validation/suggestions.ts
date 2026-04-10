/**
 * Maps validation error messages to actionable suggestions.
 * Returns { suggestion, nodeId? } for each error.
 */

export interface EnrichedError {
  message: string;
  suggestion?: string;
  nodeId?: string;
  severity: "error" | "warning";
}

const KNOWN_NODE_TYPES = new Set([
  "transform", "condition", "http", "script",
  "llm-prompt", "agent-tool-use", "decision-routing", "code-generation",
]);

export function enrichError(error: string, knownNodeIds: Set<string>): EnrichedError {
  // Edge references unknown node
  const edgeMatch = error.match(/Edge references unknown node: "([^"]+)"/);
  if (edgeMatch) {
    const missingId = edgeMatch[1];
    // Look for near-matches in known nodes
    const closest = findClosestMatch(missingId, [...knownNodeIds]);
    return {
      message: error,
      severity: "error",
      suggestion: closest
        ? `The edge points to "${missingId}" but no such node exists. Did you mean "${closest}"? Either rename the edge endpoint or create a node with this ID.`
        : `Create a node with ID "${missingId}", or update the edge to point to an existing node.`,
    };
  }

  // Duplicate node IDs
  const dupMatch = error.match(/Duplicate node ID: "([^"]+)"/);
  if (dupMatch) {
    return {
      message: error,
      nodeId: dupMatch[1],
      severity: "error",
      suggestion: `Node IDs must be unique. Rename one of the duplicates — IDs identify nodes in input mappings (nodes.<id>.outputs.<field>) and edges.`,
    };
  }

  // Cycle
  if (error.includes("cycle")) {
    const nodesMatch = error.match(/Nodes involved in cycle: (.+)/);
    return {
      message: error,
      severity: "error",
      suggestion: nodesMatch
        ? `The nodes ${nodesMatch[1]} form a loop. Remove one of the edges between them to break the cycle. DAG workflows cannot have cycles.`
        : `Remove an edge to break the cycle. Workflows must be directed acyclic graphs.`,
    };
  }

  // Schema errors from Ajv
  if (error.startsWith("/")) {
    const [path, ...rest] = error.split(": ");
    const message = rest.join(": ");

    if (message.includes("must have required property")) {
      const propMatch = message.match(/'([^']+)'/);
      const prop = propMatch?.[1];
      // Extract node index/id from path
      const nodeMatch = path.match(/\/nodes\/(\d+)/);
      return {
        message: error,
        nodeId: nodeMatch ? `nodes[${nodeMatch[1]}]` : undefined,
        severity: "error",
        suggestion: prop
          ? `Add the required "${prop}" field. ${getFieldHint(prop)}`
          : `A required field is missing at ${path}.`,
      };
    }

    if (message.includes("must be equal to one of the allowed values") || message.includes("enum")) {
      return {
        message: error,
        severity: "error",
        suggestion: `The value at ${path} is not valid. Check the allowed values — for node types, use one of: ${[...KNOWN_NODE_TYPES].join(", ")}.`,
      };
    }

    if (message.includes("must be string") || message.includes("must be object") || message.includes("must be array")) {
      return {
        message: error,
        severity: "error",
        suggestion: `The field at ${path} has the wrong type. ${message}.`,
      };
    }

    if (message.includes("must NOT have additional properties")) {
      return {
        message: error,
        severity: "warning",
        suggestion: `Remove the extra field at ${path}. Only documented fields are allowed in workflow definitions.`,
      };
    }
  }

  // Invalid workflow ID
  if (error.toLowerCase().includes("workflow id") || error.toLowerCase().includes("invalid id")) {
    return {
      message: error,
      severity: "error",
      suggestion: `Workflow IDs must contain only letters, numbers, hyphens, and underscores. No spaces or special characters.`,
    };
  }

  // Missing required parameters
  if (error.toLowerCase().includes("missing required parameter")) {
    return {
      message: error,
      severity: "error",
      suggestion: `Provide all required parameters when running the workflow. Open the Run dialog to set values.`,
    };
  }

  // Default: return the raw error
  return { message: error, severity: "error" };
}

function getFieldHint(field: string): string {
  const hints: Record<string, string> = {
    id: "Use a unique kebab-case identifier, e.g. 'my-node'.",
    type: "Choose a node type: transform, condition, http, script, llm-prompt, agent-tool-use, decision-routing, or code-generation.",
    name: "A human-readable label for the node.",
    inputs: "An array of input mappings: [{ from: 'nodes.X.outputs.Y', to: 'fieldName' }].",
    outputs: "An array of output field names produced by this node.",
    config: "The configuration object (contents depend on the node type).",
    nodes: "An array of workflow nodes.",
    edges: "An array of edges connecting nodes: [{ from: 'nodeA', to: 'nodeB' }].",
    version: "A version string, e.g. '1.0'.",
    from: "The source node ID for the edge.",
    to: "The target node ID for the edge.",
  };
  return hints[field] ?? "";
}

/** Simple edit-distance-based near match for typo detection */
function findClosestMatch(needle: string, haystack: string[]): string | null {
  let best: { value: string; distance: number } | null = null;
  for (const candidate of haystack) {
    const distance = levenshtein(needle.toLowerCase(), candidate.toLowerCase());
    if (distance <= 3 && (!best || distance < best.distance)) {
      best = { value: candidate, distance };
    }
  }
  return best?.value ?? null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

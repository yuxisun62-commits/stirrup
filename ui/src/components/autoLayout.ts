import type { WorkflowDefinition, WorkflowNode } from '../api/client';

/**
 * Compute hierarchical positions for every node in a workflow.
 *
 * Approach: topological levels (Kahn's algorithm over the DAG), then
 * horizontal packing within each level. Parallel branches end up side-
 * by-side at the same y; serial chains stack vertically. Disconnected
 * subgraphs are packed beside the main one rather than overlapping.
 *
 * Intentionally a hand-rolled layout — dagre is the standard choice but
 * pulls in a chunky dependency for something we only need on an
 * on-demand button click. Fine-tune constants NODE_WIDTH, NODE_HEIGHT,
 * and GAP if the canvas feels cramped.
 */

const NODE_WIDTH = 220;
const NODE_HEIGHT = 120;
const LEVEL_GAP_Y = 60;
const NODE_GAP_X = 40;

export function computeLayout(
  workflow: WorkflowDefinition,
): Record<string, { x: number; y: number }> {
  const nodeIds = workflow.nodes.map((n) => n.id);
  const idSet = new Set(nodeIds);

  // Adjacency (forward) + in-degree map. Filter edges to ones whose
  // endpoints actually exist — the YAML shouldn't dangle but edge cases
  // during edits produce stale references.
  const adj = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const id of nodeIds) {
    adj.set(id, []);
    incoming.set(id, 0);
  }
  for (const edge of workflow.edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
    adj.get(edge.from)!.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  // Kahn: queue of zero-in-degree nodes → peel level-by-level.
  const level = new Map<string, number>();
  let frontier: string[] = nodeIds.filter((id) => (incoming.get(id) ?? 0) === 0);
  let depth = 0;
  const processed = new Set<string>();

  while (frontier.length > 0) {
    for (const id of frontier) {
      level.set(id, depth);
      processed.add(id);
    }
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      for (const dst of adj.get(id) ?? []) {
        incoming.set(dst, (incoming.get(dst) ?? 0) - 1);
        if (incoming.get(dst) === 0) nextFrontier.push(dst);
      }
    }
    frontier = nextFrontier;
    depth++;
  }

  // Cycle fallback: any nodes not reached by Kahn get placed at the
  // deepest level. They still appear on canvas — layouts of malformed
  // graphs are better than blank screens.
  for (const id of nodeIds) {
    if (!processed.has(id)) level.set(id, depth);
  }

  // Group by level and pack horizontally. Within a level, sort by the
  // preferred ordering heuristic: nodes whose parents appear earlier in
  // the previous level come first, so edges cross as little as possible.
  const byLevel = new Map<number, string[]>();
  for (const id of nodeIds) {
    const lv = level.get(id) ?? 0;
    const arr = byLevel.get(lv) ?? [];
    arr.push(id);
    byLevel.set(lv, arr);
  }

  const positions: Record<string, { x: number; y: number }> = {};
  const sortedLevels = [...byLevel.keys()].sort((a, b) => a - b);

  for (const lv of sortedLevels) {
    const nodesAtLevel = byLevel.get(lv)!;
    // Sort this level by the average x of their predecessors (already
    // placed) — minimizes edge crossings in a simple DAG without the
    // full crossing-reduction machinery dagre uses.
    nodesAtLevel.sort((a, b) => {
      const ax = parentCenterX(a, workflow, positions);
      const bx = parentCenterX(b, workflow, positions);
      if (ax === bx) return a.localeCompare(b);
      return ax - bx;
    });

    const totalWidth = nodesAtLevel.length * NODE_WIDTH + (nodesAtLevel.length - 1) * NODE_GAP_X;
    const startX = -totalWidth / 2 + NODE_WIDTH / 2;

    nodesAtLevel.forEach((id, idx) => {
      positions[id] = {
        x: startX + idx * (NODE_WIDTH + NODE_GAP_X) + 400,
        y: lv * (NODE_HEIGHT + LEVEL_GAP_Y) + 60,
      };
    });
  }

  return positions;
}

function parentCenterX(
  id: string,
  workflow: WorkflowDefinition,
  positions: Record<string, { x: number; y: number }>,
): number {
  const parents = workflow.edges.filter((e) => e.to === id).map((e) => e.from);
  if (parents.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (const p of parents) {
    if (positions[p]) {
      sum += positions[p].x;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Apply the computed positions to a workflow's nodes. Returns a new
 * nodes array with `_position` set on every node — matches the shape
 * the canvas already uses for custom positioning.
 */
export function applyLayout(workflow: WorkflowDefinition): WorkflowNode[] {
  const positions = computeLayout(workflow);
  return workflow.nodes.map((n) => ({
    ...n,
    _position: positions[n.id] ?? { x: 0, y: 0 },
  } as WorkflowNode));
}

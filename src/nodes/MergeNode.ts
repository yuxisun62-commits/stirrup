import type { NodeHandler } from "./NodeRegistry.js";

/**
 * Merge node: combine items from multiple upstream sources.
 *
 * n8n's `Merge` node ships with several modes, four of which cover the vast
 * majority of real use cases:
 *
 *   - append: concatenate items from every input into one list (default)
 *   - combine: pairwise zip — [a,b] + [x,y] → [{...a,...x}, {...b,...y}]
 *   - mergeByKey: join by a shared field — [{id:1,a:1}] + [{id:1,b:2}] → [{id:1,a:1,b:2}]
 *   - multiplex: cartesian product — [a,b] + [x,y] → [{...a,...x}, {...a,...y}, ...]
 *
 * Input discovery: the node reads every input whose name matches
 * `__n8nMerge_<n>` and treats each source as a list of items. The importer
 * emits these mappings when it translates an n8n merge node; hand-authored
 * Stirrup workflows can also use them explicitly.
 *
 * Output shape: `{ items: [...], count: N }` — same convention as per-item
 * iteration, so downstream nodes chain naturally.
 */
export const mergeHandler: NodeHandler = async (config, execCtx) => {
  const mode = String((config.mode as string) ?? "append").toLowerCase();
  const mergeByKey = config.mergeByKey as string | undefined;

  const sources = collectSources(execCtx.inputs);
  if (sources.length === 0) {
    return { items: [], count: 0 };
  }

  let items: unknown[];
  switch (mode) {
    case "append":
      items = appendMode(sources);
      break;
    case "combine":
      items = combineMode(sources);
      break;
    case "mergebykey":
    case "merge-by-key":
      if (!mergeByKey) throw new Error("merge node with mode 'mergeByKey' requires `mergeByKey` config");
      items = mergeByKeyMode(sources, mergeByKey);
      break;
    case "multiplex":
      items = multiplexMode(sources);
      break;
    case "choosebranch":
    case "choose-branch":
      // Return the first non-empty input. Useful for fallback chains.
      items = sources.find((s) => s.length > 0) ?? [];
      break;
    default:
      throw new Error(`Unknown merge mode: "${mode}"`);
  }

  return { items, count: items.length, mode };
};

/**
 * Pull merge sources off `execCtx.inputs`. Returns an array-of-arrays, one
 * per upstream, ordered by the numeric suffix in `__n8nMerge_<n>`. Each
 * source is normalized to an array: bare arrays pass through, `{items: [...]}`
 * wrappers unwrap, scalars/objects become single-element lists.
 */
function collectSources(inputs: Record<string, unknown>): unknown[][] {
  const entries = Object.entries(inputs)
    .filter(([k]) => k.startsWith("__n8nMerge_"))
    .sort(([a], [b]) => Number(a.replace("__n8nMerge_", "")) - Number(b.replace("__n8nMerge_", "")));

  return entries.map(([, value]) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).items)) {
      return (value as { items: unknown[] }).items;
    }
    if (value === null || value === undefined) return [];
    return [value];
  });
}

function appendMode(sources: unknown[][]): unknown[] {
  const out: unknown[] = [];
  for (const s of sources) out.push(...s);
  return out;
}

/**
 * Pairwise combine — index i from every source gets spread into one object.
 * If sources are different lengths, combines up to the shortest. Non-object
 * items are wrapped under `{value}` so Object spread doesn't throw.
 */
function combineMode(sources: unknown[][]): unknown[] {
  if (sources.length === 0) return [];
  const minLen = Math.min(...sources.map((s) => s.length));
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < minLen; i++) {
    const combined: Record<string, unknown> = {};
    for (const source of sources) {
      const item = source[i];
      if (item && typeof item === "object" && !Array.isArray(item)) {
        Object.assign(combined, item);
      } else {
        combined.value = item;
      }
    }
    out.push(combined);
  }
  return out;
}

/**
 * Join on a shared key. First source is the "left"; subsequent sources
 * contribute fields where the key matches. Unmatched left-side rows are
 * kept as-is (left outer join semantics, matches n8n's default).
 */
function mergeByKeyMode(sources: unknown[][], key: string): unknown[] {
  if (sources.length === 0) return [];
  const [left, ...rest] = sources;
  const indexes = rest.map((source) => {
    const map = new Map<unknown, Record<string, unknown>>();
    for (const item of source) {
      if (item && typeof item === "object" && !Array.isArray(item) && key in item) {
        map.set((item as Record<string, unknown>)[key], item as Record<string, unknown>);
      }
    }
    return map;
  });

  return left.map((leftItem) => {
    if (!leftItem || typeof leftItem !== "object" || Array.isArray(leftItem)) return leftItem;
    const leftRec = leftItem as Record<string, unknown>;
    const leftKey = leftRec[key];
    const combined: Record<string, unknown> = { ...leftRec };
    for (const idx of indexes) {
      const match = idx.get(leftKey);
      if (match) Object.assign(combined, match);
    }
    return combined;
  });
}

/**
 * Cartesian product — every item from source 0 paired with every item from
 * source 1, etc. Explodes quickly with many sources; n8n's UI warns about
 * this and so should we if the user points us at many inputs.
 */
function multiplexMode(sources: unknown[][]): unknown[] {
  if (sources.length === 0) return [];
  if (sources.some((s) => s.length === 0)) return [];

  let acc: Record<string, unknown>[] = [{}];
  for (const source of sources) {
    const next: Record<string, unknown>[] = [];
    for (const carry of acc) {
      for (const item of source) {
        const merged = { ...carry };
        if (item && typeof item === "object" && !Array.isArray(item)) {
          Object.assign(merged, item);
        } else {
          merged.value = item;
        }
        next.push(merged);
      }
    }
    acc = next;
  }
  return acc;
}

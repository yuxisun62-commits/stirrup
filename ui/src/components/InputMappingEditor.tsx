import { useMemo, useRef, useState, useEffect } from 'react';
import type { WorkflowDefinition, WorkflowNode } from '../api/client';
import { tokens, inputBase, btnSecondary } from './ui/styles';

type InputMapping = { from: string; to: string };

interface Props {
  node: WorkflowNode;
  workflow: WorkflowDefinition;
  onChange: (inputs: InputMapping[]) => void;
}

/**
 * Suggestion item shown in the `from` combobox. `kind` drives the icon/tint;
 * `value` is the string inserted into the input; `detail` is a right-hand hint
 * (e.g., param type, upstream node name) to help disambiguate similar options.
 */
interface Suggestion {
  kind: 'context' | 'node' | 'output';
  value: string;
  label: string;
  detail?: string;
}

type Validity =
  | { state: 'ok' }
  | { state: 'warn'; reason: string }
  | { state: 'empty' };

/**
 * BFS upstream reachability: which node IDs can feed into `startId` along the
 * current edge graph? Used to surface reachable nodes first in suggestions
 * and warn when a mapping references a node that's not wired upstream yet.
 */
function upstreamNodeIds(workflow: WorkflowDefinition, startId: string): Set<string> {
  const parents = new Map<string, string[]>();
  for (const e of workflow.edges) {
    if (!parents.has(e.to)) parents.set(e.to, []);
    parents.get(e.to)!.push(e.from);
  }
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const p of parents.get(id) ?? []) {
      if (!seen.has(p)) { seen.add(p); stack.push(p); }
    }
  }
  return seen;
}

function buildSuggestions(
  text: string,
  workflow: WorkflowDefinition,
  currentNodeId: string,
  upstream: Set<string>,
): Suggestion[] {
  const out: Suggestion[] = [];
  const params = workflow.params ?? [];
  const ctxKeys = workflow.context ? Object.keys(workflow.context) : [];
  const nodes = workflow.nodes.filter((n) => n.id !== currentNodeId);

  // Drilling: user typed "nodes.<id>.outputs." — show that node's declared outputs.
  const outputsMatch = text.match(/^nodes\.([^.]+)\.outputs\.?(.*)$/);
  if (outputsMatch) {
    const [, nodeId, tail] = outputsMatch;
    const target = workflow.nodes.find((n) => n.id === nodeId);
    if (target) {
      const outputs = target.outputs.length ? target.outputs : ['output'];
      for (const o of outputs) {
        if (!tail || o.startsWith(tail)) {
          out.push({
            kind: 'output',
            value: `nodes.${nodeId}.outputs.${o}`,
            label: o,
            detail: target.name || target.type,
          });
        }
      }
      return out;
    }
  }

  // Drilling: user typed "nodes.<partial>" without the outputs segment yet.
  const nodeOnlyMatch = text.match(/^nodes\.?([^.]*)$/);
  if (nodeOnlyMatch) {
    const prefix = nodeOnlyMatch[1];
    for (const n of nodes) {
      if (!prefix || n.id.startsWith(prefix)) {
        const firstOutput = n.outputs[0] ?? 'output';
        out.push({
          kind: 'node',
          value: `nodes.${n.id}.outputs.${firstOutput}`,
          label: `nodes.${n.id}.outputs.${firstOutput}`,
          detail: upstream.has(n.id) ? 'upstream' : n.type,
        });
      }
    }
    return out;
  }

  // Drilling: user typed "context.<partial>" — filter to matching param/context keys.
  const ctxMatch = text.match(/^context\.?(.*)$/);
  if (ctxMatch) {
    const prefix = ctxMatch[1];
    for (const p of params) {
      if (!prefix || p.name.startsWith(prefix)) {
        out.push({
          kind: 'context',
          value: `context.${p.name}`,
          label: `context.${p.name}`,
          detail: p.type + (p.required ? ' · required' : ''),
        });
      }
    }
    for (const k of ctxKeys) {
      if (params.some((p) => p.name === k)) continue;
      if (!prefix || k.startsWith(prefix)) {
        out.push({
          kind: 'context',
          value: `context.${k}`,
          label: `context.${k}`,
          detail: 'context',
        });
      }
    }
    return out;
  }

  // No recognized prefix: surface the most useful starting points —
  // upstream nodes first (these are the ones the user most likely wants),
  // then all other nodes, then params.
  const ordered = [...nodes].sort((a, b) => {
    const au = upstream.has(a.id) ? 0 : 1;
    const bu = upstream.has(b.id) ? 0 : 1;
    return au - bu;
  });
  const lower = text.toLowerCase();
  for (const n of ordered) {
    const firstOutput = n.outputs[0] ?? 'output';
    const full = `nodes.${n.id}.outputs.${firstOutput}`;
    if (!text || full.toLowerCase().includes(lower) || (n.name ?? '').toLowerCase().includes(lower)) {
      out.push({
        kind: 'node',
        value: full,
        label: full,
        detail: upstream.has(n.id) ? 'upstream' : n.type,
      });
    }
  }
  for (const p of params) {
    const full = `context.${p.name}`;
    if (!text || full.toLowerCase().includes(lower)) {
      out.push({
        kind: 'context',
        value: full,
        label: full,
        detail: p.type + (p.required ? ' · required' : ''),
      });
    }
  }
  return out;
}

function validate(
  from: string,
  workflow: WorkflowDefinition,
  currentNodeId: string,
): Validity {
  if (!from.trim()) return { state: 'empty' };

  const ctxMatch = from.match(/^context\.([^.]+)(\..+)?$/);
  if (ctxMatch) {
    const key = ctxMatch[1];
    const params = workflow.params ?? [];
    const ctxKeys = workflow.context ? Object.keys(workflow.context) : [];
    if (params.some((p) => p.name === key) || ctxKeys.includes(key)) {
      return { state: 'ok' };
    }
    return { state: 'warn', reason: `No param or context key named "${key}" — add it to Params, or the workflow will fail at run time.` };
  }

  const nodeMatch = from.match(/^nodes\.([^.]+)\.outputs\.(.+)$/);
  if (nodeMatch) {
    const [, nodeId, field] = nodeMatch;
    if (nodeId === currentNodeId) {
      return { state: 'warn', reason: 'Self-reference — a node cannot read its own outputs.' };
    }
    const target = workflow.nodes.find((n) => n.id === nodeId);
    if (!target) {
      return { state: 'warn', reason: `No node with id "${nodeId}".` };
    }
    if (target.outputs.length > 0) {
      const head = field.split('.')[0];
      if (!target.outputs.includes(head)) {
        return { state: 'warn', reason: `"${nodeId}" does not declare output "${head}". Declared: ${target.outputs.join(', ')}.` };
      }
    }
    return { state: 'ok' };
  }

  return { state: 'warn', reason: 'Expected "nodes.<id>.outputs.<field>" or "context.<key>".' };
}

function validityColor(v: Validity): string {
  if (v.state === 'ok') return tokens.status.completed;
  if (v.state === 'warn') return tokens.status.paused;
  return tokens.text.muted;
}

const KIND_COLORS: Record<Suggestion['kind'], string> = {
  context: '#a855f7',
  node: '#06b6d4',
  output: '#10b981',
};

function MappingRow({
  mapping,
  onChange,
  onRemove,
  workflow,
  currentNodeId,
  upstream,
  index,
}: {
  mapping: InputMapping;
  onChange: (m: InputMapping) => void;
  onRemove: () => void;
  workflow: WorkflowDefinition;
  currentNodeId: string;
  upstream: Set<string>;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(
    () => buildSuggestions(mapping.from, workflow, currentNodeId, upstream).slice(0, 8),
    [mapping.from, workflow, currentNodeId, upstream],
  );
  const validity = useMemo(
    () => validate(mapping.from, workflow, currentNodeId),
    [mapping.from, workflow, currentNodeId],
  );

  // Close the dropdown on outside click — fixes the case where the user
  // focuses the input, types, then clicks the canvas without committing.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Reset active index when the suggestion set changes size, otherwise the
  // highlighted row can point past the end of the new list.
  useEffect(() => { setActiveIdx(0); }, [suggestions.length]);

  const commit = (s: Suggestion) => {
    onChange({ ...mapping, from: s.value });
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6, padding: 8, marginBottom: 6,
      borderRadius: 6, backgroundColor: tokens.bg.raised, border: `1px solid ${tokens.border.subtle}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: tokens.text.muted, fontWeight: 600 }}>
          MAPPING {index + 1}
        </span>
        <button
          style={{ background: 'none', border: 'none', color: tokens.text.muted, cursor: 'pointer', fontSize: 10 }}
          onClick={onRemove}
        >remove</button>
      </div>

      {/* `from` combobox */}
      <div ref={wrapperRef} style={{ position: 'relative' }}>
        <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 2 }}>Source</div>
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            style={{
              ...inputBase, fontSize: 11, fontFamily: tokens.font.mono,
              paddingRight: 28,
              borderColor: open ? tokens.border.focus : tokens.border.subtle,
            }}
            placeholder="nodes.upstream.outputs.field  or  context.path"
            value={mapping.from}
            onFocus={() => setOpen(true)}
            onChange={(e) => { onChange({ ...mapping, from: e.target.value }); setOpen(true); }}
            onKeyDown={(e) => {
              if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
              if (!open) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter' && suggestions[activeIdx]) { e.preventDefault(); commit(suggestions[activeIdx]); }
              else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
              else if (e.key === 'Tab' && suggestions[activeIdx]) { commit(suggestions[activeIdx]); }
            }}
          />
          {validity.state !== 'empty' && (
            <span
              title={validity.state === 'warn' ? validity.reason : 'Path resolves to a known output'}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                fontSize: 11, color: validityColor(validity), cursor: 'help',
                fontFamily: tokens.font.sans, fontWeight: 700, lineHeight: 1,
              }}
            >
              {validity.state === 'ok' ? '\u2713' : '!'}
            </span>
          )}
        </div>

        {open && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 50,
            backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.default}`,
            borderRadius: 6, boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
            maxHeight: 240, overflow: 'auto',
          }}>
            {suggestions.map((s, i) => (
              <div
                key={s.value + i}
                onMouseDown={(e) => { e.preventDefault(); commit(s); }}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', cursor: 'pointer',
                  backgroundColor: i === activeIdx ? tokens.bg.hover : 'transparent',
                  borderLeft: `2px solid ${i === activeIdx ? KIND_COLORS[s.kind] : 'transparent'}`,
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  backgroundColor: KIND_COLORS[s.kind], flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 11, fontFamily: tokens.font.mono,
                  color: tokens.text.primary, flex: 1,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {s.label}
                </span>
                {s.detail && (
                  <span style={{
                    fontSize: 10, color: tokens.text.muted,
                    fontStyle: s.detail === 'upstream' ? 'normal' : 'italic',
                    fontWeight: s.detail === 'upstream' ? 600 : 400,
                    flexShrink: 0,
                  }}>
                    {s.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {validity.state === 'warn' && !open && (
          <div style={{
            fontSize: 10, color: tokens.status.paused, marginTop: 3,
            lineHeight: 1.4,
          }}>
            {validity.reason}
          </div>
        )}
      </div>

      {/* `to` target field name */}
      <div>
        <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 2 }}>Maps to input name</div>
        <input
          style={{ ...inputBase, fontSize: 11, fontFamily: tokens.font.mono }}
          placeholder="variableName"
          value={mapping.to}
          onChange={(e) => onChange({ ...mapping, to: e.target.value })}
        />
      </div>
    </div>
  );
}

export function InputMappingEditor({ node, workflow, onChange }: Props) {
  const upstream = useMemo(
    () => upstreamNodeIds(workflow, node.id),
    [workflow.edges, node.id],
  );

  const update = (i: number, m: InputMapping) => {
    const next = [...node.inputs];
    next[i] = m;
    onChange(next);
  };
  const remove = (i: number) => onChange(node.inputs.filter((_, j) => j !== i));
  const add = () => onChange([...node.inputs, { from: '', to: '' }]);

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
        Input Mappings
      </div>
      <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 8, lineHeight: 1.4 }}>
        Map data from upstream nodes or workflow context into this node's inputs. Click the Source field to pick from available paths.
      </div>
      {node.inputs.length === 0 && (
        <div style={{
          padding: '10px 12px', marginBottom: 8, borderRadius: 6,
          border: `1px dashed ${tokens.border.subtle}`,
          fontSize: 11, color: tokens.text.muted, textAlign: 'center',
        }}>
          No input mappings yet.
        </div>
      )}
      {node.inputs.map((inp, i) => (
        <MappingRow
          key={i}
          index={i}
          mapping={inp}
          workflow={workflow}
          currentNodeId={node.id}
          upstream={upstream}
          onChange={(m) => update(i, m)}
          onRemove={() => remove(i)}
        />
      ))}
      <button style={btnSecondary} onClick={add}>+ Add Input Mapping</button>
    </div>
  );
}

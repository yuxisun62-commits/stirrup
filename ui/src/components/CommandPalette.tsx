import { useEffect, useMemo, useRef, useState } from 'react';
import { listWorkflows, listNodeTypes, type WorkflowDefinition } from '../api/client';
import { tokens } from './ui/styles';
import { getNodeMetadata } from './nodeMetadata';

/**
 * Spotlight-style command palette — ⌘K / Ctrl-K opens it.
 *
 * Three result categories, each searched in parallel:
 *   - Workflows — switch to any workflow in the project.
 *   - Nodes — drop a specific node type onto the current canvas.
 *     (Calls onAddNode at viewport-center; drag-drop from the palette
 *     is still the richer affordance, this is the keyboard shortcut.)
 *   - Actions — top-level panel toggles (Templates, Connections,
 *     Triggers, Run, Save, Export) so power users don't need to reach
 *     for the mouse.
 *
 * Ranking: exact prefix matches on the label rank above substring
 * matches, which rank above description/type-id matches. Within ties,
 * workflows beat actions beat nodes — the most common intent is
 * "navigate to a workflow."
 */

export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  actions: CommandAction[];
  onSelectWorkflow: (wf: WorkflowDefinition) => void;
  onAddNode: (type: string) => void;
}

type Entry =
  | { kind: 'workflow'; label: string; sub: string; score: number; wf: WorkflowDefinition }
  | { kind: 'node'; label: string; sub: string; score: number; color: string; icon: string; type: string }
  | { kind: 'action'; label: string; sub: string; score: number; action: CommandAction };

export function CommandPalette({ open, onClose, actions, onSelectWorkflow, onAddNode }: Props) {
  const [query, setQuery] = useState('');
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [nodeTypes, setNodeTypes] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load data once per open — keeps the palette fast and avoids a
  // constant refresh cycle while closed.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    listWorkflows().then(setWorkflows).catch(() => {});
    listNodeTypes()
      .then((list) => setNodeTypes(list.map((t) => t.type)))
      .catch(() => {});
    // Focus after mount; setTimeout defers past React's event loop so
    // the underlying keydown that opened us doesn't land in the input.
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const entries = useMemo((): Entry[] => {
    const q = query.trim().toLowerCase();
    const out: Entry[] = [];

    const scoreFn = (label: string, sub: string): number => {
      if (!q) return 0;
      const l = label.toLowerCase();
      const s = sub.toLowerCase();
      if (l.startsWith(q)) return 3;
      if (l.includes(q)) return 2;
      if (s.includes(q)) return 1;
      return -1;
    };

    for (const wf of workflows) {
      const score = scoreFn(wf.name, wf.id);
      if (q && score < 0) continue;
      out.push({
        kind: 'workflow',
        label: wf.name,
        sub: wf.id,
        score: score + 0.5, // tie-breaker — workflows favored
        wf,
      });
    }

    for (const action of actions) {
      const keywordBlob = [action.hint ?? '', ...(action.keywords ?? [])].join(' ');
      const score = scoreFn(action.label, keywordBlob);
      if (q && score < 0) continue;
      out.push({
        kind: 'action',
        label: action.label,
        sub: action.hint ?? '',
        score: score + 0.2,
        action,
      });
    }

    for (const type of nodeTypes) {
      const meta = getNodeMetadata(type);
      const score = scoreFn(meta.label, `${type} ${meta.category}`);
      if (q && score < 0) continue;
      out.push({
        kind: 'node',
        label: meta.label,
        sub: `${meta.category} · ${type}`,
        score,
        color: meta.color,
        icon: meta.icon,
        type,
      });
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 60);
  }, [query, workflows, actions, nodeTypes]);

  // Keep active index inside bounds when results change.
  useEffect(() => {
    if (active >= entries.length) setActive(0);
  }, [entries.length, active]);

  if (!open) return null;

  const runEntry = (entry: Entry) => {
    if (entry.kind === 'workflow') onSelectWorkflow(entry.wf);
    else if (entry.kind === 'action') entry.action.run();
    else if (entry.kind === 'node') onAddNode(entry.type);
    onClose();
  };

  const onKeyDown: React.KeyboardEventHandler = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, entries.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (entries[active]) runEntry(entries[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(600px, 92vw)',
          backgroundColor: tokens.bg.surface,
          border: `1px solid ${tokens.border.default}`,
          borderRadius: 10,
          boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          maxHeight: '70vh',
        }}
      >
        <input
          ref={inputRef}
          placeholder="Search workflows, nodes, actions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          style={{
            padding: '12px 14px',
            fontSize: 14,
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: `1px solid ${tokens.border.subtle}`,
            color: tokens.text.primary,
            outline: 'none',
          }}
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {entries.length === 0 && (
            <div style={{
              padding: 20, textAlign: 'center', color: tokens.text.muted, fontSize: 12,
            }}>
              {query ? `No matches for "${query}"` : 'Start typing to search…'}
            </div>
          )}
          {entries.map((entry, idx) => (
            <EntryRow
              key={`${entry.kind}:${entry.label}:${idx}`}
              entry={entry}
              active={idx === active}
              onHover={() => setActive(idx)}
              onClick={() => runEntry(entry)}
            />
          ))}
        </div>

        <div style={{
          padding: '6px 14px',
          borderTop: `1px solid ${tokens.border.subtle}`,
          fontSize: 10, color: tokens.text.muted, fontFamily: tokens.font.mono,
          display: 'flex', gap: 14,
        }}>
          <span>↑↓ navigate</span>
          <span>⏎ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

function EntryRow({
  entry, active, onHover, onClick,
}: {
  entry: Entry; active: boolean; onHover: () => void; onClick: () => void;
}) {
  const kindLabel =
    entry.kind === 'workflow' ? 'WF' :
    entry.kind === 'action' ? 'ACT' : 'NODE';
  const kindColor =
    entry.kind === 'workflow' ? tokens.text.accent :
    entry.kind === 'action' ? '#f59e0b' :
    entry.kind === 'node' ? entry.color : tokens.text.muted;

  return (
    <button
      onMouseEnter={onHover}
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px',
        background: active ? `${tokens.border.focus}15` : 'transparent',
        border: 'none',
        borderLeft: active ? `3px solid ${tokens.border.focus}` : '3px solid transparent',
        color: tokens.text.primary,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {/* kind pill + icon */}
      <span style={{
        fontSize: 8, fontWeight: 800,
        padding: '2px 5px', borderRadius: 3,
        backgroundColor: `${kindColor}20`,
        color: kindColor,
        fontFamily: tokens.font.mono,
        letterSpacing: 0.4,
        whiteSpace: 'nowrap', flexShrink: 0,
        minWidth: 32, textAlign: 'center',
      }}>
        {kindLabel}
      </span>

      {entry.kind === 'node' && (
        <span style={{
          fontSize: 8, fontWeight: 800,
          padding: '2px 4px', borderRadius: 3,
          backgroundColor: `${entry.color}20`,
          color: entry.color,
          fontFamily: tokens.font.mono,
          whiteSpace: 'nowrap',
          maxWidth: 40, overflow: 'hidden', textOverflow: 'ellipsis',
          flexShrink: 0,
        }}>
          {entry.icon}
        </span>
      )}

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 13, fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {entry.label}
        </div>
        {entry.sub && (
          <div style={{
            fontSize: 10, color: tokens.text.muted, fontFamily: tokens.font.mono,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {entry.sub}
          </div>
        )}
      </div>
    </button>
  );
}

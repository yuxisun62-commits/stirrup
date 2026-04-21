import { useMemo } from 'react';
import type { WorkflowDefinition } from '../api/client';
import { tokens } from './ui/styles';

interface Props {
  /** Edge endpoints — used to look up the source node and sibling edges. */
  source: string;
  target: string;
  /** Draft condition text being edited (may be empty). */
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onClear: () => void;
  onCancel: () => void;
  /** Full workflow — so we can read the source's branch config + siblings. */
  workflow: WorkflowDefinition;
  /** Absolute position (px) to anchor the popover near the click point. */
  x: number;
  y: number;
}

/**
 * Gather the set of branch names the source node can legitimately emit.
 * Returns { mode, branches, hint } where `mode` drives UI affordances:
 *   - 'declared' : the source has an authoritative list (decision-routing)
 *   - 'inferred' : source is a `condition` node with no declared list, but
 *                   sibling edges have used branch names that hint at valid
 *                   options — surface them as suggestions without warning on
 *                   mismatch.
 *   - 'freeform' : source type doesn't branch; conditions rarely make sense
 *                   but we still allow free text (engine ignores unmatched).
 */
function analyzeSource(
  workflow: WorkflowDefinition,
  source: string,
  target: string,
): { mode: 'declared' | 'inferred' | 'freeform'; branches: string[]; sourceType: string } {
  const src = workflow.nodes.find((n) => n.id === source);
  const sourceType = src?.type ?? '(missing)';

  if (src?.type === 'decision-routing') {
    const cfgBranches = (src.config?.branches ?? {}) as Record<string, unknown>;
    const keys = Object.keys(cfgBranches);
    return { mode: 'declared', branches: keys, sourceType };
  }

  if (src?.type === 'condition') {
    const inferred = new Set<string>();
    for (const e of workflow.edges) {
      if (e.from === source && e.condition && !(e.to === target && !e.condition)) {
        inferred.add(e.condition);
      }
    }
    return { mode: 'inferred', branches: [...inferred], sourceType };
  }

  return { mode: 'freeform', branches: [], sourceType };
}

export function EdgeConditionPopover({
  source, target, value, onChange, onSave, onClear, onCancel, workflow, x, y,
}: Props) {
  const analysis = useMemo(
    () => analyzeSource(workflow, source, target),
    [workflow, source, target],
  );

  // Mismatch warning: if source is decision-routing and the entered value
  // doesn't match a declared branch, flag it — the scheduler will never
  // traverse this edge at runtime.
  const mismatch =
    analysis.mode === 'declared' &&
    value.trim().length > 0 &&
    !analysis.branches.includes(value.trim());

  const pickBranch = (name: string) => {
    onChange(name);
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: y - 10,
        left: x - 140,
        zIndex: 50,
        padding: 12,
        borderRadius: 8,
        backgroundColor: tokens.bg.surface,
        border: `1px solid ${tokens.border.default}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: 280,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Edge Condition
        </div>
        <div style={{ fontSize: 9, color: tokens.text.muted, fontFamily: tokens.font.mono, marginTop: 2 }}>
          {source} <span style={{ color: tokens.text.accent }}>→</span> {target}
        </div>
      </div>

      {/* Source-type context block */}
      <div style={{
        fontSize: 10, padding: '6px 8px', borderRadius: 4,
        backgroundColor: tokens.bg.raised, border: `1px solid ${tokens.border.subtle}`,
        color: tokens.text.secondary, lineHeight: 1.4,
      }}>
        <span style={{ fontWeight: 600, color: tokens.text.primary, fontFamily: tokens.font.mono }}>
          {analysis.sourceType}
        </span>{' '}
        {analysis.mode === 'declared' && (analysis.branches.length > 0
          ? 'declares the branches below — pick one to only traverse this edge when that branch is selected.'
          : 'has no branches declared yet. Add them in the node config, then come back.')
        }
        {analysis.mode === 'inferred' && (analysis.branches.length > 0
          ? 'returns a branch name string. Other sibling edges have used the names below.'
          : 'returns a branch name string. Type the value this edge should match.')
        }
        {analysis.mode === 'freeform' && (
          <>nodes don't select branches; a condition here will never match. Leave empty unless you know what you're doing.</>
        )}
      </div>

      {/* Branch pills (declared or inferred) */}
      {analysis.branches.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {analysis.branches.map((b) => {
            const active = value.trim() === b;
            return (
              <button
                key={b}
                onClick={() => pickBranch(b)}
                style={{
                  padding: '3px 8px', borderRadius: 10, fontSize: 10,
                  fontFamily: tokens.font.mono, fontWeight: 600,
                  border: `1px solid ${active ? '#f59e0b' : tokens.border.subtle}`,
                  backgroundColor: active ? '#f59e0b20' : tokens.bg.input,
                  color: active ? '#fbbf24' : tokens.text.primary,
                  cursor: 'pointer',
                }}
              >
                {b}
              </button>
            );
          })}
        </div>
      )}

      {/* Free-text input */}
      <div>
        <div style={{ fontSize: 9, color: tokens.text.muted, marginBottom: 2 }}>
          {analysis.branches.length > 0 ? 'Or type a custom branch name' : 'Branch name'}
        </div>
        <input
          autoFocus
          style={{
            width: '100%', padding: '6px 8px', fontSize: 11,
            borderRadius: 4,
            border: `1px solid ${mismatch ? tokens.status.paused : tokens.border.subtle}`,
            backgroundColor: tokens.bg.input, color: tokens.text.primary,
            fontFamily: tokens.font.mono, outline: 'none', boxSizing: 'border-box',
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder={
            analysis.mode === 'declared' && analysis.branches.length > 0
              ? analysis.branches[0]
              : 'e.g. success, failure, yes, no'
          }
        />
        {mismatch && (
          <div style={{ fontSize: 10, color: tokens.status.paused, marginTop: 3, lineHeight: 1.4 }}>
            {`"${value.trim()}" is not a declared branch — this edge will never be traversed.`}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button
          onClick={onSave}
          style={{
            flex: 1, padding: '5px 10px', fontSize: 10, fontWeight: 600,
            borderRadius: 4, border: 'none',
            backgroundColor: tokens.border.focus, color: '#fff', cursor: 'pointer',
          }}
        >Save</button>
        {value && (
          <button
            onClick={onClear}
            style={{
              padding: '5px 10px', fontSize: 10, fontWeight: 600,
              borderRadius: 4, border: `1px solid ${tokens.border.default}`,
              backgroundColor: 'transparent', color: tokens.text.muted, cursor: 'pointer',
            }}
          >Clear</button>
        )}
        <button
          onClick={onCancel}
          style={{
            padding: '5px 10px', fontSize: 10,
            borderRadius: 4, border: `1px solid ${tokens.border.default}`,
            backgroundColor: 'transparent', color: tokens.text.muted, cursor: 'pointer',
          }}
        >Cancel</button>
      </div>
    </div>
  );
}

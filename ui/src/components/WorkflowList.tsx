import { useState, useEffect } from 'react';
import { listWorkflows, deleteWorkflow, type WorkflowDefinition } from '../api/client';
import { tokens } from './ui/styles';

interface Props {
  currentId: string | null;
  onSelect: (wf: WorkflowDefinition) => void;
  onNew: () => void;
  onDeleted?: (id: string) => void;
}

export function WorkflowList({ currentId, onSelect, onNew, onDeleted }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const refresh = () => {
    listWorkflows().then(setWorkflows).catch((err) => setError(err.message));
  };

  useEffect(refresh, []);

  const handleDelete = async (e: React.MouseEvent, wf: WorkflowDefinition) => {
    e.stopPropagation();
    if (!confirm(`Delete workflow "${wf.name}"?\n\nThis removes the YAML file from disk. This cannot be undone.`)) return;
    try {
      await deleteWorkflow(wf.id);
      setWorkflows((prev) => prev.filter((w) => w.id !== wf.id));
      if (wf.id === currentId) onDeleted?.(wf.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ borderBottom: `1px solid ${tokens.border.subtle}` }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', cursor: 'pointer',
      }}
        onClick={() => setCollapsed((p) => !p)}
      >
        <span style={{
          fontSize: 10, fontWeight: 700, color: tokens.text.muted,
          textTransform: 'uppercase', letterSpacing: '1px',
        }}>
          Workflows {workflows.length > 0 && `(${workflows.length})`}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onNew(); }}
            style={{
              padding: '2px 8px', fontSize: 10, borderRadius: 4,
              border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
              color: tokens.text.secondary, cursor: 'pointer', fontWeight: 600,
            }}
          >
            + New
          </button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ padding: '0 8px 8px' }}>
          {error && (
            <div style={{
              fontSize: 10, color: tokens.status.failed, padding: '4px 8px',
              backgroundColor: `${tokens.status.failed}10`, borderRadius: 4, marginBottom: 4,
            }}>
              {error}
            </div>
          )}

          {workflows.length === 0 && !error && (
            <div style={{ fontSize: 11, color: tokens.text.muted, fontStyle: 'italic', padding: '4px 4px' }}>
              No workflows found. Create one or add YAML files to the workflows directory.
            </div>
          )}

          {workflows.map((wf) => {
            const isActive = wf.id === currentId;
            return (
              <div
                key={wf.id}
                onClick={() => onSelect(wf)}
                style={{
                  padding: '6px 8px', marginBottom: 2, borderRadius: 6, cursor: 'pointer',
                  backgroundColor: isActive ? `${tokens.border.focus}15` : 'transparent',
                  border: `1px solid ${isActive ? `${tokens.border.focus}40` : 'transparent'}`,
                  transition: 'background-color 0.15s',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = tokens.bg.hover; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: isActive ? tokens.text.accent : tokens.text.primary }}>
                    {wf.name}
                  </div>
                  <div style={{ fontSize: 10, color: tokens.text.muted, display: 'flex', gap: 8, marginTop: 1 }}>
                    <span style={{ fontFamily: tokens.font.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wf.id}</span>
                    <span>{wf.nodes.length} nodes</span>
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(e, wf)}
                  title={`Delete ${wf.name}`}
                  style={{
                    padding: '2px 5px', fontSize: 10, lineHeight: 1,
                    background: 'none', border: 'none',
                    color: tokens.text.muted, cursor: 'pointer',
                    borderRadius: 3, flexShrink: 0,
                    opacity: 0.4, transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.color = '#fca5a5'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.4'; (e.currentTarget as HTMLElement).style.color = tokens.text.muted; }}
                >
                  x
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

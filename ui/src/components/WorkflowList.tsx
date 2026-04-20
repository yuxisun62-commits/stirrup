import { useState, useEffect, useMemo } from 'react';
import {
  listWorkflows, deleteWorkflow, listExecutions,
  type WorkflowDefinition, type ExecutionState,
} from '../api/client';
import { tokens } from './ui/styles';

interface Props {
  currentId: string | null;
  onSelect: (wf: WorkflowDefinition) => void;
  onNew: () => void;
  onDeleted?: (id: string) => void;
}

interface TriggerBadge {
  label: string;
  color: string;
}

/**
 * Inspect `workflow.triggers` and summarize as small pills. Only renders
 * types the engine actually supports at runtime (http/webhook/cron/
 * telegram); older trigger fields like `watch` stay invisible so the
 * list doesn't promise things the backend wouldn't honor.
 */
function triggersFor(wf: WorkflowDefinition): TriggerBadge[] {
  const t = (wf as unknown as { triggers?: Record<string, unknown> }).triggers;
  if (!t) return [];
  const badges: TriggerBadge[] = [];
  if (t.http) badges.push({ label: 'HTTP', color: '#06b6d4' });
  if (t.webhook) badges.push({ label: 'HOOK', color: '#ec4899' });
  if (t.cron) badges.push({ label: 'CRON', color: '#f59e0b' });
  if (t.telegram) badges.push({ label: 'TG', color: '#0088cc' });
  return badges;
}

/**
 * Imported workflows keep their provenance in the id: ids start with
 * `n8n-` or `make-` when produced by the respective importers. Showing
 * a small pill lets users spot which entries are native vs. imported
 * so they can choose what to trust on first run.
 */
function sourceFor(wf: WorkflowDefinition): TriggerBadge | null {
  if (wf.id.startsWith('n8n-')) return { label: 'n8n', color: '#ea4b71' };
  if (wf.id.startsWith('make-')) return { label: 'Make', color: '#6d00cc' };
  return null;
}

function formatRelative(iso: string): string {
  const ago = Date.now() - new Date(iso).getTime();
  if (ago < 1000) return 'just now';
  if (ago < 60_000) return `${Math.floor(ago / 1000)}s ago`;
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m ago`;
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)}h ago`;
  if (ago < 7 * 86_400_000) return `${Math.floor(ago / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function WorkflowList({ currentId, onSelect, onNew, onDeleted }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [latestByWorkflow, setLatestByWorkflow] = useState<Record<string, ExecutionState>>({});
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');

  const refresh = () => {
    listWorkflows().then(setWorkflows).catch((err) => setError(err.message));
    // Pull the last N executions in one shot and map workflow→latest so
    // each row can show its most recent run status without N round-trips.
    listExecutions()
      .then((executions) => {
        const map: Record<string, ExecutionState> = {};
        for (const exec of executions) {
          const existing = map[exec.workflowId];
          if (!existing || new Date(exec.updatedAt) > new Date(existing.updatedAt)) {
            map[exec.workflowId] = exec;
          }
        }
        setLatestByWorkflow(map);
      })
      .catch(() => { /* non-fatal — the list still works without last-run info */ });
  };

  useEffect(refresh, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workflows;
    return workflows.filter((w) =>
      w.name.toLowerCase().includes(q) ||
      w.id.toLowerCase().includes(q) ||
      (w.description?.toLowerCase().includes(q) ?? false),
    );
  }, [workflows, query]);

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
          {/* Search — only shows when there are >5 workflows to avoid clutter */}
          {workflows.length > 5 && (
            <input
              placeholder="Search workflows…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: '100%', padding: '5px 8px', fontSize: 11,
                backgroundColor: tokens.bg.input,
                border: `1px solid ${tokens.border.subtle}`,
                borderRadius: 4, color: tokens.text.primary,
                outline: 'none', boxSizing: 'border-box',
                marginBottom: 6,
              }}
            />
          )}

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

          {workflows.length > 0 && filtered.length === 0 && (
            <div style={{ fontSize: 11, color: tokens.text.muted, fontStyle: 'italic', padding: '4px 4px' }}>
              No workflows match "{query}".
            </div>
          )}

          {filtered.map((wf) => {
            const isActive = wf.id === currentId;
            const triggers = triggersFor(wf);
            const source = sourceFor(wf);
            const latest = latestByWorkflow[wf.id];
            const latestColor = latest
              ? (latest.status === 'completed' ? tokens.status.completed
                : latest.status === 'failed' ? tokens.status.failed
                : latest.status === 'running' ? tokens.status.running
                : tokens.text.muted)
              : null;

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
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 12, fontWeight: 500,
                    color: isActive ? tokens.text.accent : tokens.text.primary,
                  }}>
                    <span style={{
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      minWidth: 0, flex: 1,
                    }}>
                      {wf.name}
                    </span>
                    {source && (
                      <span style={{
                        fontSize: 8, fontWeight: 700,
                        padding: '1px 4px', borderRadius: 3,
                        backgroundColor: `${source.color}20`,
                        color: source.color,
                        textTransform: 'uppercase', letterSpacing: 0.4,
                        flexShrink: 0,
                      }}>
                        {source.label}
                      </span>
                    )}
                    {triggers.map((t) => (
                      <span
                        key={t.label}
                        style={{
                          fontSize: 8, fontWeight: 700,
                          padding: '1px 4px', borderRadius: 3,
                          backgroundColor: `${t.color}20`,
                          color: t.color,
                          flexShrink: 0,
                        }}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                  <div style={{
                    fontSize: 10, color: tokens.text.muted,
                    display: 'flex', gap: 8, marginTop: 1,
                    alignItems: 'center',
                  }}>
                    <span style={{
                      fontFamily: tokens.font.mono,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      minWidth: 0, flex: '0 1 auto',
                    }}>
                      {wf.id}
                    </span>
                    <span style={{ flexShrink: 0 }}>{wf.nodes.length} nodes</span>
                    {latest && latestColor && (
                      <span
                        style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}
                        title={`Last run ${latest.status} at ${new Date(latest.updatedAt).toLocaleString()}`}
                      >
                        <span style={{
                          width: 5, height: 5, borderRadius: '50%',
                          backgroundColor: latestColor,
                          animation: latest.status === 'running' ? 'pulse 1.5s ease-in-out infinite' : undefined,
                        }} />
                        <span style={{ color: latestColor }}>{formatRelative(latest.updatedAt)}</span>
                      </span>
                    )}
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

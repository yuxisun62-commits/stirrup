import { useState, useEffect } from 'react';
import { listTemplates, getTemplate, type TemplateInfo, type WorkflowDefinition } from '../api/client';
import { tokens } from './ui/styles';

interface Props {
  onSelect: (wf: WorkflowDefinition) => void;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI-Powered',
  deterministic: 'Deterministic',
};

const NODE_TYPE_COLORS: Record<string, string> = {
  transform: '#6366f1',
  condition: '#f59e0b',
  http: '#06b6d4',
  script: '#8b5cf6',
  'llm-prompt': '#f97316',
  'agent-tool-use': '#14b8a6',
  'decision-routing': '#a855f7',
  'code-generation': '#84cc16',
};

export function TemplateBrowser({ onSelect, onClose }: Props) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  useEffect(() => {
    listTemplates()
      .then((t) => { setTemplates(t); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleUse = async () => {
    if (!selectedId) return;
    setLoadingTemplate(true);
    try {
      const wf = await getTemplate(selectedId);
      // Give it a unique ID so it doesn't clash
      wf.id = `${wf.id}-${Date.now().toString(36)}`;
      onSelect(wf);
    } catch (err) {
      alert(`Failed to load template: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingTemplate(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    }}
      onClick={onClose}
    >
      <div
        style={{
          width: 680, maxHeight: '80vh', borderRadius: 12,
          backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${tokens.border.subtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text.primary }}>Workflow Templates</div>
            <div style={{ fontSize: 12, color: tokens.text.muted, marginTop: 2 }}>
              Start from a pre-built workflow and customize it
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: tokens.text.muted,
              fontSize: 20, cursor: 'pointer', padding: '4px 8px',
            }}
          >x</button>
        </div>

        {/* Template grid */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: tokens.text.muted }}>Loading templates...</div>
          ) : templates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: tokens.text.muted }}>
              No templates found. Add YAML files to the templates/ directory.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {templates.map((t) => {
                const isSelected = selectedId === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    style={{
                      padding: 14, borderRadius: 8, cursor: 'pointer',
                      border: `2px solid ${isSelected ? tokens.border.focus : tokens.border.subtle}`,
                      backgroundColor: isSelected ? `${tokens.border.focus}10` : tokens.bg.raised,
                      transition: 'border-color 0.15s, background-color 0.15s',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = tokens.border.default; }}
                    onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = tokens.border.subtle; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{
                        fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                        backgroundColor: t.category === 'ai' ? '#f9731620' : '#6366f120',
                        color: t.category === 'ai' ? '#f97316' : '#6366f1',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                      }}>
                        {CATEGORY_LABELS[t.category] ?? t.category}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text.primary, marginBottom: 4 }}>
                      {t.name}
                    </div>
                    <div style={{ fontSize: 11, color: tokens.text.muted, lineHeight: 1.4, marginBottom: 8, minHeight: 30 }}>
                      {t.description}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: tokens.text.muted }}>
                        {t.nodeCount} nodes / {t.edgeCount} edges
                      </span>
                      <div style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
                        {t.nodeTypes.slice(0, 4).map((nt) => (
                          <span
                            key={nt}
                            style={{
                              width: 8, height: 8, borderRadius: 2,
                              backgroundColor: NODE_TYPE_COLORS[nt] ?? '#475569',
                            }}
                            title={nt}
                          />
                        ))}
                        {t.nodeTypes.length > 4 && (
                          <span style={{ fontSize: 9, color: tokens.text.muted }}>+{t.nodeTypes.length - 4}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${tokens.border.subtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px', fontSize: 12, borderRadius: 6,
              border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
              color: tokens.text.secondary, cursor: 'pointer', fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleUse}
            disabled={!selectedId || loadingTemplate}
            style={{
              padding: '7px 20px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: 'none',
              backgroundColor: selectedId ? tokens.border.focus : tokens.border.default,
              color: '#fff', cursor: selectedId ? 'pointer' : 'default',
              opacity: loadingTemplate ? 0.6 : 1,
            }}
          >
            {loadingTemplate ? 'Loading...' : 'Use Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

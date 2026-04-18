import { useState, useEffect, useRef } from 'react';
import { listTemplates, getTemplate, importN8n, importMake, type TemplateInfo, type WorkflowDefinition, type ImportReport } from '../api/client';
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
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importFormat, setImportFormat] = useState<'n8n' | 'make'>('n8n');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportReport(null);
    try {
      const text = await file.text();
      const source = JSON.parse(text);
      const result = importFormat === 'make'
        ? await importMake(source)
        : await importN8n(source);
      setImportReport(result.report);
      onSelect(result.workflow);
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
              Start from a pre-built workflow or import one from n8n / Make.com
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
              }}
            />
            <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
              <select
                value={importFormat}
                onChange={(e) => setImportFormat(e.target.value as 'n8n' | 'make')}
                disabled={importing}
                title="Source format of the JSON you're importing"
                style={{
                  padding: '6px 8px', fontSize: 11, fontWeight: 500,
                  borderRadius: '6px 0 0 6px',
                  border: `1px solid ${tokens.border.default}`, borderRight: 'none',
                  backgroundColor: tokens.bg.raised,
                  color: tokens.text.secondary, cursor: importing ? 'default' : 'pointer',
                  opacity: importing ? 0.6 : 1,
                  appearance: 'none',
                  paddingRight: 22,
                  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 4l3 3 3-3' stroke='${encodeURIComponent(tokens.text.muted)}' stroke-width='1.5' fill='none'/></svg>")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 6px center',
                }}
              >
                <option value="n8n">n8n</option>
                <option value="make">Make.com</option>
              </select>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                title={`Import a ${importFormat === 'make' ? 'Make.com blueprint' : 'n8n workflow'} JSON export`}
                style={{
                  padding: '6px 12px', fontSize: 11, fontWeight: 600,
                  borderRadius: '0 6px 6px 0',
                  border: `1px solid ${tokens.border.default}`,
                  backgroundColor: tokens.bg.raised,
                  color: tokens.text.primary, cursor: importing ? 'default' : 'pointer',
                  opacity: importing ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {importing ? 'Importing…' : 'Import…'}
              </button>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', color: tokens.text.muted,
                fontSize: 20, cursor: 'pointer', padding: '4px 8px',
              }}
            >x</button>
          </div>
        </div>

        {/* Import report banner */}
        {importReport && (
          <div style={{
            padding: '12px 20px', borderBottom: `1px solid ${tokens.border.subtle}`,
            backgroundColor: `${tokens.border.focus}08`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: tokens.text.primary, marginBottom: 4 }}>
              Imported: {importReport.sourceName}
            </div>
            <div style={{ fontSize: 11, color: tokens.text.secondary, lineHeight: 1.5 }}>
              {importReport.nodeCount} nodes, {importReport.edgeCount} edges ·{' '}
              {Object.values(importReport.mapped).reduce((a, b) => a + b, 0)} mapped ·{' '}
              <span style={{ color: Object.keys(importReport.stubbed).length > 0 ? '#f59e0b' : tokens.text.secondary }}>
                {Object.values(importReport.stubbed).reduce((a, b) => a + b, 0)} stubbed
              </span>
              {Object.keys(importReport.stubbed).length > 0 && (
                <> · needs manual mapping: {Object.keys(importReport.stubbed).sort().slice(0, 8).join(', ')}
                {Object.keys(importReport.stubbed).length > 8 ? '…' : ''}</>
              )}
            </div>
          </div>
        )}

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

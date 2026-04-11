import { useState } from 'react';
import { exportWorkflow, createWorkflow, saveWorkflow, type WorkflowDefinition } from '../api/client';
import { tokens } from './ui/styles';

interface Props {
  workflow: WorkflowDefinition;
  onClose: () => void;
  onDeploy: () => void;
}

type ExportFormat = 'node' | 'docker' | 'deploy';

const OPTIONS: Array<{
  format: ExportFormat;
  title: string;
  description: string;
  icon: string;
  color: string;
}> = [
  {
    format: 'node',
    title: 'Standalone Node.js Project',
    description: 'Zip file with server.js, package.json, and workflow. Run with `npm install && npm start`.',
    icon: 'JS',
    color: '#f7df1e',
  },
  {
    format: 'docker',
    title: 'Docker Container',
    description: 'Zip file including a Dockerfile. Build and run anywhere Docker is supported.',
    icon: 'DK',
    color: '#2496ed',
  },
  {
    format: 'deploy',
    title: 'Deploy to Launchmatic',
    description: 'Package and push directly to Launchmatic as a persistent hosted service.',
    icon: 'LM',
    color: '#06b6d4',
  },
];

export function ExportDialog({ workflow, onClose, onDeploy }: Props) {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (format: ExportFormat) => {
    setError(null);

    if (format === 'deploy') {
      onClose();
      onDeploy();
      return;
    }

    setExporting(format);
    try {
      // Ensure workflow is saved first so the server knows about it
      try { await createWorkflow(workflow); } catch { await saveWorkflow(workflow); }

      const blob = await exportWorkflow(workflow.id, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${workflow.id}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setTimeout(onClose, 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 520, maxHeight: '85vh', borderRadius: 12,
          backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${tokens.border.subtle}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text.primary }}>Export Workflow</div>
          <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 2 }}>
            Package "{workflow.name}" for deployment
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {OPTIONS.map((opt) => {
            const isExporting = exporting === opt.format;
            return (
              <div
                key={opt.format}
                onClick={() => !exporting && handleExport(opt.format)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: 14, marginBottom: 8, borderRadius: 8,
                  backgroundColor: tokens.bg.raised,
                  border: `1px solid ${isExporting ? opt.color : tokens.border.subtle}`,
                  cursor: exporting ? 'default' : 'pointer',
                  transition: 'border-color 0.15s, background-color 0.15s',
                  opacity: exporting && !isExporting ? 0.5 : 1,
                }}
                onMouseEnter={(e) => { if (!exporting) (e.currentTarget as HTMLElement).style.borderColor = opt.color; }}
                onMouseLeave={(e) => { if (!isExporting) (e.currentTarget as HTMLElement).style.borderColor = tokens.border.subtle; }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                  background: `linear-gradient(135deg, ${opt.color}30, ${opt.color}10)`,
                  border: `1px solid ${opt.color}50`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, color: opt.color,
                  fontFamily: tokens.font.mono,
                }}>
                  {opt.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text.primary, marginBottom: 2 }}>
                    {opt.title}
                  </div>
                  <div style={{ fontSize: 11, color: tokens.text.muted, lineHeight: 1.4 }}>
                    {opt.description}
                  </div>
                </div>
                {isExporting && (
                  <span style={{
                    width: 14, height: 14, borderRadius: '50%',
                    border: `2px solid ${opt.color}`, borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite', display: 'inline-block', flexShrink: 0,
                  }} />
                )}
              </div>
            );
          })}

          {error && (
            <div style={{
              marginTop: 10, padding: 10, borderRadius: 6,
              backgroundColor: `${tokens.status.failed}10`,
              border: `1px solid ${tokens.status.failed}30`,
              fontSize: 11, color: tokens.status.failed,
            }}>
              {error}
            </div>
          )}
        </div>

        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${tokens.border.subtle}`,
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button onClick={onClose} disabled={!!exporting} style={{
            padding: '7px 16px', fontSize: 12, borderRadius: 6,
            border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
            color: tokens.text.secondary, cursor: 'pointer',
          }}>Close</button>
        </div>
      </div>
    </div>
  );
}

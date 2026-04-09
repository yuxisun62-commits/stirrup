import { useState } from 'react';
import { tokens, inputBase, monoInput } from './ui/styles';

interface WorkflowParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  description?: string;
  required?: boolean;
  default?: unknown;
}

interface Props {
  params: WorkflowParam[];
  workflowName: string;
  onRun: (values: Record<string, unknown>) => void;
  onClose: () => void;
}

export function RunDialog({ params, workflowName, onRun, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of params) {
      if (p.default !== undefined) {
        initial[p.name] = typeof p.default === 'object' ? JSON.stringify(p.default) : String(p.default);
      } else {
        initial[p.name] = '';
      }
    }
    return initial;
  });

  const handleRun = () => {
    const coerced: Record<string, unknown> = {};
    for (const p of params) {
      const raw = values[p.name] ?? '';
      if (!raw && !p.required) continue;
      switch (p.type) {
        case 'number': coerced[p.name] = Number(raw); break;
        case 'boolean': coerced[p.name] = raw === 'true' || raw === '1'; break;
        case 'json':
          try { coerced[p.name] = JSON.parse(raw); } catch { coerced[p.name] = raw; }
          break;
        default: coerced[p.name] = raw;
      }
    }
    onRun(coerced);
  };

  const missingRequired = params
    .filter((p) => p.required && !(values[p.name] ?? '').trim())
    .map((p) => p.name);

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
          width: 480, maxHeight: '80vh', borderRadius: 12,
          backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${tokens.border.subtle}`,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text.primary }}>Run Workflow</div>
          <div style={{ fontSize: 12, color: tokens.text.muted, marginTop: 2 }}>{workflowName}</div>
        </div>

        {/* Params form */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          {params.length === 0 && (
            <div style={{ color: tokens.text.muted, fontSize: 12, fontStyle: 'italic' }}>
              No parameters declared. The workflow will run with default context values.
            </div>
          )}
          {params.map((p) => (
            <div key={p.name} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <span style={{
                  fontSize: 12, fontWeight: 600, color: tokens.text.primary,
                  fontFamily: tokens.font.mono,
                }}>
                  {p.name}
                </span>
                <span style={{ fontSize: 10, color: tokens.text.muted }}>({p.type})</span>
                {p.required && <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 700 }}>REQUIRED</span>}
              </div>
              {p.description && (
                <div style={{ fontSize: 11, color: tokens.text.muted, marginBottom: 4 }}>{p.description}</div>
              )}
              {p.type === 'boolean' ? (
                <select
                  style={{ ...inputBase, width: 120 }}
                  value={values[p.name] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                >
                  <option value="">— select —</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : p.type === 'json' ? (
                <textarea
                  style={{ ...monoInput, height: 60, resize: 'vertical' }}
                  value={values[p.name] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                  placeholder={`{"key": "value"}`}
                />
              ) : (
                <input
                  style={p.type === 'number' ? { ...inputBase, width: 160 } : inputBase}
                  type={p.type === 'number' ? 'number' : 'text'}
                  value={values[p.name] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                  placeholder={p.default !== undefined ? String(p.default) : undefined}
                />
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${tokens.border.subtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          {missingRequired.length > 0 && (
            <span style={{ fontSize: 10, color: '#ef4444', marginRight: 'auto' }}>
              Missing: {missingRequired.join(', ')}
            </span>
          )}
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
            onClick={handleRun}
            disabled={missingRequired.length > 0}
            style={{
              padding: '7px 20px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: 'none',
              backgroundColor: missingRequired.length === 0 ? tokens.status.completed : tokens.border.default,
              color: '#fff', cursor: missingRequired.length === 0 ? 'pointer' : 'default',
            }}
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
}

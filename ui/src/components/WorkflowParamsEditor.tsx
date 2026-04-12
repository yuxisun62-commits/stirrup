import { useState } from 'react';
import { tokens, inputBase, btnSecondary, btnDanger, selectStyle } from './ui/styles';
import type { WorkflowParam } from '../api/client';

interface Props {
  params: WorkflowParam[];
  onChange: (params: WorkflowParam[]) => void;
  onClose: () => void;
}

const EMPTY_PARAM: WorkflowParam = {
  name: '',
  type: 'string',
  required: false,
  description: '',
};

const TYPE_OPTIONS = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'json', label: 'json' },
];

const PICKER_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'github-repo', label: 'GitHub Repo' },
];

const SERVICE_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'github', label: 'GitHub' },
  { value: 'launchmatic', label: 'Launchmatic' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'slack', label: 'Slack' },
  { value: 'stripe', label: 'Stripe' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'typefully', label: 'Typefully' },
  { value: 'buffer', label: 'Buffer' },
  { value: 'replicate', label: 'Replicate' },
];

export function WorkflowParamsEditor({ params, onChange, onClose }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const addParam = () => {
    const name = `param${params.length + 1}`;
    onChange([...params, { ...EMPTY_PARAM, name }]);
    setEditingIndex(params.length);
  };

  const removeParam = (index: number) => {
    onChange(params.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(null);
  };

  const updateParam = (index: number, updates: Partial<WorkflowParam>) => {
    onChange(params.map((p, i) => (i === index ? { ...p, ...updates } : p)));
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
          width: 600, maxHeight: '85vh', borderRadius: 12,
          backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${tokens.border.subtle}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text.primary }}>Workflow Parameters</div>
              <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 2 }}>
                Define the inputs users provide when running this workflow. These appear in the Run dialog.
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', color: tokens.text.muted, fontSize: 20, cursor: 'pointer',
            }}>x</button>
          </div>
        </div>

        {/* Param list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          {params.length === 0 && (
            <div style={{
              textAlign: 'center', padding: 30, color: tokens.text.muted, fontSize: 12,
            }}>
              No parameters defined. Add one to make this workflow configurable.
            </div>
          )}

          {params.map((p, i) => {
            const isEditing = editingIndex === i;
            return (
              <div key={i} style={{
                marginBottom: 8, borderRadius: 8,
                border: `1px solid ${isEditing ? tokens.border.focus : tokens.border.subtle}`,
                backgroundColor: isEditing ? `${tokens.border.focus}08` : tokens.bg.raised,
                overflow: 'hidden',
              }}>
                {/* Summary row — click to expand */}
                <div
                  style={{
                    padding: '10px 12px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onClick={() => setEditingIndex(isEditing ? null : i)}
                >
                  <span style={{
                    fontSize: 12, fontWeight: 600, fontFamily: tokens.font.mono,
                    color: tokens.text.primary, flex: 1, minWidth: 0,
                  }}>
                    {p.name || <span style={{ color: tokens.text.muted, fontStyle: 'italic' }}>unnamed</span>}
                  </span>
                  <span style={{ fontSize: 10, color: tokens.text.muted }}>{p.type}</span>
                  {p.required && (
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                      backgroundColor: '#ef444420', color: '#ef4444',
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>REQ</span>
                  )}
                  {p.service && (
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                      backgroundColor: `${tokens.status.completed}20`, color: tokens.status.completed,
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>{p.service}</span>
                  )}
                  {p.picker && (
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                      backgroundColor: `${tokens.text.accent}20`, color: tokens.text.accent,
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>picker</span>
                  )}
                  <span style={{ fontSize: 10, color: tokens.text.muted }}>
                    {isEditing ? 'v' : '>'}
                  </span>
                </div>

                {/* Expanded editor */}
                {isEditing && (
                  <div style={{
                    padding: '8px 12px 12px', borderTop: `1px solid ${tokens.border.subtle}`,
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    {/* Row 1: name + type */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 2 }}>
                        <Label text="Name" />
                        <input
                          style={{ ...inputBase, fontFamily: tokens.font.mono, fontSize: 11 }}
                          value={p.name}
                          onChange={(e) => updateParam(i, { name: e.target.value })}
                          placeholder="paramName"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <Label text="Type" />
                        <select
                          style={selectStyle}
                          value={p.type}
                          onChange={(e) => updateParam(i, { type: e.target.value as WorkflowParam['type'] })}
                        >
                          {TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, paddingBottom: 2 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: tokens.text.secondary, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={p.required ?? false}
                            onChange={(e) => updateParam(i, { required: e.target.checked })}
                          />
                          Required
                        </label>
                      </div>
                    </div>

                    {/* Row 2: description */}
                    <div>
                      <Label text="Description" />
                      <input
                        style={inputBase}
                        value={p.description ?? ''}
                        onChange={(e) => updateParam(i, { description: e.target.value || undefined })}
                        placeholder="What this parameter is for"
                      />
                    </div>

                    {/* Row 3: default */}
                    <div>
                      <Label text="Default value" />
                      <input
                        style={{ ...inputBase, fontFamily: tokens.font.mono, fontSize: 11 }}
                        value={p.default !== undefined ? String(p.default) : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) { updateParam(i, { default: undefined }); return; }
                          if (p.type === 'number') { updateParam(i, { default: Number(v) }); return; }
                          if (p.type === 'boolean') { updateParam(i, { default: v === 'true' }); return; }
                          if (p.type === 'json') { try { updateParam(i, { default: JSON.parse(v) }); } catch { updateParam(i, { default: v }); } return; }
                          updateParam(i, { default: v });
                        }}
                        placeholder={p.type === 'json' ? '{"key": "value"}' : p.type === 'boolean' ? 'true or false' : ''}
                      />
                    </div>

                    {/* Row 4: service + picker */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <Label text="Service (auto-inject credential)" />
                        <select
                          style={selectStyle}
                          value={p.service ?? ''}
                          onChange={(e) => updateParam(i, { service: e.target.value || undefined })}
                        >
                          {SERVICE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <Label text="Picker (UI control)" />
                        <select
                          style={selectStyle}
                          value={p.picker ?? ''}
                          onChange={(e) => updateParam(i, { picker: (e.target.value || undefined) as WorkflowParam['picker'] })}
                        >
                          {PICKER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Delete */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                      <button
                        onClick={() => removeParam(i)}
                        style={{ ...btnDanger, fontSize: 10, padding: '3px 10px' }}
                      >
                        Remove param
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${tokens.border.subtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button onClick={addParam} style={{ ...btnSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>
            + Add Parameter
          </button>
          <button onClick={onClose} style={{
            padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
            border: 'none', backgroundColor: tokens.border.focus, color: '#fff', cursor: 'pointer',
          }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, color: tokens.text.muted,
      marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.5px',
    }}>
      {text}
    </div>
  );
}

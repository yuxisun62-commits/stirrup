import { useState } from 'react';
import { tokens, inputBase } from './ui/styles';

/**
 * Design-time editor for a workflow's `context` block.
 *
 * `workflow.context` is a flat (or nested) object of default values
 * that's merged with workflow params + runtime inputs to form the
 * shared state every node can reach via `context.*` mappings. Common
 * uses:
 *   - App-wide defaults ({ apiBase: "https://api.example.com" })
 *   - Constants ({ maxRetries: 3, timeout: 30000 })
 *   - Service tokens during dev ({ slackToken: "xoxb-..." })
 *
 * Two modes in the same modal:
 *   Fields — add/edit/remove one key-value pair at a time. Values get
 *     typed inputs where it helps (number/boolean), fall back to text
 *     for strings and a JSON editor for nested objects.
 *   JSON — commit-on-valid textarea of the raw object, for users who
 *     want to paste in a shape or edit nested trees at once.
 */

interface Props {
  context: Record<string, unknown> | undefined;
  onChange: (context: Record<string, unknown> | undefined) => void;
  onClose: () => void;
}

type FieldType = 'string' | 'number' | 'boolean' | 'json';

function inferType(value: unknown): FieldType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (value !== null && typeof value === 'object') return 'json';
  return 'string';
}

export function ContextEditor({ context, onChange, onClose }: Props) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...(context ?? {}) }));
  const [mode, setMode] = useState<'fields' | 'json'>('fields');
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(context ?? {}, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');

  const setField = (key: string, value: unknown) => {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      return next;
    });
  };

  const renameField = (oldKey: string, newKeyName: string) => {
    if (!newKeyName || newKeyName === oldKey || newKeyName in draft) return;
    setDraft((d) => {
      const { [oldKey]: value, ...rest } = d;
      return { ...rest, [newKeyName]: value };
    });
  };

  const removeField = (key: string) => {
    setDraft((d) => {
      const { [key]: _, ...rest } = d;
      return rest;
    });
  };

  const addField = () => {
    const key = newKey.trim();
    if (!key || key in draft) return;
    setField(key, '');
    setNewKey('');
  };

  const save = () => {
    // Normalize: drop empty context entirely so the YAML doesn't carry
    // an empty block. Partial-edits in JSON mode commit through jsonDraft.
    const source = mode === 'json' ? safeParse(jsonDraft) : draft;
    if (source === undefined) {
      setJsonError('Invalid JSON — fix or switch to Fields mode');
      return;
    }
    const keys = Object.keys(source);
    onChange(keys.length > 0 ? source : undefined);
    onClose();
  };

  const entries = Object.entries(draft);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 100vw)',
          maxHeight: '85vh',
          backgroundColor: tokens.bg.surface,
          border: `1px solid ${tokens.border.default}`,
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${tokens.border.subtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: tokens.text.primary }}>Workflow Context</div>
            <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 2 }}>
              Default values every node can read via <code style={{ color: tokens.text.accent }}>context.*</code> input mappings. {entries.length} fields.
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: tokens.text.muted,
            fontSize: 20, cursor: 'pointer', padding: 4,
          }}>x</button>
        </div>

        <div style={{
          display: 'flex', gap: 4, padding: '8px 16px 0',
        }}>
          {(['fields', 'json'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                if (m === 'json') setJsonDraft(JSON.stringify(draft, null, 2));
                if (m === 'fields') {
                  const parsed = safeParse(jsonDraft);
                  if (parsed !== undefined) setDraft(parsed);
                }
                setMode(m);
                setJsonError(null);
              }}
              style={{
                padding: '4px 12px', fontSize: 10, fontWeight: 600,
                border: 'none', background: 'none',
                color: mode === m ? tokens.text.primary : tokens.text.muted,
                borderBottom: mode === m ? `2px solid ${tokens.border.focus}` : '2px solid transparent',
                textTransform: 'uppercase', letterSpacing: '0.5px',
                cursor: 'pointer',
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {mode === 'fields' ? (
            <>
              {entries.length === 0 && (
                <div style={{ fontSize: 11, color: tokens.text.muted, fontStyle: 'italic', marginBottom: 10 }}>
                  No context fields yet. Add one below, or switch to JSON to paste a whole object.
                </div>
              )}

              {entries.map(([key, value]) => (
                <ContextField
                  key={key}
                  keyName={key}
                  value={value}
                  onRename={(newName) => renameField(key, newName)}
                  onValueChange={(v) => setField(key, v)}
                  onRemove={() => removeField(key)}
                />
              ))}

              <div style={{
                marginTop: 12, paddingTop: 10,
                borderTop: `1px dashed ${tokens.border.subtle}`,
                display: 'flex', gap: 6,
              }}>
                <input
                  style={{ ...inputBase, flex: 1, fontSize: 11, fontFamily: tokens.font.mono }}
                  placeholder="Add field name…"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addField()}
                />
                <button
                  onClick={addField}
                  disabled={!newKey.trim() || newKey in draft}
                  style={{
                    padding: '4px 12px', fontSize: 11, borderRadius: 5,
                    border: `1px solid ${tokens.border.default}`,
                    backgroundColor: tokens.bg.raised,
                    color: tokens.text.secondary,
                    cursor: newKey.trim() && !(newKey in draft) ? 'pointer' : 'default',
                    opacity: newKey.trim() && !(newKey in draft) ? 1 : 0.5,
                  }}
                >
                  Add
                </button>
              </div>
            </>
          ) : (
            <>
              <textarea
                value={jsonDraft}
                onChange={(e) => {
                  setJsonDraft(e.target.value);
                  setJsonError(null);
                }}
                rows={18}
                style={{
                  width: '100%', ...inputBase,
                  fontFamily: tokens.font.mono, fontSize: 12,
                  resize: 'vertical', minHeight: 300,
                  boxSizing: 'border-box',
                }}
              />
              {jsonError && (
                <div style={{
                  fontSize: 11, color: tokens.status.failed, marginTop: 6,
                  padding: '6px 8px', borderRadius: 4,
                  backgroundColor: `${tokens.status.failed}15`,
                  border: `1px solid ${tokens.status.failed}30`,
                }}>
                  {jsonError}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{
          padding: '10px 16px', borderTop: `1px solid ${tokens.border.subtle}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 5,
              border: `1px solid ${tokens.border.default}`,
              backgroundColor: 'transparent', color: tokens.text.muted,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            style={{
              padding: '7px 16px', fontSize: 12, fontWeight: 700, borderRadius: 5,
              border: 'none',
              backgroundColor: tokens.status.completed, color: '#fff',
              cursor: 'pointer',
            }}
          >
            Save context
          </button>
        </div>
      </div>
    </div>
  );
}

function ContextField({
  keyName, value, onRename, onValueChange, onRemove,
}: {
  keyName: string; value: unknown;
  onRename: (n: string) => void;
  onValueChange: (v: unknown) => void;
  onRemove: () => void;
}) {
  const [localKey, setLocalKey] = useState(keyName);
  const [type, setType] = useState<FieldType>(() => inferType(value));
  const [jsonDraft, setJsonDraft] = useState(() =>
    value !== null && typeof value === 'object' ? JSON.stringify(value, null, 2) : '',
  );

  const commitKey = () => {
    if (localKey !== keyName) onRename(localKey);
  };

  const handleTypeChange = (next: FieldType) => {
    setType(next);
    // Reset value on type change so the new input starts clean.
    if (next === 'string') onValueChange('');
    else if (next === 'number') onValueChange(0);
    else if (next === 'boolean') onValueChange(false);
    else if (next === 'json') { onValueChange({}); setJsonDraft('{}'); }
  };

  return (
    <div style={{
      marginBottom: 8,
      padding: 8,
      borderRadius: 6,
      backgroundColor: tokens.bg.raised,
      border: `1px solid ${tokens.border.subtle}`,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          style={{ ...inputBase, flex: 1, fontSize: 11, fontFamily: tokens.font.mono }}
          value={localKey}
          onChange={(e) => setLocalKey(e.target.value)}
          onBlur={commitKey}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLElement).blur()}
          placeholder="field-name"
        />
        <select
          value={type}
          onChange={(e) => handleTypeChange(e.target.value as FieldType)}
          style={{
            padding: '4px 6px', fontSize: 10, borderRadius: 4,
            border: `1px solid ${tokens.border.subtle}`,
            backgroundColor: tokens.bg.input, color: tokens.text.secondary,
            cursor: 'pointer',
          }}
        >
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="json">json</option>
        </select>
        <button
          onClick={onRemove}
          style={{
            background: 'none', border: 'none', color: tokens.text.muted,
            cursor: 'pointer', fontSize: 11, padding: '4px 6px',
          }}
          title="Remove field"
        >
          ×
        </button>
      </div>

      {type === 'string' && (
        <input
          style={{ ...inputBase, fontSize: 11, fontFamily: tokens.font.mono }}
          value={typeof value === 'string' ? value : String(value ?? '')}
          onChange={(e) => onValueChange(e.target.value)}
        />
      )}
      {type === 'number' && (
        <input
          type="number"
          style={{ ...inputBase, fontSize: 11, fontFamily: tokens.font.mono }}
          value={typeof value === 'number' ? value : 0}
          onChange={(e) => onValueChange(Number(e.target.value))}
        />
      )}
      {type === 'boolean' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: tokens.text.secondary }}>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onValueChange(e.target.checked)}
          />
          {value ? 'true' : 'false'}
        </label>
      )}
      {type === 'json' && (
        <textarea
          style={{
            ...inputBase, fontSize: 11, fontFamily: tokens.font.mono,
            minHeight: 70, resize: 'vertical', boxSizing: 'border-box',
          }}
          value={jsonDraft}
          onChange={(e) => {
            setJsonDraft(e.target.value);
            const parsed = safeParse(e.target.value);
            if (parsed !== undefined) onValueChange(parsed);
          }}
        />
      )}
    </div>
  );
}

function safeParse(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

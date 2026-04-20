/**
 * Auto-generated form editor.
 *
 * For plugin node types we haven't written an explicit schema for, walk
 * the current config keys and guess a sensible control for each:
 *   - boolean values         → toggle
 *   - numeric values         → number input
 *   - strings under 80 chars → single-line text
 *   - longer strings         → textarea
 *   - objects / arrays       → JSON editor
 *   - special names          → richer controls (prompt → big textarea,
 *                              url → text input with hint, token → password)
 *
 * The goal isn't perfect fidelity — it's avoiding the raw-JSON wall. A
 * user dropping a fresh plugin node with an empty config can still add
 * keys via the "Add field" row at the bottom and switch to JSON for
 * fiddly cases.
 */

import { useState } from 'react';
import {
  Field, TextInput, TextArea, NumberInput, Toggle, tokens, monoInput, inputBase,
} from './shared';

interface Props {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}

const PASSWORDY_KEYS = new Set([
  'token', 'apiKey', 'apiToken', 'secret', 'password',
  'connectionString', 'signingSecret', 'accessToken', 'refreshToken',
]);

const MULTILINE_HINTS = new Set([
  'prompt', 'body', 'html', 'text', 'description', 'message', 'content',
  'query', 'sql', 'expression', 'code', 'script', 'summary', 'instructions',
]);

const URL_HINTS = new Set(['url', 'webhookUrl', 'webhookUri', 'endpoint', 'endpointUrl', 'audioUrl', 'photoUrl']);

/** Reserved keys we manage via other UI tabs — don't render in the form. */
const HIDDEN_KEYS = new Set([
  '_n8nExpressions', '_n8nCondition', '_n8nPerItem', '_n8nReferencedNodes',
  '_makeExpressions', '_makeCondition', '_makeReferencedModules',
]);

export function AutoFormEditor({ config, onChange }: Props) {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(config, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');

  const setField = (key: string, value: unknown) => {
    const next = { ...config, [key]: value };
    if (value === undefined) delete next[key];
    onChange(next);
  };

  const removeField = (key: string) => {
    const next = { ...config };
    delete next[key];
    onChange(next);
  };

  const addField = () => {
    const key = newKey.trim();
    if (!key || key in config) return;
    setField(key, '');
    setNewKey('');
  };

  const applyJson = () => {
    try {
      onChange(JSON.parse(jsonDraft));
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  const visible = Object.entries(config).filter(([k]) => !HIDDEN_KEYS.has(k));

  return (
    <>
      <div style={{
        display: 'flex', gap: 4, marginBottom: 8,
        padding: 2, borderRadius: 5,
        backgroundColor: tokens.bg.input,
        border: `1px solid ${tokens.border.subtle}`,
        width: 'fit-content',
      }}>
        {(['form', 'json'] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              if (m === 'json') setJsonDraft(JSON.stringify(config, null, 2));
              setMode(m);
            }}
            style={{
              padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 3,
              border: 'none',
              backgroundColor: mode === m ? tokens.bg.raised : 'transparent',
              color: mode === m ? tokens.text.primary : tokens.text.muted,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'form' ? (
        <>
          {visible.length === 0 && (
            <div style={{ fontSize: 11, color: tokens.text.muted, marginBottom: 8, fontStyle: 'italic' }}>
              No config fields yet. Add one below or switch to JSON.
            </div>
          )}
          {visible.map(([key, value]) => (
            <AutoField
              key={key}
              fieldKey={key}
              value={value}
              onChange={(v) => setField(key, v)}
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
              disabled={!newKey.trim() || newKey in config}
              style={{
                padding: '4px 12px', fontSize: 11, borderRadius: 5,
                border: `1px solid ${tokens.border.default}`,
                backgroundColor: tokens.bg.raised,
                color: tokens.text.secondary,
                cursor: newKey.trim() ? 'pointer' : 'default',
                opacity: newKey.trim() && !(newKey in config) ? 1 : 0.5,
              }}
            >
              Add
            </button>
          </div>
        </>
      ) : (
        <Field label="Raw config (JSON)">
          <TextArea value={jsonDraft} onChange={setJsonDraft} rows={14} mono />
          {jsonError && (
            <div style={{ fontSize: 10, color: tokens.status.failed, marginTop: 4 }}>
              {jsonError}
            </div>
          )}
          <button
            onClick={applyJson}
            style={{
              marginTop: 6, padding: '4px 10px', fontSize: 11, borderRadius: 4,
              border: `1px solid ${tokens.border.default}`, backgroundColor: tokens.bg.raised,
              color: tokens.text.secondary, cursor: 'pointer',
            }}
          >
            Apply JSON
          </button>
        </Field>
      )}
    </>
  );
}

function AutoField({
  fieldKey,
  value,
  onChange,
  onRemove,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
  onRemove: () => void;
}) {
  const labelRow = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: tokens.text.muted, fontFamily: tokens.font.mono }}>
        {fieldKey}
      </span>
      <button
        onClick={onRemove}
        style={{ background: 'none', border: 'none', color: tokens.text.muted, cursor: 'pointer', fontSize: 10 }}
      >
        remove
      </button>
    </div>
  );

  if (typeof value === 'boolean') {
    return (
      <div style={{ marginBottom: 8 }}>
        {labelRow}
        <Toggle value={value} onChange={onChange} />
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div style={{ marginBottom: 8 }}>
        {labelRow}
        <NumberInput value={value} onChange={(v) => onChange(v ?? 0)} />
      </div>
    );
  }

  if (value !== null && typeof value === 'object') {
    return (
      <div style={{ marginBottom: 8 }}>
        {labelRow}
        <TextArea
          value={JSON.stringify(value, null, 2)}
          onChange={(v) => {
            try {
              onChange(JSON.parse(v));
            } catch {
              // hold invalid JSON in the textarea until it parses
            }
          }}
          rows={Math.min(8, Math.max(3, JSON.stringify(value).length / 40))}
          mono
        />
      </div>
    );
  }

  const strValue = value == null ? '' : String(value);
  const isPassword = PASSWORDY_KEYS.has(fieldKey);
  const isMultiline = MULTILINE_HINTS.has(fieldKey) || strValue.length > 80 || strValue.includes('\n');
  const isUrl = URL_HINTS.has(fieldKey);

  return (
    <div style={{ marginBottom: 8 }}>
      {labelRow}
      {isPassword ? (
        <input
          type="password"
          style={monoInput}
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : isMultiline ? (
        <TextArea
          value={strValue}
          onChange={onChange}
          rows={Math.min(10, Math.max(3, Math.ceil(strValue.length / 60)))}
        />
      ) : (
        <TextInput
          value={strValue}
          onChange={onChange}
          placeholder={isUrl ? 'https://…' : undefined}
        />
      )}
    </div>
  );
}

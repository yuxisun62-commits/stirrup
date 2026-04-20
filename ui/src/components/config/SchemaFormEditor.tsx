/**
 * Schema-driven form editor for plugin node configs.
 *
 * Given a NodeSchema (see schemas.ts), renders a form with the right
 * control per field. Behind a "Form / JSON" toggle — advanced users
 * or debugging scenarios can drop down to raw JSON when the form shape
 * is too restrictive.
 *
 * Fields not listed in the schema stay in the config object unchanged
 * (they're not dropped) and surface in the JSON tab if the user peeks.
 * This matters when a plugin mapper adds internal fields like
 * `_n8nExpressions` or `metadata` that we don't want to expose in the
 * form but also don't want to lose.
 */

import { useMemo, useState } from 'react';
import type { NodeSchema, FieldSchema } from './schemas';
import {
  Field, TextInput, TextArea, Select, NumberInput, Toggle, tokens, monoInput,
} from './shared';

interface Props {
  schema: NodeSchema;
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}

export function SchemaFormEditor({ schema, config, onChange }: Props) {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(config, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const visibleFields = useMemo(
    () => schema.fields.filter((f) => !f.showWhen || f.showWhen(config)),
    [schema.fields, config],
  );

  const setField = (key: string, value: unknown) => {
    // Preserve every config key the schema doesn't know about — the
    // importer adds flags like `_n8nExpressions` that handlers depend on.
    const next = { ...config, [key]: value };
    if (value === undefined || value === '' || value === null) {
      delete next[key];
    }
    onChange(next);
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft);
      onChange(parsed);
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

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
          {visibleFields.map((f) => (
            <FormField
              key={f.key}
              field={f}
              value={config[f.key]}
              onChange={(v) => setField(f.key, v)}
            />
          ))}
        </>
      ) : (
        <Field label="Raw config (JSON)">
          <TextArea value={jsonDraft} onChange={setJsonDraft} rows={12} mono />
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

/**
 * Render one schema field. Handles JSON-typed values by round-tripping
 * through a string editor with a parse-on-change step — anything that
 * doesn't parse is held in local state until it does.
 */
function FormField({
  field,
  value,
  onChange,
}: {
  field: FieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.control) {
    case 'text':
      return (
        <Field label={field.label} hint={field.hint} required={field.required}>
          <TextInput
            value={typeof value === 'string' ? value : value != null ? String(value) : ''}
            onChange={onChange}
            placeholder={field.placeholder}
          />
        </Field>
      );
    case 'password':
      return (
        <Field label={field.label} hint={field.hint} required={field.required}>
          <input
            type="password"
            style={monoInput}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
          />
        </Field>
      );
    case 'textarea':
      return (
        <Field label={field.label} hint={field.hint} required={field.required}>
          <TextArea
            value={typeof value === 'string' ? value : value != null ? String(value) : ''}
            onChange={onChange}
            rows={field.rows ?? 3}
            placeholder={field.placeholder}
          />
        </Field>
      );
    case 'code':
      return (
        <Field label={field.label} hint={field.hint} required={field.required}>
          <TextArea
            value={typeof value === 'string' ? value : value != null ? String(value) : ''}
            onChange={onChange}
            rows={field.rows ?? 6}
            placeholder={field.placeholder}
            mono
          />
        </Field>
      );
    case 'number':
      return (
        <Field label={field.label} hint={field.hint} required={field.required}>
          <NumberInput
            value={typeof value === 'number' ? value : undefined}
            onChange={(v) => onChange(v)}
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            step={field.step}
          />
        </Field>
      );
    case 'toggle':
      return (
        <div style={{ marginBottom: 8 }}>
          <Toggle
            value={Boolean(value)}
            onChange={onChange}
            label={field.label}
          />
          {field.hint && (
            <div style={{ fontSize: 10, color: tokens.text.muted, marginTop: 2, fontStyle: 'italic' }}>
              {field.hint}
            </div>
          )}
        </div>
      );
    case 'select':
      return (
        <Field label={field.label} hint={field.hint} required={field.required}>
          <Select
            value={typeof value === 'string' ? value : value != null ? String(value) : ''}
            onChange={onChange}
            options={[
              ...(field.options ?? []),
            ]}
          />
        </Field>
      );
    case 'json':
      return <JsonField field={field} value={value} onChange={onChange} />;
  }
}

/**
 * JSON editor with a commit-on-valid semantic. We keep a local string
 * draft so the user can type freely (even temporarily invalid JSON like
 * `{ "a": `); only when it parses do we propagate. Invalid drafts show
 * a red hint but don't throw away the user's keystrokes.
 */
function JsonField({
  field,
  value,
  onChange,
}: {
  field: FieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const initial = useMemo(() => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  }, [value]);

  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  // Keep local draft in sync when the underlying value changes (e.g. from
  // an upstream source like template browser loading a different workflow).
  // Avoid overwriting if the user is in the middle of editing by comparing
  // the parsed forms.
  useMemo(() => {
    try {
      if (JSON.stringify(JSON.parse(draft || 'null')) !== JSON.stringify(value ?? null)) {
        setDraft(initial);
      }
    } catch {
      // draft is invalid — leave it in place for the user
    }
  }, [initial]);

  const handleChange = (v: string) => {
    setDraft(v);
    if (v.trim() === '') {
      onChange(undefined);
      setError(null);
      return;
    }
    try {
      onChange(JSON.parse(v));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Field label={field.label} hint={field.hint} required={field.required}>
      <TextArea value={draft} onChange={handleChange} rows={field.rows ?? 4} mono />
      {error && (
        <div style={{ fontSize: 10, color: tokens.status.failed, marginTop: 2 }}>
          Invalid JSON: {error}
        </div>
      )}
    </Field>
  );
}

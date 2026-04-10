import { useState } from 'react';
import { Field, TextInput, TextArea, Select, SectionHeader } from './shared';
import { tokens, btnSecondary } from '../ui/styles';

interface Props {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}

export function HttpConfigEditor({ config, onChange }: Props) {
  const headers = (config.headers ?? {}) as Record<string, string>;
  const [newHeaderKey, setNewHeaderKey] = useState('');

  const addHeader = () => {
    if (!newHeaderKey.trim()) return;
    onChange({ ...config, headers: { ...headers, [newHeaderKey]: '' } });
    setNewHeaderKey('');
  };

  const updateHeader = (key: string, value: string) => {
    onChange({ ...config, headers: { ...headers, [key]: value } });
  };

  const removeHeader = (key: string) => {
    const next = { ...headers };
    delete next[key];
    onChange({ ...config, headers: next });
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <div style={{ width: 100 }}>
          <Field label="Method" required>
            <Select
              value={(config.method as string) ?? 'GET'}
              onChange={(v) => onChange({ ...config, method: v })}
              options={[
                { value: 'GET', label: 'GET' },
                { value: 'POST', label: 'POST' },
                { value: 'PUT', label: 'PUT' },
                { value: 'PATCH', label: 'PATCH' },
                { value: 'DELETE', label: 'DELETE' },
              ]}
            />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="URL" required>
            <TextInput
              value={(config.url as string) ?? ''}
              onChange={(v) => onChange({ ...config, url: v })}
              placeholder="https://api.example.com/{{path}}"
              mono
            />
          </Field>
        </div>
      </div>

      <SectionHeader title="Headers" />
      {Object.entries(headers).map(([key, val]) => (
        <div key={key} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: tokens.text.accent, minWidth: 80, fontFamily: tokens.font.mono }}>{key}</span>
          <input
            style={{ flex: 1, padding: '4px 6px', fontSize: 11, borderRadius: 4, border: `1px solid ${tokens.border.subtle}`, backgroundColor: tokens.bg.input, color: tokens.text.primary, fontFamily: tokens.font.mono }}
            value={val}
            onChange={(e) => updateHeader(key, e.target.value)}
          />
          <button style={{ ...btnSecondary, padding: '2px 6px', fontSize: 10, color: '#fca5a5', borderColor: '#7f1d1d' }} onClick={() => removeHeader(key)}>x</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <input
          style={{ flex: 1, padding: '4px 6px', fontSize: 11, borderRadius: 4, border: `1px solid ${tokens.border.subtle}`, backgroundColor: tokens.bg.input, color: tokens.text.primary }}
          value={newHeaderKey}
          onChange={(e) => setNewHeaderKey(e.target.value)}
          placeholder="Header name"
          onKeyDown={(e) => e.key === 'Enter' && addHeader()}
        />
        <button style={btnSecondary} onClick={addHeader}>+ Add</button>
      </div>

      {config.method !== 'GET' && (
        <Field label="Request Body" hint="JSON body or template string with {{variables}}">
          <TextArea
            value={typeof config.body === 'string' ? config.body : JSON.stringify(config.body ?? '', null, 2)}
            onChange={(v) => {
              try { onChange({ ...config, body: JSON.parse(v) }); } catch { onChange({ ...config, body: v }); }
            }}
            rows={10}
            mono
          />
        </Field>
      )}
    </>
  );
}

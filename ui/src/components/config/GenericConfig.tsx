import { useState, useEffect } from 'react';
import { Field, TextArea } from './shared';

interface Props {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}

export function GenericConfigEditor({ config, onChange }: Props) {
  const [json, setJson] = useState(JSON.stringify(config, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setJson(JSON.stringify(config, null, 2));
  }, [config]);

  const handleBlur = () => {
    try {
      const parsed = JSON.parse(json);
      onChange(parsed);
      setError(null);
    } catch (e) {
      setError('Invalid JSON');
    }
  };

  return (
    <>
      <Field label="Config (JSON)" hint="Edit the raw configuration object">
        <TextArea
          value={json}
          onChange={(v) => { setJson(v); setError(null); }}
          rows={10}
          mono
        />
      </Field>
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>{error}</div>}
      <div style={{ marginTop: 4 }}>
        <button
          onClick={handleBlur}
          style={{
            padding: '4px 10px', fontSize: 11, borderRadius: 4,
            border: '1px solid #2a3a4a', backgroundColor: '#1a2332',
            color: '#94a3b8', cursor: 'pointer',
          }}
        >
          Apply JSON
        </button>
      </div>
    </>
  );
}

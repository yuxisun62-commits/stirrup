import { Field, TextArea, Select, NumberInput, Toggle, SectionHeader } from './shared';

interface Props {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}

export function CodeGenerationConfigEditor({ config, onChange }: Props) {
  return (
    <>
      <Field label="Prompt Template" required hint="Describe what code to generate. Use {{variable}} for inputs">
        <TextArea
          value={(config.promptTemplate as string) ?? ''}
          onChange={(v) => onChange({ ...config, promptTemplate: v })}
          placeholder="Write a function that parses this CSV data:\n\n{{data}}"
          rows={5}
        />
      </Field>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Field label="Language" required>
            <Select
              value={(config.language as string) ?? 'javascript'}
              onChange={(v) => onChange({ ...config, language: v })}
              options={[
                { value: 'javascript', label: 'JavaScript' },
                { value: 'typescript', label: 'TypeScript' },
                { value: 'python', label: 'Python' },
              ]}
            />
          </Field>
        </div>
        <div style={{ paddingBottom: 4 }}>
          <Field label="Execute">
            <Toggle
              value={(config.execute as boolean) ?? false}
              onChange={(v) => onChange({ ...config, execute: v })}
              label="Run generated code"
            />
          </Field>
        </div>
      </div>

      {config.execute && (
        <Field label="Sandbox Timeout (ms)" hint="Max time for code execution">
          <NumberInput
            value={config.sandboxTimeoutMs as number | undefined}
            onChange={(v) => onChange({ ...config, sandboxTimeoutMs: v })}
            placeholder="10000"
            min={100}
            step={1000}
          />
        </Field>
      )}

      <SectionHeader title="Model Settings" />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Field label="Model">
            <Select
              value={(config.model as string) ?? ''}
              onChange={(v) => onChange({ ...config, model: v || undefined })}
              options={[
                { value: '', label: 'Default (Sonnet)' },
                { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
                { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
                { value: 'claude-haiku-4-20250414', label: 'Claude Haiku 4' },
              ]}
            />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Max Tokens">
            <NumberInput
              value={config.maxTokens as number | undefined}
              onChange={(v) => onChange({ ...config, maxTokens: v })}
              placeholder="4096"
              min={1}
            />
          </Field>
        </div>
      </div>
    </>
  );
}

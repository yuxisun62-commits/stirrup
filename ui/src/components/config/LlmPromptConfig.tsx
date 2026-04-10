import { Field, TextArea, Select, NumberInput, SectionHeader } from './shared';

interface Props {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}

export function LlmPromptConfigEditor({ config, onChange }: Props) {
  return (
    <>
      <Field label="Prompt Template" required hint="Use {{variable}} for inputs from upstream nodes">
        <TextArea
          value={(config.promptTemplate as string) ?? ''}
          onChange={(v) => onChange({ ...config, promptTemplate: v })}
          placeholder="Summarize the following text:\n\n{{text}}"
          rows={10}
        />
      </Field>

      <Field label="System Prompt" hint="Instructions for the AI model's behavior">
        <TextArea
          value={(config.systemPrompt as string) ?? ''}
          onChange={(v) => onChange({ ...config, systemPrompt: v })}
          placeholder="You are a helpful assistant that..."
          rows={6}
        />
      </Field>

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
          <Field label="Response Format">
            <Select
              value={(config.responseFormat as string) ?? 'text'}
              onChange={(v) => onChange({ ...config, responseFormat: v })}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'json', label: 'JSON' },
              ]}
            />
          </Field>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
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
        <div style={{ flex: 1 }}>
          <Field label="Temperature">
            <NumberInput
              value={config.temperature as number | undefined}
              onChange={(v) => onChange({ ...config, temperature: v })}
              placeholder="1.0"
              min={0}
              max={2}
              step={0.1}
            />
          </Field>
        </div>
      </div>
    </>
  );
}

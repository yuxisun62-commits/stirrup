import { useState } from 'react';
import { Field, TextArea, Select, NumberInput, SectionHeader } from './shared';
import { tokens, btnSecondary } from '../ui/styles';

interface Props {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}

export function AgentToolUseConfigEditor({ config, onChange }: Props) {
  const tools = (config.tools as string[]) ?? [];
  const [newTool, setNewTool] = useState('');

  const addTool = () => {
    if (!newTool.trim()) return;
    onChange({ ...config, tools: [...tools, newTool.trim()] });
    setNewTool('');
  };

  const removeTool = (idx: number) => {
    onChange({ ...config, tools: tools.filter((_, i) => i !== idx) });
  };

  return (
    <>
      <Field label="System Prompt" required hint="Defines the agent's role and behavior">
        <TextArea
          value={(config.systemPrompt as string) ?? ''}
          onChange={(v) => onChange({ ...config, systemPrompt: v })}
          placeholder="You are a data analysis assistant. Use the available tools to..."
          rows={4}
        />
      </Field>

      <Field label="Task Template" required hint="The task to give the agent. Use {{variable}} for inputs">
        <TextArea
          value={(config.taskTemplate as string) ?? ''}
          onChange={(v) => onChange({ ...config, taskTemplate: v })}
          placeholder="Analyze this dataset and provide insights: {{data}}"
          rows={3}
        />
      </Field>

      <SectionHeader title="Tools" />
      <div style={{ marginBottom: 6 }}>
        {tools.length === 0 && (
          <div style={{ fontSize: 11, color: tokens.text.muted, fontStyle: 'italic', padding: '4px 0' }}>
            No tools registered. Add tool names that match registered tool definitions.
          </div>
        )}
        {tools.map((tool, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', marginBottom: 3,
            borderRadius: 4, backgroundColor: tokens.bg.raised, border: `1px solid ${tokens.border.subtle}`,
          }}>
            <span style={{ fontSize: 11, fontFamily: tokens.font.mono, color: tokens.text.accent, flex: 1 }}>{tool}</span>
            <button
              style={{ background: 'none', border: 'none', color: tokens.text.muted, cursor: 'pointer', fontSize: 12, padding: '0 2px' }}
              onClick={() => removeTool(i)}
            >x</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <input
            style={{ flex: 1, padding: '4px 8px', fontSize: 11, borderRadius: 4, border: `1px solid ${tokens.border.subtle}`, backgroundColor: tokens.bg.input, color: tokens.text.primary, fontFamily: tokens.font.mono }}
            value={newTool}
            onChange={(e) => setNewTool(e.target.value)}
            placeholder="tool-name"
            onKeyDown={(e) => e.key === 'Enter' && addTool()}
          />
          <button style={btnSecondary} onClick={addTool}>+ Add</button>
        </div>
      </div>

      <SectionHeader title="Limits" />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Field label="Max Iterations" hint="Safety limit on agentic loops">
            <NumberInput
              value={config.maxIterations as number | undefined}
              onChange={(v) => onChange({ ...config, maxIterations: v })}
              placeholder="10"
              min={1}
              max={100}
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
    </>
  );
}

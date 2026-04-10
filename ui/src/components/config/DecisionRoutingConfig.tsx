import { useState } from 'react';
import { Field, TextArea, Select, NumberInput, SectionHeader } from './shared';
import { tokens, btnSecondary } from '../ui/styles';

interface Props {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}

export function DecisionRoutingConfigEditor({ config, onChange }: Props) {
  const branches = (config.branches ?? {}) as Record<string, string>;
  const [newBranchName, setNewBranchName] = useState('');

  const addBranch = () => {
    if (!newBranchName.trim()) return;
    onChange({ ...config, branches: { ...branches, [newBranchName.trim()]: '' } });
    setNewBranchName('');
  };

  const updateBranch = (name: string, description: string) => {
    onChange({ ...config, branches: { ...branches, [name]: description } });
  };

  const removeBranch = (name: string) => {
    const next = { ...branches };
    delete next[name];
    onChange({ ...config, branches: next });
  };

  return (
    <>
      <Field label="Prompt Template" required hint="Provide the data the AI should evaluate. Use {{variable}} for inputs">
        <TextArea
          value={(config.promptTemplate as string) ?? ''}
          onChange={(v) => onChange({ ...config, promptTemplate: v })}
          placeholder="Based on this customer feedback, decide the routing:\n\n{{feedback}}"
          rows={10}
        />
      </Field>

      <SectionHeader title="Branches" />
      <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 6 }}>
        Define the branches the AI can choose between. Each needs a name and a description to guide the AI's decision.
      </div>
      {Object.entries(branches).map(([name, desc]) => (
        <div key={name} style={{
          marginBottom: 6, padding: 8, borderRadius: 6,
          backgroundColor: tokens.bg.raised, border: `1px solid ${tokens.border.subtle}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: tokens.text.accent, fontFamily: tokens.font.mono }}>{name}</span>
            <button
              style={{ background: 'none', border: 'none', color: tokens.text.muted, cursor: 'pointer', fontSize: 11 }}
              onClick={() => removeBranch(name)}
            >remove</button>
          </div>
          <input
            style={{ width: '100%', padding: '4px 8px', fontSize: 11, borderRadius: 4, border: `1px solid ${tokens.border.subtle}`, backgroundColor: tokens.bg.input, color: tokens.text.primary, boxSizing: 'border-box' }}
            value={desc}
            onChange={(e) => updateBranch(name, e.target.value)}
            placeholder="Description for the AI (e.g. 'The customer is happy')"
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <input
          style={{ flex: 1, padding: '4px 8px', fontSize: 11, borderRadius: 4, border: `1px solid ${tokens.border.subtle}`, backgroundColor: tokens.bg.input, color: tokens.text.primary }}
          value={newBranchName}
          onChange={(e) => setNewBranchName(e.target.value)}
          placeholder="Branch name"
          onKeyDown={(e) => e.key === 'Enter' && addBranch()}
        />
        <button style={btnSecondary} onClick={addBranch}>+ Add Branch</button>
      </div>

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
              placeholder="100"
              min={1}
            />
          </Field>
        </div>
      </div>
    </>
  );
}

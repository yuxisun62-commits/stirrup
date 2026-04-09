import { useState } from 'react';
import type { WorkflowNode } from '../api/client';
import { ConfigEditor } from './config/ConfigEditor';
import { tokens, inputBase, btnSecondary, btnDanger } from './ui/styles';

interface Props {
  node: WorkflowNode;
  onUpdate: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onDelete: (nodeId: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  transform: 'Transform',
  condition: 'Condition',
  http: 'HTTP Request',
  script: 'Script',
  'llm-prompt': 'LLM Prompt',
  'agent-tool-use': 'Agent (Tool Use)',
  'decision-routing': 'AI Decision Router',
  'code-generation': 'Code Generation',
};

export function NodeInspector({ node, onUpdate, onDelete }: Props) {
  const [activeTab, setActiveTab] = useState<'config' | 'io' | 'advanced'>('config');
  const nodeColor = tokens.nodeColors[node.type] ?? '#475569';

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      borderLeft: `1px solid ${tokens.border.subtle}`, backgroundColor: tokens.bg.surface,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px', borderBottom: `1px solid ${tokens.border.subtle}`,
        background: `linear-gradient(135deg, ${nodeColor}15 0%, transparent 60%)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: nodeColor }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: nodeColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {TYPE_LABELS[node.type] ?? node.type}
          </span>
        </div>
        <input
          value={node.name}
          onChange={(e) => onUpdate(node.id, { name: e.target.value })}
          style={{
            ...inputBase, fontSize: 14, fontWeight: 600, padding: '4px 0',
            backgroundColor: 'transparent', border: 'none', borderBottom: `1px solid ${tokens.border.subtle}`,
            borderRadius: 0,
          }}
          placeholder="Node name"
        />
        <div style={{ fontSize: 10, color: tokens.text.muted, marginTop: 4, fontFamily: tokens.font.mono }}>
          id: {node.id}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${tokens.border.subtle}` }}>
        {(['config', 'io', 'advanced'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 600,
              border: 'none', cursor: 'pointer',
              backgroundColor: activeTab === tab ? tokens.bg.raised : 'transparent',
              color: activeTab === tab ? tokens.text.primary : tokens.text.muted,
              borderBottom: activeTab === tab ? `2px solid ${nodeColor}` : '2px solid transparent',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              fontFamily: tokens.font.sans,
            }}
          >
            {tab === 'io' ? 'I/O' : tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 14px' }}>
        {activeTab === 'config' && (
          <ConfigEditor
            type={node.type}
            config={node.config}
            onChange={(config) => onUpdate(node.id, { config })}
          />
        )}

        {activeTab === 'io' && (
          <InputOutputEditor node={node} onUpdate={onUpdate} />
        )}

        {activeTab === 'advanced' && (
          <AdvancedEditor node={node} onUpdate={onUpdate} onDelete={onDelete} />
        )}
      </div>
    </div>
  );
}

function InputOutputEditor({ node, onUpdate }: { node: WorkflowNode; onUpdate: (id: string, u: Partial<WorkflowNode>) => void }) {
  return (
    <>
      {/* Inputs */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
          Input Mappings
        </div>
        <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 8 }}>
          Map data from upstream nodes or context into this node's inputs.
        </div>
        {node.inputs.map((inp, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', gap: 3, padding: 8, marginBottom: 6,
            borderRadius: 6, backgroundColor: tokens.bg.raised, border: `1px solid ${tokens.border.subtle}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: tokens.text.muted, fontWeight: 600 }}>MAPPING {i + 1}</span>
              <button
                style={{ background: 'none', border: 'none', color: tokens.text.muted, cursor: 'pointer', fontSize: 10 }}
                onClick={() => onUpdate(node.id, { inputs: node.inputs.filter((_, j) => j !== i) })}
              >remove</button>
            </div>
            <div>
              <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 1 }}>Source</div>
              <input
                style={{ ...inputBase, fontSize: 11, fontFamily: tokens.font.mono }}
                placeholder="nodes.upstream.outputs.field  or  context.path"
                value={inp.from}
                onChange={(e) => {
                  const newInputs = [...node.inputs];
                  newInputs[i] = { ...newInputs[i], from: e.target.value };
                  onUpdate(node.id, { inputs: newInputs });
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 1 }}>Maps to input name</div>
              <input
                style={{ ...inputBase, fontSize: 11, fontFamily: tokens.font.mono }}
                placeholder="variableName"
                value={inp.to}
                onChange={(e) => {
                  const newInputs = [...node.inputs];
                  newInputs[i] = { ...newInputs[i], to: e.target.value };
                  onUpdate(node.id, { inputs: newInputs });
                }}
              />
            </div>
          </div>
        ))}
        <button
          style={btnSecondary}
          onClick={() => onUpdate(node.id, { inputs: [...node.inputs, { from: '', to: '' }] })}
        >
          + Add Input Mapping
        </button>
      </div>

      {/* Outputs */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
          Outputs
        </div>
        <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 8 }}>
          Declare the output field names this node produces. Downstream nodes reference these.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {node.outputs.map((out, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
              borderRadius: 4, backgroundColor: tokens.bg.raised, border: `1px solid ${tokens.border.subtle}`,
            }}>
              <input
                style={{
                  border: 'none', background: 'none', color: tokens.text.accent, fontSize: 11,
                  fontFamily: tokens.font.mono, width: Math.max(60, out.length * 7), padding: 0, outline: 'none',
                }}
                value={out}
                onChange={(e) => {
                  const newOutputs = [...node.outputs];
                  newOutputs[i] = e.target.value;
                  onUpdate(node.id, { outputs: newOutputs });
                }}
              />
              <button
                style={{ background: 'none', border: 'none', color: tokens.text.muted, cursor: 'pointer', fontSize: 11, padding: 0 }}
                onClick={() => onUpdate(node.id, { outputs: node.outputs.filter((_, j) => j !== i) })}
              >x</button>
            </div>
          ))}
          <button
            style={{ ...btnSecondary, padding: '3px 8px', fontSize: 11 }}
            onClick={() => onUpdate(node.id, { outputs: [...node.outputs, 'newField'] })}
          >+</button>
        </div>
      </div>
    </>
  );
}

function AdvancedEditor({ node, onUpdate, onDelete }: {
  node: WorkflowNode; onUpdate: (id: string, u: Partial<WorkflowNode>) => void; onDelete: (id: string) => void;
}) {
  const retry = node.retry ?? { maxAttempts: 1, backoffMs: 1000, backoffMultiplier: 2 };

  return (
    <>
      <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
        Node ID
      </div>
      <input
        style={{ ...inputBase, fontSize: 11, fontFamily: tokens.font.mono, marginBottom: 12 }}
        value={node.id}
        onChange={(e) => onUpdate(node.id, { id: e.target.value })}
      />

      <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
        Description
      </div>
      <textarea
        style={{ ...inputBase, height: 60, resize: 'vertical', fontSize: 11 }}
        value={node.description ?? ''}
        onChange={(e) => onUpdate(node.id, { description: e.target.value || undefined })}
        placeholder="Optional description for documentation"
      />

      <div style={{
        fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase',
        letterSpacing: '1px', marginTop: 12, marginBottom: 6,
        paddingTop: 8, borderTop: `1px solid ${tokens.border.subtle}`,
      }}>
        Retry Policy
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 2 }}>Attempts</div>
          <input
            type="number"
            style={{ ...inputBase, fontSize: 11 }}
            value={retry.maxAttempts}
            min={1}
            onChange={(e) => onUpdate(node.id, { retry: { ...retry, maxAttempts: Number(e.target.value) } })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 2 }}>Backoff (ms)</div>
          <input
            type="number"
            style={{ ...inputBase, fontSize: 11 }}
            value={retry.backoffMs}
            min={0}
            onChange={(e) => onUpdate(node.id, { retry: { ...retry, backoffMs: Number(e.target.value) } })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 2 }}>Multiplier</div>
          <input
            type="number"
            style={{ ...inputBase, fontSize: 11 }}
            value={retry.backoffMultiplier}
            min={1}
            step={0.5}
            onChange={(e) => onUpdate(node.id, { retry: { ...retry, backoffMultiplier: Number(e.target.value) } })}
          />
        </div>
      </div>

      {/* Danger zone */}
      <div style={{
        marginTop: 20, paddingTop: 12, borderTop: `1px solid #7f1d1d`,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
          Danger Zone
        </div>
        <button style={btnDanger} onClick={() => onDelete(node.id)}>
          Delete This Node
        </button>
      </div>
    </>
  );
}

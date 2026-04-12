import { useState } from 'react';
import type { WorkflowNode, StepResult } from '../api/client';
import { ConfigEditor } from './config/ConfigEditor';
import { StatusBadge } from './StatusBadge';
import { tokens, inputBase, btnSecondary, btnDanger } from './ui/styles';
import { BugIcon } from './ui/icons';

interface Props {
  node: WorkflowNode;
  stepResult?: StepResult;
  onUpdate: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  onDelete: (nodeId: string) => void;
  onDebug?: () => void;
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

export function NodeInspector({ node, stepResult, onUpdate, onDelete, onDebug }: Props) {
  const [activeTab, setActiveTab] = useState<'config' | 'io' | 'results' | 'advanced'>(
    stepResult?.status === 'completed' || stepResult?.status === 'failed' ? 'results' : 'config'
  );
  const nodeColor = tokens.nodeColors[node.type] ?? '#475569';
  const hasResults = !!stepResult;

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
        {(['config', 'io', 'results', 'advanced'] as const).map((tab) => {
          const isResults = tab === 'results';
          const label = tab === 'io' ? 'I/O' : tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 600,
                border: 'none', cursor: 'pointer',
                backgroundColor: activeTab === tab ? tokens.bg.raised : 'transparent',
                color: isResults && hasResults
                  ? (stepResult?.status === 'failed' ? tokens.status.failed : tokens.status.completed)
                  : activeTab === tab ? tokens.text.primary : tokens.text.muted,
                borderBottom: activeTab === tab ? `2px solid ${nodeColor}` : '2px solid transparent',
                textTransform: 'uppercase', letterSpacing: '0.5px',
                fontFamily: tokens.font.sans,
                position: 'relative',
              }}
            >
              {label}
              {isResults && hasResults && (
                <span style={{
                  position: 'absolute', top: 3, right: 6,
                  width: 6, height: 6, borderRadius: '50%',
                  backgroundColor: stepResult?.status === 'failed' ? tokens.status.failed : tokens.status.completed,
                }} />
              )}
            </button>
          );
        })}
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

        {activeTab === 'results' && (
          <ResultsViewer stepResult={stepResult} onDebug={onDebug} />
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

function ResultsViewer({ stepResult, onDebug }: { stepResult?: StepResult; onDebug?: () => void }) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  if (!stepResult) {
    return (
      <div style={{ textAlign: 'center', padding: 30 }}>
        <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>--</div>
        <div style={{ fontSize: 12, color: tokens.text.muted }}>No execution results yet</div>
        <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 4 }}>Run the workflow to see outputs here</div>
      </div>
    );
  }

  const toggleKey = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const elapsed = stepResult.startedAt && stepResult.completedAt
    ? new Date(stepResult.completedAt).getTime() - new Date(stepResult.startedAt).getTime()
    : null;

  return (
    <>
      {/* Status header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
        padding: '8px 10px', borderRadius: 6,
        backgroundColor: stepResult.status === 'failed' ? `${tokens.status.failed}10` :
          stepResult.status === 'completed' ? `${tokens.status.completed}10` : tokens.bg.raised,
        border: `1px solid ${stepResult.status === 'failed' ? `${tokens.status.failed}30` :
          stepResult.status === 'completed' ? `${tokens.status.completed}30` : tokens.border.subtle}`,
      }}>
        <StatusBadge status={stepResult.status} />
        {elapsed !== null && (
          <span style={{ fontSize: 11, color: tokens.text.muted, fontFamily: tokens.font.mono }}>
            {elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`}
          </span>
        )}
        <span style={{ fontSize: 10, color: tokens.text.muted, marginLeft: 'auto' }}>
          {stepResult.attempts > 1 ? `${stepResult.attempts} attempts` : ''}
        </span>
      </div>

      {/* Timing */}
      <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 10 }}>
        {stepResult.startedAt && (
          <div>Started: <span style={{ fontFamily: tokens.font.mono }}>{new Date(stepResult.startedAt).toLocaleTimeString()}</span></div>
        )}
        {stepResult.completedAt && (
          <div>Completed: <span style={{ fontFamily: tokens.font.mono }}>{new Date(stepResult.completedAt).toLocaleTimeString()}</span></div>
        )}
        {stepResult.selectedBranch && (
          <div style={{ marginTop: 4 }}>
            Branch: <span style={{ color: tokens.text.accent, fontFamily: tokens.font.mono, fontWeight: 600 }}>{stepResult.selectedBranch}</span>
          </div>
        )}
      </div>

      {/* Error */}
      {stepResult.error && (
        <div style={{
          marginBottom: 10, padding: 10, borderRadius: 6,
          backgroundColor: `${tokens.status.failed}10`, border: `1px solid ${tokens.status.failed}30`,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.status.failed, textTransform: 'uppercase', marginBottom: 4 }}>
            Error (attempt {stepResult.error.attempt})
          </div>
          <div style={{ fontSize: 11, color: '#fca5a5', fontFamily: tokens.font.mono, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {stepResult.error.message}
          </div>
          {onDebug && (
            <button
              onClick={onDebug}
              style={{
                marginTop: 8, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                border: 'none',
                background: `linear-gradient(135deg, ${tokens.status.failed}, #f97316)`,
                color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              <BugIcon />
              Debug Node
            </button>
          )}
        </div>
      )}

      {/* Outputs */}
      {stepResult.status === 'completed' && Object.keys(stepResult.outputs).length > 0 && (
        <>
          <div style={{
            fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase',
            letterSpacing: '1px', marginBottom: 6,
          }}>
            Outputs
          </div>
          {Object.entries(stepResult.outputs).map(([key, value]) => {
            const isObject = value !== null && typeof value === 'object';
            const isLong = typeof value === 'string' && value.length > 100;
            const isExpandable = isObject || isLong;
            const isExpanded = expandedKeys.has(key);
            const displayValue = isObject
              ? JSON.stringify(value, null, 2)
              : String(value ?? '');

            return (
              <div key={key} style={{
                marginBottom: 6, borderRadius: 6, overflow: 'hidden',
                border: `1px solid ${tokens.border.subtle}`, backgroundColor: tokens.bg.raised,
              }}>
                <div
                  onClick={() => isExpandable && toggleKey(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', cursor: isExpandable ? 'pointer' : 'default',
                    borderBottom: isExpanded ? `1px solid ${tokens.border.subtle}` : 'none',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: tokens.text.accent, fontFamily: tokens.font.mono }}>
                    {key}
                  </span>
                  <span style={{ fontSize: 10, color: tokens.text.muted }}>
                    {isObject ? (Array.isArray(value) ? `Array(${(value as any[]).length})` : 'Object') :
                      typeof value === 'string' ? `"${displayValue.slice(0, 30)}${displayValue.length > 30 ? '...' : ''}"` :
                      String(value)}
                  </span>
                  {isExpandable && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: tokens.text.muted }}>
                      {isExpanded ? 'v' : '>'}
                    </span>
                  )}
                </div>
                {isExpanded && (
                  <div style={{
                    padding: '8px 10px', fontSize: 11, fontFamily: tokens.font.mono,
                    color: tokens.text.primary, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    maxHeight: 300, overflow: 'auto', lineHeight: 1.5,
                    backgroundColor: tokens.bg.input,
                  }}>
                    {displayValue}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {stepResult.status === 'completed' && Object.keys(stepResult.outputs).length === 0 && (
        <div style={{ fontSize: 11, color: tokens.text.muted, fontStyle: 'italic' }}>
          No outputs produced
        </div>
      )}
    </>
  );
}

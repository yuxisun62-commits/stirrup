import { useState, type DragEvent } from 'react';
import { tokens } from './ui/styles';

interface NodeTypeInfo {
  type: string;
  label: string;
  description: string;
  color: string;
  icon: string;
  category: 'deterministic' | 'ai';
}

const NODE_TYPES: NodeTypeInfo[] = [
  { type: 'transform', label: 'Transform', description: 'Evaluate a JS expression on inputs', color: '#6366f1', icon: 'f(x)', category: 'deterministic' },
  { type: 'condition', label: 'Condition', description: 'Branch based on an expression', color: '#f59e0b', icon: '?:', category: 'deterministic' },
  { type: 'http', label: 'HTTP Request', description: 'Make HTTP calls to external APIs', color: '#06b6d4', icon: 'GET', category: 'deterministic' },
  { type: 'script', label: 'Script', description: 'Run arbitrary JS in a sandbox', color: '#8b5cf6', icon: '{ }', category: 'deterministic' },
  { type: 'llm-prompt', label: 'LLM Prompt', description: 'Send a templated prompt to Claude', color: '#ec4899', icon: 'AI', category: 'ai' },
  { type: 'agent-tool-use', label: 'Agent', description: 'Autonomous AI with tool access', color: '#f43f5e', icon: 'BOT', category: 'ai' },
  { type: 'decision-routing', label: 'AI Decision', description: 'AI picks the next branch', color: '#e11d48', icon: 'RTE', category: 'ai' },
  { type: 'code-generation', label: 'Code Gen', description: 'AI generates & runs code', color: '#be185d', icon: '</>',  category: 'ai' },
];

export function NodePalette() {
  const [collapsed, setCollapsed] = useState(false);

  const onDragStart = (e: DragEvent, type: string) => {
    e.dataTransfer.setData('application/workflow-node-type', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  if (collapsed) {
    return (
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${tokens.border.subtle}` }}>
        <button
          onClick={() => setCollapsed(false)}
          style={{
            width: '100%', padding: '6px', fontSize: 11, fontWeight: 600,
            backgroundColor: 'transparent', border: `1px dashed ${tokens.border.default}`,
            color: tokens.text.muted, cursor: 'pointer', borderRadius: 4,
          }}
        >
          + Show Node Palette
        </button>
      </div>
    );
  }

  return (
    <div data-tutorial="node-palette" style={{ padding: '10px 12px', flex: 1, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: tokens.text.muted,
          textTransform: 'uppercase', letterSpacing: '1px',
        }}>
          Nodes
        </span>
        <button
          onClick={() => setCollapsed(true)}
          style={{ background: 'none', border: 'none', color: tokens.text.muted, cursor: 'pointer', fontSize: 10 }}
        >
          collapse
        </button>
      </div>

      <CategoryGroup title="Deterministic" nodes={NODE_TYPES.filter((n) => n.category === 'deterministic')} onDragStart={onDragStart} />
      <CategoryGroup title="AI-Powered" nodes={NODE_TYPES.filter((n) => n.category === 'ai')} onDragStart={onDragStart} />

      <div style={{ marginTop: 12, padding: 8, borderRadius: 6, backgroundColor: `${tokens.border.subtle}50`, fontSize: 10, color: tokens.text.muted, lineHeight: 1.5 }}>
        Drag a node onto the canvas to add it to your workflow. Connect nodes by dragging from one handle to another.
      </div>
    </div>
  );
}

function CategoryGroup({ title, nodes, onDragStart }: {
  title: string; nodes: NodeTypeInfo[]; onDragStart: (e: DragEvent, type: string) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase',
        letterSpacing: '1.5px', marginBottom: 6, paddingBottom: 3,
        borderBottom: `1px solid ${tokens.border.subtle}`,
      }}>
        {title}
      </div>
      {nodes.map((node) => (
        <div
          key={node.type}
          draggable
          onDragStart={(e) => onDragStart(e, node.type)}
          style={{
            padding: '7px 10px',
            marginBottom: 3,
            borderRadius: 6,
            border: `1px solid ${node.color}30`,
            backgroundColor: `${node.color}08`,
            cursor: 'grab',
            transition: 'background-color 0.15s, border-color 0.15s',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = `${node.color}18`;
            (e.currentTarget as HTMLElement).style.borderColor = `${node.color}50`;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = `${node.color}08`;
            (e.currentTarget as HTMLElement).style.borderColor = `${node.color}30`;
          }}
        >
          <div style={{
            width: 28, height: 28, borderRadius: 5,
            backgroundColor: `${node.color}20`, border: `1px solid ${node.color}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 800, color: node.color,
            fontFamily: tokens.font.mono, flexShrink: 0,
          }}>
            {node.icon}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: tokens.text.primary, lineHeight: 1.2 }}>
              {node.label}
            </div>
            <div style={{ fontSize: 10, color: tokens.text.muted, lineHeight: 1.3 }}>
              {node.description}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

import { useCallback, useRef, useMemo, useEffect, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type OnConnect,
  type NodeTypes,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowDefinition, WorkflowNode as WfNode } from '../api/client';
import { tokens } from './ui/styles';

const TYPE_ICONS: Record<string, string> = {
  transform: 'f(x)',
  condition: '?:',
  http: 'GET',
  script: '{ }',
  'llm-prompt': 'AI',
  'agent-tool-use': 'BOT',
  'decision-routing': 'RTE',
  'code-generation': '</>',
};

const STATUS_CONFIG: Record<string, { color: string; label: string; pulse: boolean }> = {
  running: { color: tokens.status.running, label: 'RUNNING', pulse: true },
  completed: { color: tokens.status.completed, label: 'DONE', pulse: false },
  failed: { color: tokens.status.failed, label: 'FAILED', pulse: false },
  skipped: { color: tokens.status.skipped, label: 'SKIP', pulse: false },
  pending: { color: tokens.status.pending, label: 'WAIT', pulse: false },
};

function CustomNode({ data, selected }: { data: { label: string; type: string; status?: string; outputCount: number; inputCount: number }; selected?: boolean }) {
  const color = tokens.nodeColors[data.type] ?? '#475569';
  const statusCfg = data.status ? STATUS_CONFIG[data.status] : null;
  const borderColor = statusCfg ? statusCfg.color : selected ? '#60a5fa' : `${color}60`;

  return (
    <div
      style={{
        padding: 0,
        borderRadius: 10,
        border: `2px solid ${borderColor}`,
        backgroundColor: tokens.bg.surface,
        minWidth: 150,
        overflow: 'hidden',
        boxShadow: statusCfg?.pulse
          ? `0 0 16px ${statusCfg.color}40, 0 0 4px ${statusCfg.color}20`
          : selected ? `0 0 12px #60a5fa30` : '0 2px 8px rgba(0,0,0,0.3)',
        transition: 'border-color 0.3s, box-shadow 0.3s',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ backgroundColor: color, width: 8, height: 8, border: `2px solid ${tokens.bg.surface}` }} />

      {/* Type header bar */}
      <div style={{
        padding: '4px 10px',
        backgroundColor: `${color}15`,
        borderBottom: `1px solid ${color}25`,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 800, color, fontFamily: tokens.font.mono,
          backgroundColor: `${color}20`, padding: '1px 4px', borderRadius: 3,
        }}>
          {TYPE_ICONS[data.type] ?? data.type}
        </span>
        <span style={{ fontSize: 9, color: tokens.text.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {data.type}
        </span>

        {statusCfg && (
          <span style={{
            marginLeft: 'auto', fontSize: 8, fontWeight: 700, color: statusCfg.color,
            textTransform: 'uppercase', letterSpacing: '0.5px',
            animation: statusCfg.pulse ? 'pulse 1.5s ease-in-out infinite' : undefined,
          }}>
            {statusCfg.label}
          </span>
        )}
      </div>

      {/* Node name */}
      <div style={{
        padding: '8px 10px 6px',
        fontSize: 12, fontWeight: 600, color: tokens.text.primary,
      }}>
        {data.label}
      </div>

      {/* I/O counts */}
      <div style={{
        padding: '0 10px 6px',
        display: 'flex', gap: 8, fontSize: 9, color: tokens.text.muted,
      }}>
        {data.inputCount > 0 && <span>{data.inputCount} input{data.inputCount > 1 ? 's' : ''}</span>}
        {data.outputCount > 0 && <span>{data.outputCount} output{data.outputCount > 1 ? 's' : ''}</span>}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ backgroundColor: color, width: 8, height: 8, border: `2px solid ${tokens.bg.surface}` }} />
    </div>
  );
}

const nodeTypes: NodeTypes = { custom: CustomNode };

interface Props {
  workflow: WorkflowDefinition;
  stepStatuses: Record<string, string>;
  onAddNode: (type: string, position: { x: number; y: number }) => string;
  onAddEdge: (from: string, to: string) => void;
  onSelectNode: (nodeId: string | null) => void;
}

export function WorkflowCanvas({ workflow, stepStatuses, onAddNode, onAddEdge, onSelectNode }: Props) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const initialNodes: Node[] = useMemo(
    () =>
      workflow.nodes.map((n: WfNode & { _position?: { x: number; y: number } }, i: number) => ({
        id: n.id,
        type: 'custom',
        position: n._position ?? { x: 100 + (i % 3) * 220, y: 80 + Math.floor(i / 3) * 140 },
        data: {
          label: n.name,
          type: n.type,
          status: stepStatuses[n.id],
          outputCount: n.outputs.length,
          inputCount: n.inputs.length,
        },
      })),
    [workflow.nodes, stepStatuses]
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      workflow.edges.map((e, i) => ({
        id: `e-${e.from}-${e.to}-${i}`,
        source: e.from,
        target: e.to,
        animated: !!e.condition,
        label: e.condition ?? undefined,
        style: { stroke: e.condition ? '#f59e0b80' : '#334155', strokeWidth: 2 },
        labelStyle: { fill: '#f59e0b', fontSize: 10, fontWeight: 600, fontFamily: tokens.font.mono },
        labelBgStyle: { fill: tokens.bg.base, fillOpacity: 0.9 },
        labelBgPadding: [4, 4] as [number, number],
        labelBgBorderRadius: 4,
      })),
    [workflow.edges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Re-sync nodes and edges when the workflow definition changes (e.g., loading a template)
  const workflowKey = workflow.id + '/' + workflow.nodes.length + '/' + workflow.edges.length;
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [workflowKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update node status badges during execution
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, status: stepStatuses[n.id] },
      }))
    );
  }, [stepStatuses, setNodes]);

  const onConnect: OnConnect = useCallback(
    (params) => {
      setEdges((eds) => addEdge({ ...params, style: { stroke: '#334155', strokeWidth: 2 } }, eds));
      if (params.source && params.target) {
        onAddEdge(params.source, params.target);
      }
    },
    [setEdges, onAddEdge]
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/workflow-node-type');
      if (!type) return;

      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = {
        x: event.clientX - bounds.left - 75,
        y: event.clientY - bounds.top - 30,
      };

      const newId = onAddNode(type, position);
      setNodes((nds) => [
        ...nds,
        {
          id: newId,
          type: 'custom',
          position,
          data: { label: `${type} ${nds.length + 1}`, type, outputCount: 1, inputCount: 0 },
        },
      ]);
    },
    [onAddNode, setNodes]
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div ref={reactFlowWrapper} style={{ width: '100%', height: '100%' }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={(_e, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        nodeTypes={nodeTypes}
        fitView
        style={{ backgroundColor: tokens.bg.base }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background color="#1a2332" gap={24} size={1} />
        <Controls
          style={{ backgroundColor: tokens.bg.surface, borderColor: tokens.border.subtle, borderRadius: 8 }}
          showInteractive={false}
        />
        <MiniMap
          style={{ backgroundColor: tokens.bg.surface, borderRadius: 8 }}
          nodeColor={(n) => tokens.nodeColors[n.data?.type as string] ?? '#475569'}
          maskColor="rgba(10, 15, 30, 0.8)"
        />
      </ReactFlow>
    </div>
  );
}

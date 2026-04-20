import { useCallback, useRef, useMemo, useEffect, useState, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
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
import type { WorkflowDefinition, WorkflowNode as WfNode, StepResult } from '../api/client';
import { tokens } from './ui/styles';
import { getNodeMetadata } from './nodeMetadata';
import { computeLayout } from './autoLayout';

const STATUS_CONFIG: Record<string, { color: string; label: string; pulse: boolean }> = {
  running: { color: tokens.status.running, label: 'RUNNING', pulse: true },
  completed: { color: tokens.status.completed, label: 'DONE', pulse: false },
  failed: { color: tokens.status.failed, label: 'FAILED', pulse: false },
  skipped: { color: tokens.status.skipped, label: 'SKIP', pulse: false },
  pending: { color: tokens.status.pending, label: 'WAIT', pulse: false },
};

interface NodeData {
  label: string;
  type: string;
  status?: string;
  outputCount: number;
  inputCount: number;
  step?: StepResult;
}

/**
 * Canvas node renderer. Pulls icon/color from the shared nodeMetadata
 * catalog so built-ins and plugin nodes both get their branded styling,
 * then layers execution feedback on top: status label, iteration count
 * (for per-item nodes whose output is `{items: [...]}`), selected branch
 * (for condition nodes), duration (ms) once completed, and a retry
 * counter when attempts > 1.
 */
function CustomNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  const meta = getNodeMetadata(data.type);
  const color = tokens.nodeColors[data.type] ?? meta.color;
  const statusCfg = data.status ? STATUS_CONFIG[data.status] : null;
  const borderColor = statusCfg ? statusCfg.color : selected ? '#60a5fa' : `${color}60`;

  const step = data.step;
  const duration = step?.startedAt && step?.completedAt
    ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
    : null;

  // Iteration badge: per-item nodes emit `{items: [...], count: N}` when
  // the upstream was array-shaped. Show count + a "per-item" cue so users
  // can tell at a glance how many iterations ran.
  const iterCount =
    step?.status === 'completed' &&
    step.outputs &&
    typeof step.outputs === 'object' &&
    Array.isArray((step.outputs as Record<string, unknown>).items)
      ? ((step.outputs as Record<string, unknown>).items as unknown[]).length
      : null;

  const selectedBranch = step?.selectedBranch;
  const retries = step && step.attempts > 1 ? step.attempts : null;

  // Sub-workflow gets a special indicator showing the child execution ran.
  const subExecutionId =
    data.type === 'sub-workflow' && step?.status === 'completed'
      ? (step.outputs as Record<string, unknown>)?.executionId as string | undefined
      : undefined;

  return (
    <div
      style={{
        padding: 0,
        borderRadius: 10,
        border: `2px solid ${borderColor}`,
        backgroundColor: tokens.bg.surface,
        minWidth: 160,
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
          whiteSpace: 'nowrap', maxWidth: 48, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {meta.icon}
        </span>
        <span style={{
          fontSize: 9, color: tokens.text.muted, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.5px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: 110,
        }}>
          {meta.label}
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

      {/* Execution feedback row — visible once the node has run */}
      {(duration !== null || iterCount !== null || selectedBranch || retries || subExecutionId) && (
        <div style={{
          padding: '0 10px 6px',
          display: 'flex', flexWrap: 'wrap', gap: 4,
          alignItems: 'center',
        }}>
          {duration !== null && (
            <Badge
              color={tokens.text.muted}
              label={duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
              hint="Execution duration"
            />
          )}
          {iterCount !== null && (
            <Badge
              color={tokens.status.running}
              label={`${iterCount}×`}
              hint={`Iterated ${iterCount} items`}
            />
          )}
          {selectedBranch && (
            <Badge
              color="#f59e0b"
              label={`→ ${selectedBranch}`}
              hint="Selected branch"
            />
          )}
          {retries && (
            <Badge
              color={tokens.status.paused}
              label={`${retries}× retry`}
              hint={`Succeeded after ${retries} attempts`}
            />
          )}
          {subExecutionId && (
            <Badge
              color="#8b5cf6"
              label="⤴ child"
              hint={`Sub-workflow execution ${subExecutionId.slice(0, 8)}…`}
            />
          )}
        </div>
      )}

      {/* I/O counts shown only when no execution feedback occupies this row */}
      {duration === null && iterCount === null && !selectedBranch && !retries && !subExecutionId && (
        <div style={{
          padding: '0 10px 6px',
          display: 'flex', gap: 8, fontSize: 9, color: tokens.text.muted,
        }}>
          {data.inputCount > 0 && <span>{data.inputCount} input{data.inputCount > 1 ? 's' : ''}</span>}
          {data.outputCount > 0 && <span>{data.outputCount} output{data.outputCount > 1 ? 's' : ''}</span>}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ backgroundColor: color, width: 8, height: 8, border: `2px solid ${tokens.bg.surface}` }} />
    </div>
  );
}

function Badge({ color, label, hint }: { color: string; label: string; hint?: string }) {
  return (
    <span
      title={hint}
      style={{
        fontSize: 9, fontWeight: 700,
        padding: '1px 5px', borderRadius: 3,
        backgroundColor: `${color}20`,
        color,
        fontFamily: tokens.font.mono,
        letterSpacing: 0.3,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

const nodeTypes: NodeTypes = { custom: CustomNode };

interface Props {
  workflow: WorkflowDefinition;
  stepStatuses: Record<string, string>;
  /**
   * Optional full step-result map. When provided, nodes render rich
   * execution feedback on the canvas (duration, iteration count, branch,
   * retry count, sub-workflow link). When absent we fall back to just
   * the status pill from stepStatuses.
   */
  stepResults?: Record<string, StepResult>;
  onAddNode: (type: string, position: { x: number; y: number }) => string;
  onAddEdge: (from: string, to: string) => void;
  onRemoveNode: (nodeId: string) => void;
  onRemoveEdge: (from: string, to: string) => void;
  onUpdateEdgeCondition: (from: string, to: string, condition: string | undefined) => void;
  onSelectNode: (nodeId: string | null) => void;
}

export function WorkflowCanvas({ workflow, stepStatuses, stepResults, onAddNode, onAddEdge, onRemoveNode, onRemoveEdge, onUpdateEdgeCondition, onSelectNode }: Props) {
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
          step: stepResults?.[n.id],
        },
      })),
    [workflow.nodes, stepStatuses, stepResults]
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

  // Update node status + step result during execution.
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          status: stepStatuses[n.id],
          step: stepResults?.[n.id],
        },
      }))
    );
  }, [stepStatuses, stepResults, setNodes]);

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

  // Delete key support — removes selected nodes and edges
  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const n of deleted) onRemoveNode(n.id);
    },
    [onRemoveNode]
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) {
        // Edge IDs are `e-${from}-${to}-${index}` — extract source/target
        onRemoveEdge(e.source, e.target);
      }
    },
    [onRemoveEdge]
  );

  // Edge condition editing — click an edge to open a small inline editor
  const [editingEdge, setEditingEdge] = useState<{
    id: string;
    source: string;
    target: string;
    condition: string;
    x: number;
    y: number;
  } | null>(null);

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const wfEdge = workflow.edges.find((e) => e.from === edge.source && e.to === edge.target);
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;
      setEditingEdge({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        condition: wfEdge?.condition ?? '',
        x: _event.clientX - bounds.left,
        y: _event.clientY - bounds.top,
      });
    },
    [workflow.edges]
  );

  const saveEdgeCondition = useCallback(() => {
    if (!editingEdge) return;
    const cond = editingEdge.condition.trim() || undefined;
    onUpdateEdgeCondition(editingEdge.source, editingEdge.target, cond);
    // Update the local edge state to show the label immediately
    setEdges((eds) =>
      eds.map((e) =>
        e.id === editingEdge.id
          ? {
              ...e,
              label: cond ?? undefined,
              animated: !!cond,
              style: { stroke: cond ? '#f59e0b80' : '#334155', strokeWidth: 2 },
            }
          : e
      )
    );
    setEditingEdge(null);
  }, [editingEdge, onUpdateEdgeCondition, setEdges]);

  return (
    <div ref={reactFlowWrapper} data-tutorial="canvas" style={{ width: '100%', height: '100%' }}>
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
        onPaneClick={() => { onSelectNode(null); setEditingEdge(null); }}
        onEdgeClick={handleEdgeClick}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        deleteKeyCode={['Backspace', 'Delete']}
        nodeTypes={nodeTypes}
        fitView
        style={{ backgroundColor: tokens.bg.base }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background color="#1a2332" gap={24} size={1} />
        <Controls
          style={{ backgroundColor: tokens.bg.surface, borderColor: tokens.border.subtle, borderRadius: 8 }}
          showInteractive={false}
        >
          {/* Auto-layout button — arranges nodes into a topological
              hierarchy. Operates on the local React Flow state so the
              rearrangement is visible immediately and the workflow def
              on disk isn't touched until the user saves. */}
          <ControlButton
            title="Arrange nodes in a hierarchical layout"
            onClick={() => {
              const positions = computeLayout(workflow);
              setNodes((nds) =>
                nds.map((n) => ({
                  ...n,
                  position: positions[n.id] ?? n.position,
                })),
              );
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 800, fontFamily: tokens.font.mono }}>⇲</span>
          </ControlButton>
        </Controls>
        <MiniMap
          style={{ backgroundColor: tokens.bg.surface, borderRadius: 8 }}
          nodeColor={(n) => tokens.nodeColors[n.data?.type as string] ?? '#475569'}
          maskColor="rgba(10, 15, 30, 0.8)"
        />
      </ReactFlow>

      {/* Edge condition editor popover — appears near where the user clicked */}
      {editingEdge && (
        <div
          style={{
            position: 'absolute',
            top: editingEdge.y - 10,
            left: editingEdge.x - 100,
            zIndex: 50,
            padding: 10,
            borderRadius: 8,
            backgroundColor: tokens.bg.surface,
            border: `1px solid ${tokens.border.default}`,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column', gap: 6,
            width: 240,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Edge Condition
          </div>
          <div style={{ fontSize: 9, color: tokens.text.muted }}>
            {editingEdge.source} → {editingEdge.target}
          </div>
          <input
            autoFocus
            style={{
              width: '100%', padding: '6px 8px', fontSize: 11,
              borderRadius: 4, border: `1px solid ${tokens.border.subtle}`,
              backgroundColor: tokens.bg.input, color: tokens.text.primary,
              fontFamily: tokens.font.mono, outline: 'none', boxSizing: 'border-box',
            }}
            value={editingEdge.condition}
            onChange={(e) =>
              setEditingEdge((prev) => prev ? { ...prev, condition: e.target.value } : null)
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveEdgeCondition();
              if (e.key === 'Escape') setEditingEdge(null);
            }}
            placeholder="Branch name (e.g. success, failure, even, odd)"
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={saveEdgeCondition}
              style={{
                flex: 1, padding: '5px 10px', fontSize: 10, fontWeight: 600,
                borderRadius: 4, border: 'none',
                backgroundColor: tokens.border.focus, color: '#fff', cursor: 'pointer',
              }}
            >Save</button>
            {editingEdge.condition && (
              <button
                onClick={() => {
                  setEditingEdge((prev) => prev ? { ...prev, condition: '' } : null);
                  // Immediately save empty = remove condition
                  onUpdateEdgeCondition(editingEdge.source, editingEdge.target, undefined);
                  setEdges((eds) =>
                    eds.map((e) =>
                      e.id === editingEdge.id
                        ? { ...e, label: undefined, animated: false, style: { stroke: '#334155', strokeWidth: 2 } }
                        : e
                    )
                  );
                  setEditingEdge(null);
                }}
                style={{
                  padding: '5px 10px', fontSize: 10, fontWeight: 600,
                  borderRadius: 4, border: `1px solid ${tokens.border.default}`,
                  backgroundColor: 'transparent', color: tokens.text.muted, cursor: 'pointer',
                }}
              >Clear</button>
            )}
            <button
              onClick={() => setEditingEdge(null)}
              style={{
                padding: '5px 10px', fontSize: 10,
                borderRadius: 4, border: `1px solid ${tokens.border.default}`,
                backgroundColor: 'transparent', color: tokens.text.muted, cursor: 'pointer',
              }}
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

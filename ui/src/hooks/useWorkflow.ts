import { useState, useCallback, useRef } from 'react';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '../api/client';

const EMPTY_WORKFLOW: WorkflowDefinition = {
  id: 'new-workflow',
  name: 'New Workflow',
  version: '1.0',
  nodes: [],
  edges: [],
};

export function useWorkflow() {
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(EMPTY_WORKFLOW);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const nextIdRef = useRef(1);

  const selectedNode = workflow.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const loadWorkflow = useCallback((wf: WorkflowDefinition) => {
    setWorkflow(wf);
    setSelectedNodeId(null);
    setDirty(false);
  }, []);

  const addNode = useCallback((type: string, position: { x: number; y: number }) => {
    const id = `${type}-${nextIdRef.current++}`;
    const node: WorkflowNode = {
      id,
      type,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${nextIdRef.current - 1}`,
      inputs: [],
      outputs: type === 'condition' || type === 'decision-routing' ? ['selectedBranch'] : ['result'],
      config: getDefaultConfig(type),
    };
    setWorkflow((prev) => ({ ...prev, nodes: [...prev.nodes, { ...node, _position: position } as any] }));
    setDirty(true);
    setSelectedNodeId(id);
    return id;
  }, []);

  const updateNode = useCallback((nodeId: string, updates: Partial<WorkflowNode>) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, ...updates } : n)),
    }));
    setDirty(true);
  }, []);

  const removeNode = useCallback((nodeId: string) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      edges: prev.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
    }));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    setDirty(true);
  }, [selectedNodeId]);

  const addEdge = useCallback((from: string, to: string, condition?: string) => {
    const edge: WorkflowEdge = { from, to };
    if (condition) edge.condition = condition;
    setWorkflow((prev) => ({ ...prev, edges: [...prev.edges, edge] }));
    setDirty(true);
  }, []);

  const removeEdge = useCallback((from: string, to: string) => {
    setWorkflow((prev) => ({
      ...prev,
      edges: prev.edges.filter((e) => !(e.from === from && e.to === to)),
    }));
    setDirty(true);
  }, []);

  const updateEdgeCondition = useCallback((from: string, to: string, condition: string | undefined) => {
    setWorkflow((prev) => ({
      ...prev,
      edges: prev.edges.map((e) =>
        e.from === from && e.to === to
          ? { ...e, condition }
          : e
      ),
    }));
    setDirty(true);
  }, []);

  const updateParams = useCallback((params: WorkflowDefinition['params']) => {
    setWorkflow((prev) => ({ ...prev, params }));
    setDirty(true);
  }, []);

  const updateTriggers = useCallback((triggers: WorkflowDefinition['triggers']) => {
    // Pass undefined to remove the block entirely — keeps emitted YAML
    // clean when the user disables every trigger kind.
    setWorkflow((prev) => {
      const next = { ...prev } as WorkflowDefinition;
      if (triggers) next.triggers = triggers;
      else delete (next as { triggers?: unknown }).triggers;
      return next;
    });
    setDirty(true);
  }, []);

  const updateContext = useCallback((context: WorkflowDefinition['context']) => {
    setWorkflow((prev) => {
      const next = { ...prev } as WorkflowDefinition;
      if (context) next.context = context;
      else delete (next as { context?: unknown }).context;
      return next;
    });
    setDirty(true);
  }, []);

  return {
    workflow,
    selectedNode,
    selectedNodeId,
    dirty,
    loadWorkflow,
    setWorkflow,
    addNode,
    updateNode,
    removeNode,
    addEdge,
    removeEdge,
    updateEdgeCondition,
    updateParams,
    updateTriggers,
    updateContext,
    setSelectedNodeId,
    setDirty,
  };
}

function getDefaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    case 'transform': return { expression: '({ result: inputs.x })' };
    case 'condition': return { expression: "inputs.x > 0 ? 'yes' : 'no'" };
    case 'http': return { url: 'https://api.example.com', method: 'GET' };
    case 'script': return { code: 'result = { value: 42 }' };
    case 'llm-prompt': return { promptTemplate: 'Summarize: {{text}}', responseFormat: 'text' };
    case 'agent-tool-use': return { systemPrompt: 'You are a helpful assistant.', taskTemplate: '{{task}}', tools: [] };
    case 'decision-routing': return { promptTemplate: 'Decide: {{data}}', branches: {} };
    case 'code-generation': return { promptTemplate: 'Generate code: {{spec}}', language: 'javascript', execute: false };
    default: return {};
  }
}

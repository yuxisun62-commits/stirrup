import { useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useWorkflow } from './hooks/useWorkflow';
import { useExecution } from './hooks/useExecution';
import { WorkflowList } from './components/WorkflowList';
import { NodePalette } from './components/NodePalette';
import { WorkflowCanvas } from './components/WorkflowCanvas';
import { NodeInspector } from './components/NodeInspector';
import { ExecutionPanel } from './components/ExecutionPanel';
import { TemplateBrowser } from './components/TemplateBrowser';
import { saveWorkflow, createWorkflow, type WorkflowDefinition } from './api/client';
import { RunDialog } from './components/RunDialog';
import { GenerateDialog } from './components/GenerateDialog';
import { tokens } from './components/ui/styles';

function App() {
  const {
    workflow,
    selectedNode,
    dirty,
    loadWorkflow,
    addNode,
    updateNode,
    removeNode,
    addEdge,
    setSelectedNodeId,
    setDirty,
  } = useWorkflow();

  const { execution, events, isRunning, run, clear } = useExecution();
  const [showTemplates, setShowTemplates] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);

  const stepStatuses = useMemo(() => {
    if (!execution) return {};
    const statuses: Record<string, string> = {};
    for (const [nodeId, step] of Object.entries(execution.steps)) {
      statuses[nodeId] = step.status;
    }
    return statuses;
  }, [execution]);

  const handleSave = async () => {
    try {
      await saveWorkflow(workflow);
      setDirty(false);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleNew = () => {
    loadWorkflow({
      id: `workflow-${Date.now()}`,
      name: 'New Workflow',
      version: '1.0',
      nodes: [],
      edges: [],
    });
  };

  const handleRunClick = () => {
    // If workflow has params, show dialog; otherwise run directly
    if (workflow.params && workflow.params.length > 0) {
      setShowRunDialog(true);
    } else {
      handleRun({});
    }
  };

  const handleRun = async (params: Record<string, unknown>) => {
    setShowRunDialog(false);
    try {
      // Ensure workflow is saved to the server before executing
      try {
        await createWorkflow(workflow);
      } catch {
        // If create fails (already exists), try save/update
        await saveWorkflow(workflow);
      }
      setDirty(false);
      await run(workflow.id, params);
    } catch (err) {
      alert(`Run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <ReactFlowProvider>
      <div style={{
        display: 'flex', height: '100vh',
        backgroundColor: tokens.bg.base, color: tokens.text.primary,
        fontFamily: tokens.font.sans,
      }}>
        {/* Left sidebar */}
        <div style={{
          width: 230, borderRight: `1px solid ${tokens.border.subtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          backgroundColor: tokens.bg.surface,
        }}>
          {/* Brand */}
          <div style={{
            padding: '10px 12px', borderBottom: `1px solid ${tokens.border.subtle}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: 6,
              background: `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}, ${tokens.nodeColors.transform})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 800, color: '#fff',
            }}>
              S
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text.primary, lineHeight: 1 }}>Stirrup</div>
              <div style={{ fontSize: 9, color: tokens.text.muted }}>AI Workflow Engine</div>
            </div>
          </div>

          {/* Create buttons */}
          <div style={{ padding: '6px 12px', borderBottom: `1px solid ${tokens.border.subtle}`, display: 'flex', gap: 6 }}>
            <button
              onClick={() => setShowGenerate(true)}
              style={{
                flex: 1, padding: '7px 8px', fontSize: 11, fontWeight: 600,
                borderRadius: 6, border: `1px solid ${tokens.nodeColors['llm-prompt']}40`,
                background: `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}15, ${tokens.nodeColors['decision-routing']}10)`,
                color: tokens.nodeColors['llm-prompt'],
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            >
              <span style={{ fontSize: 11, fontWeight: 800 }}>AI</span>
              Generate
            </button>
            <button
              onClick={() => setShowTemplates(true)}
              style={{
                flex: 1, padding: '7px 8px', fontSize: 11, fontWeight: 600,
                borderRadius: 6, border: `1px dashed ${tokens.border.default}`,
                backgroundColor: 'transparent', color: tokens.text.secondary,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = tokens.border.focus; (e.currentTarget as HTMLElement).style.color = tokens.text.accent; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = tokens.border.default; (e.currentTarget as HTMLElement).style.color = tokens.text.secondary; }}
            >
              <span style={{ fontSize: 14 }}>+</span>
              Templates
            </button>
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            <WorkflowList
              currentId={workflow.id}
              onSelect={(wf: WorkflowDefinition) => loadWorkflow(wf)}
              onNew={handleNew}
            />
            <NodePalette />
          </div>
        </div>

        {/* Main area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{
            padding: '6px 14px',
            borderBottom: `1px solid ${tokens.border.subtle}`,
            display: 'flex', alignItems: 'center', gap: 10,
            backgroundColor: tokens.bg.surface,
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: tokens.text.primary }}>{workflow.name}</span>
            <span style={{ fontSize: 10, color: tokens.text.muted, fontFamily: tokens.font.mono }}>{workflow.id}</span>
            {dirty && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: tokens.status.paused,
                backgroundColor: `${tokens.status.paused}15`,
                padding: '1px 6px', borderRadius: 3,
              }}>
                UNSAVED
              </span>
            )}
            <span style={{ fontSize: 10, color: tokens.text.muted }}>
              {workflow.nodes.length} nodes / {workflow.edges.length} edges
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={handleSave}
              disabled={!dirty}
              style={{
                padding: '5px 14px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                border: 'none',
                backgroundColor: dirty ? tokens.border.focus : tokens.border.default,
                color: '#fff', cursor: dirty ? 'pointer' : 'default',
                fontFamily: tokens.font.sans, transition: 'background-color 0.15s',
              }}
            >
              Save
            </button>
          </div>

          {/* Canvas */}
          <div style={{ flex: 1, position: 'relative' }}>
            <WorkflowCanvas
              workflow={workflow}
              stepStatuses={stepStatuses}
              onAddNode={addNode}
              onAddEdge={addEdge}
              onSelectNode={setSelectedNodeId}
            />
          </div>

          {/* Execution panel */}
          <ExecutionPanel
            execution={execution}
            events={events}
            isRunning={isRunning}
            onRun={handleRunClick}
            onClear={clear}
          />
        </div>

        {/* Right inspector */}
        {selectedNode && (
          <div style={{ width: 300, overflow: 'hidden' }}>
            <NodeInspector
              node={selectedNode}
              stepResult={execution?.steps[selectedNode.id]}
              onUpdate={updateNode}
              onDelete={removeNode}
            />
          </div>
        )}

        {/* Run dialog */}
        {showRunDialog && (
          <RunDialog
            params={(workflow.params as any[]) ?? []}
            workflowName={workflow.name}
            onRun={handleRun}
            onClose={() => setShowRunDialog(false)}
          />
        )}

        {/* Template browser modal */}
        {showTemplates && (
          <TemplateBrowser
            onSelect={(wf) => { loadWorkflow(wf); setShowTemplates(false); }}
            onClose={() => setShowTemplates(false)}
          />
        )}

        {/* AI Generate dialog */}
        {showGenerate && (
          <GenerateDialog
            onGenerated={(wf) => { loadWorkflow(wf); setShowGenerate(false); }}
            onClose={() => setShowGenerate(false)}
          />
        )}
      </div>
    </ReactFlowProvider>
  );
}

export default App;

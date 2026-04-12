import { useMemo, useState, useEffect } from 'react';
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
import { PluginPanel } from './components/PluginPanel';
import { ValidationPanel } from './components/ValidationPanel';
import { DeployPanel } from './components/DeployPanel';
import { ExportDialog } from './components/ExportDialog';
import { AuthPanel } from './components/AuthPanel';
import { DebugPanel } from './components/DebugPanel';
import { tokens } from './components/ui/styles';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

function App() {
  const {
    workflow, selectedNode, dirty, loadWorkflow, addNode, updateNode,
    removeNode, addEdge, setSelectedNodeId, setDirty,
  } = useWorkflow();

  const { execution, events, isRunning, run, clear } = useExecution();
  const [showTemplates, setShowTemplates] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  // Close sidebar on mobile when selecting a workflow
  const handleSelectWorkflow = (wf: WorkflowDefinition) => {
    loadWorkflow(wf);
    if (isMobile) setSidebarOpen(false);
  };

  const stepStatuses = useMemo(() => {
    // Guard against the async execute route's "early" response which only
    // contains { executionId, status: 'running' } before the full state has
    // been persisted — execution.steps is undefined at that point and
    // Object.entries() would throw.
    if (!execution || !execution.steps) return {};
    const statuses: Record<string, string> = {};
    for (const [nodeId, step] of Object.entries(execution.steps)) {
      statuses[nodeId] = step.status;
    }
    return statuses;
  }, [execution]);

  const handleSave = async () => {
    try { await saveWorkflow(workflow); setDirty(false); }
    catch (err) { alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const handleNew = () => {
    loadWorkflow({ id: `workflow-${Date.now()}`, name: 'New Workflow', version: '1.0', nodes: [], edges: [] });
    if (isMobile) setSidebarOpen(false);
  };

  const handleRunClick = () => {
    // Always show the dialog. Even for workflows without declared params,
    // the user benefits from a confirm step — and this avoids a whole class
    // of bug where `workflow.params` is undefined/empty due to save/load
    // round-trips, AI-generated workflows omitting the field, or upstream
    // template loading stripping it. The dialog handles the empty-params
    // case gracefully with a "No parameters declared" message and a single
    // Run button.
    setShowRunDialog(true);
  };

  const handleRun = async (params: Record<string, unknown>) => {
    setShowRunDialog(false);
    try {
      try { await createWorkflow(workflow); } catch { await saveWorkflow(workflow); }
      setDirty(false);
      await run(workflow.id, params);
    } catch (err) { alert(`Run failed: ${err instanceof Error ? err.message : String(err)}`); }
  };

  // ─── Sidebar content (shared between desktop and mobile drawer) ───
  const sidebarContent = (
    <>
      {/* Brand */}
      <div style={{
        padding: '10px 12px', borderBottom: `1px solid ${tokens.border.subtle}`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <img src="/favicon.svg" alt="Stirrup" style={{ width: 24, height: 24 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text.primary, lineHeight: 1 }}>Stirrup</div>
          <div style={{ fontSize: 9, color: tokens.text.muted }}>AI Workflow Engine</div>
        </div>
        {isMobile && (
          <button onClick={() => setSidebarOpen(false)} style={{
            background: 'none', border: 'none', color: tokens.text.muted, fontSize: 20, cursor: 'pointer',
          }}>x</button>
        )}
      </div>

      {/* Create buttons */}
      <div style={{ padding: '6px 12px', borderBottom: `1px solid ${tokens.border.subtle}`, display: 'flex', gap: 6 }}>
        <button onClick={() => { setShowGenerate(true); if (isMobile) setSidebarOpen(false); }} style={{
          flex: 1, padding: '7px 8px', fontSize: 11, fontWeight: 600, borderRadius: 6,
          border: `1px solid ${tokens.nodeColors['llm-prompt']}40`,
          background: `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}15, ${tokens.nodeColors['decision-routing']}10)`,
          color: tokens.nodeColors['llm-prompt'], cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ fontSize: 11, fontWeight: 800 }}>AI</span> Generate
        </button>
        <button onClick={() => { setShowTemplates(true); if (isMobile) setSidebarOpen(false); }} style={{
          flex: 1, padding: '7px 8px', fontSize: 11, fontWeight: 600, borderRadius: 6,
          border: `1px dashed ${tokens.border.default}`, backgroundColor: 'transparent',
          color: tokens.text.secondary, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ fontSize: 14 }}>+</span> Templates
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <WorkflowList currentId={workflow.id} onSelect={handleSelectWorkflow} onNew={handleNew} />
        <NodePalette />
      </div>
    </>
  );

  return (
    <ReactFlowProvider>
      <div style={{
        display: 'flex', height: '100vh',
        backgroundColor: tokens.bg.base, color: tokens.text.primary,
        fontFamily: tokens.font.sans,
      }}>
        {/* ── Desktop sidebar ── */}
        {!isMobile && (
          <div style={{
            width: 230, borderRight: `1px solid ${tokens.border.subtle}`,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            backgroundColor: tokens.bg.surface,
          }}>
            {sidebarContent}
          </div>
        )}

        {/* ── Mobile sidebar drawer ── */}
        {isMobile && sidebarOpen && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 900 }}
              onClick={() => setSidebarOpen(false)}
            />
            <div style={{
              position: 'fixed', top: 0, left: 0, bottom: 0, width: 280, zIndex: 901,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              backgroundColor: tokens.bg.surface,
              boxShadow: '4px 0 20px rgba(0,0,0,0.4)',
            }}>
              {sidebarContent}
            </div>
          </>
        )}

        {/* ── Main area ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{
            padding: isMobile ? '6px 8px' : '6px 14px',
            borderBottom: `1px solid ${tokens.border.subtle}`,
            display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10,
            backgroundColor: tokens.bg.surface,
          }}>
            {/* Mobile hamburger */}
            {isMobile && (
              <button onClick={() => setSidebarOpen(true)} style={{
                padding: '4px 6px', fontSize: 16, background: 'none',
                border: `1px solid ${tokens.border.default}`, borderRadius: 4,
                color: tokens.text.secondary, cursor: 'pointer',
              }}>
                ☰
              </button>
            )}
            <span style={{
              fontSize: isMobile ? 12 : 14, fontWeight: 700, color: tokens.text.primary,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{workflow.name}</span>
            {!isMobile && (
              <span style={{ fontSize: 10, color: tokens.text.muted, fontFamily: tokens.font.mono }}>{workflow.id}</span>
            )}
            {dirty && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: tokens.status.paused,
                backgroundColor: `${tokens.status.paused}15`, padding: '1px 6px', borderRadius: 3,
              }}>UNSAVED</span>
            )}
            {!isMobile && (
              <span style={{ fontSize: 10, color: tokens.text.muted }}>
                {workflow.nodes.length} nodes / {workflow.edges.length} edges
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => setShowAuth(true)} style={{
              padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
              border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
              color: tokens.text.muted, cursor: 'pointer',
            }}>Connections</button>
            {!isMobile && (
              <button onClick={() => setShowPlugins(true)} style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                color: tokens.text.muted, cursor: 'pointer',
              }}>Plugins</button>
            )}
            <button
              onClick={() => setShowExport(true)}
              disabled={workflow.nodes.length === 0}
              style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                color: workflow.nodes.length === 0 ? tokens.border.default : tokens.text.muted,
                cursor: workflow.nodes.length === 0 ? 'default' : 'pointer',
              }}
            >Export</button>
            <button onClick={handleSave} disabled={!dirty} style={{
              padding: '5px 14px', fontSize: 11, fontWeight: 600, borderRadius: 5, border: 'none',
              backgroundColor: dirty ? tokens.border.focus : tokens.border.default,
              color: '#fff', cursor: dirty ? 'pointer' : 'default',
            }}>Save</button>
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

          <ValidationPanel workflow={workflow} onFixed={(wf) => loadWorkflow(wf)} onSelectNode={setSelectedNodeId} />
          <ExecutionPanel
            execution={execution}
            events={events}
            isRunning={isRunning}
            totalNodes={workflow.nodes.length}
            onRun={handleRunClick}
            onClear={clear}
            onDeploy={execution?.status === 'completed' ? () => setShowDeploy(true) : undefined}
            onSelectNode={setSelectedNodeId}
          />
        </div>

        {/* ── Right inspector (desktop: side panel, mobile: bottom sheet) ── */}
        {selectedNode && !isMobile && (
          <div style={{ width: 300, overflow: 'hidden' }}>
            <NodeInspector
              node={selectedNode}
              stepResult={execution?.steps[selectedNode.id]}
              onUpdate={updateNode}
              onDelete={removeNode}
              onDebug={execution ? () => setShowDebug(true) : undefined}
            />
          </div>
        )}
        {selectedNode && isMobile && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 800 }}
              onClick={() => setSelectedNodeId(null)}
            />
            <div style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, maxHeight: '70vh', zIndex: 801,
              borderTopLeftRadius: 16, borderTopRightRadius: 16,
              overflow: 'hidden', backgroundColor: tokens.bg.surface,
              boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
            }}>
              {/* Drag handle */}
              <div style={{
                display: 'flex', justifyContent: 'center', padding: '8px 0 4px',
                borderBottom: `1px solid ${tokens.border.subtle}`,
              }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: tokens.border.default }} />
              </div>
              <div style={{ maxHeight: 'calc(70vh - 20px)', overflow: 'auto' }}>
                <NodeInspector
                  node={selectedNode}
                  stepResult={execution?.steps[selectedNode.id]}
                  onUpdate={updateNode}
                  onDelete={removeNode}
                  onDebug={execution ? () => setShowDebug(true) : undefined}
                />
              </div>
            </div>
          </>
        )}

        {/* ── Modals ── */}
        {showRunDialog && (
          <RunDialog
            params={(workflow.params as any[]) ?? []}
            workflowId={workflow.id}
            workflowName={workflow.name}
            onRun={handleRun}
            onClose={() => setShowRunDialog(false)}
          />
        )}
        {showTemplates && (
          <TemplateBrowser onSelect={(wf) => { loadWorkflow(wf); setShowTemplates(false); }} onClose={() => setShowTemplates(false)} />
        )}
        {showGenerate && (
          <GenerateDialog onGenerated={(wf) => { loadWorkflow(wf); setShowGenerate(false); }} onClose={() => setShowGenerate(false)} />
        )}
        {showPlugins && <PluginPanel onClose={() => setShowPlugins(false)} />}
        {showDeploy && <DeployPanel workflow={workflow} onClose={() => setShowDeploy(false)} />}
        {showExport && (
          <ExportDialog
            workflow={workflow}
            onClose={() => setShowExport(false)}
            onDeploy={() => setShowDeploy(true)}
          />
        )}
        {showAuth && <AuthPanel onClose={() => setShowAuth(false)} />}
        {showDebug && selectedNode && execution && (
          <DebugPanel
            executionId={execution.executionId}
            node={selectedNode}
            onClose={() => setShowDebug(false)}
            onRetrySuccess={() => { /* Optional: refresh execution state */ }}
            onApplyEdit={updateNode}
          />
        )}
      </div>
    </ReactFlowProvider>
  );
}

export default App;

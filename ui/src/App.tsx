import { useMemo, useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useWorkflow } from './hooks/useWorkflow';
import { useExecution } from './hooks/useExecution';
import { WorkflowList } from './components/WorkflowList';
import { NodePalette } from './components/NodePalette';
import { WorkflowCanvas } from './components/WorkflowCanvas';
import { NodeInspector } from './components/NodeInspector';
import { ExecutionPanel } from './components/ExecutionPanel';
import { ValidationPanel } from './components/ValidationPanel';
import { saveWorkflow, createWorkflow, type WorkflowDefinition } from './api/client';
import { tokens } from './components/ui/styles';
import { MenuIcon } from './components/ui/icons';
import { useTutorial } from './components/tutorial/useTutorial';

// Lazy-load every modal/dialog panel. Each lands in its own vite chunk and
// is only fetched when the user actually opens it. This drops the initial
// bundle by ~200kB since none of these are visible on first paint.
// Named exports → the `.then(m => ({ default: m.X }))` adapter is required
// because React.lazy expects a module with a default export.
const TemplateBrowser = lazy(() =>
  import('./components/TemplateBrowser').then((m) => ({ default: m.TemplateBrowser })),
);
const RunDialog = lazy(() =>
  import('./components/RunDialog').then((m) => ({ default: m.RunDialog })),
);
const GenerateDialog = lazy(() =>
  import('./components/GenerateDialog').then((m) => ({ default: m.GenerateDialog })),
);
const PluginPanel = lazy(() =>
  import('./components/PluginPanel').then((m) => ({ default: m.PluginPanel })),
);
const DeployPanel = lazy(() =>
  import('./components/DeployPanel').then((m) => ({ default: m.DeployPanel })),
);
const ExportDialog = lazy(() =>
  import('./components/ExportDialog').then((m) => ({ default: m.ExportDialog })),
);
const AuthPanel = lazy(() =>
  import('./components/AuthPanel').then((m) => ({ default: m.AuthPanel })),
);
const DebugPanel = lazy(() =>
  import('./components/DebugPanel').then((m) => ({ default: m.DebugPanel })),
);
const WorkflowParamsEditor = lazy(() =>
  import('./components/WorkflowParamsEditor').then((m) => ({ default: m.WorkflowParamsEditor })),
);
const TutorialWizard = lazy(() =>
  import('./components/tutorial/TutorialWizard').then((m) => ({ default: m.TutorialWizard })),
);
const TriggersPanel = lazy(() =>
  import('./components/TriggersPanel').then((m) => ({ default: m.TriggersPanel })),
);
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const TriggerConfigEditor = lazy(() =>
  import('./components/TriggerConfigEditor').then((m) => ({ default: m.TriggerConfigEditor })),
);
const ContextEditor = lazy(() =>
  import('./components/ContextEditor').then((m) => ({ default: m.ContextEditor })),
);

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
    removeNode, addEdge, removeEdge, updateEdgeCondition, updateParams,
    updateTriggers, updateContext, setSelectedNodeId, setDirty,
  } = useWorkflow();
  const [showParams, setShowParams] = useState(false);
  const tutorial = useTutorial();

  const { execution, events, isRunning, run, resume, restore, clear } = useExecution();
  const [showTemplates, setShowTemplates] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showTriggers, setShowTriggers] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showTriggerConfig, setShowTriggerConfig] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [invalidNodeIds, setInvalidNodeIds] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Global keyboard shortcuts. All of them are gated so that typing
  // inside a text input or textarea falls through to normal editing —
  // otherwise ⌘S on a prompt textarea would jump to save-workflow
  // mid-sentence, which is maddening.
  //
  // Shortcut map:
  //   ⌘K / Ctrl-K    — command palette
  //   ⌘S / Ctrl-S    — save workflow
  //   ⌘⏎ / Ctrl-⏎    — run workflow
  //   ⌘. / Ctrl-.    — toggle zen mode (hide sidebar + inspector for
  //                     maximum canvas real estate)
  // Refs hold the latest handler references so the useEffect's keydown
  // listener (installed once) always calls current closures. Without
  // refs we'd either re-install the listener on every render or chase
  // a stale handleSave that predates subsequent edits.
  const handlersRef = useRef<{ save: () => void; run: () => void } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inInput = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (!(e.metaKey || e.ctrlKey)) return;

      if (e.key.toLowerCase() === 'k') {
        if (inInput) return;
        e.preventDefault();
        setShowPalette(true);
        return;
      }
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        handlersRef.current?.save();
        return;
      }
      if (e.key === 'Enter') {
        if (inInput) return;
        e.preventDefault();
        handlersRef.current?.run();
        return;
      }
      if (e.key === '.') {
        if (inInput) return;
        e.preventDefault();
        setZenMode((z) => !z);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const isMobile = useIsMobile();

  // Restore the most recent execution when the workflow changes (e.g. after
  // page reload). This lets the user see the failed/completed state and hit
  // Resume without losing context.
  useEffect(() => {
    if (workflow.id && !execution) {
      restore(workflow.id);
    }
  }, [workflow.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Tutorial step change handler — opens/closes the relevant panel so the
  // user sees the REAL UI during each tutorial step, not a mockup.
  const handleTutorialStepChange = useCallback((stepId: string) => {
    // Close any panel a previous tutorial step opened
    setShowTemplates(false);
    setShowGenerate(false);
    setShowAuth(false);
    setShowParams(false);
    setShowExport(false);
    setShowPlugins(false);

    // Open the panel for the current step
    const STEP_TO_PANEL: Record<string, () => void> = {
      templates: () => setShowTemplates(true),
      'ai-generate': () => setShowGenerate(true),
      connections: () => setShowAuth(true),
      'params-button': () => setShowParams(true),
      export: () => setShowExport(true),
    };
    STEP_TO_PANEL[stepId]?.();
  }, []);

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

  // Keep the ref pointing at the current handler every render so the
  // global keydown listener calls the latest closures.
  handlersRef.current = { save: handleSave, run: handleRunClick };

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
        <button data-tutorial="ai-generate" onClick={() => { setShowGenerate(true); if (isMobile) setSidebarOpen(false); }} style={{
          flex: 1, padding: '7px 8px', fontSize: 11, fontWeight: 600, borderRadius: 6,
          border: `1px solid ${tokens.nodeColors['llm-prompt']}40`,
          background: `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}15, ${tokens.nodeColors['decision-routing']}10)`,
          color: tokens.nodeColors['llm-prompt'], cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ fontSize: 11, fontWeight: 800 }}>AI</span> Generate
        </button>
        <button data-tutorial="templates" onClick={() => { setShowTemplates(true); if (isMobile) setSidebarOpen(false); }} style={{
          flex: 1, padding: '7px 8px', fontSize: 11, fontWeight: 600, borderRadius: 6,
          border: `1px dashed ${tokens.border.default}`, backgroundColor: 'transparent',
          color: tokens.text.secondary, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ fontSize: 14 }}>+</span> Templates
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <WorkflowList currentId={workflow.id} onSelect={handleSelectWorkflow} onNew={handleNew} onDeleted={handleNew} />
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
        {/* ── Desktop sidebar (hidden in zen mode for focused canvas work) ── */}
        {!isMobile && !zenMode && (
          <div data-tutorial="sidebar" style={{
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
          {/* Toolbar — wraps on narrow viewports so crowded headers stack
              gracefully instead of clipping. Gap shrinks on mobile to keep
              two rows of buttons tappable without extra scroll. */}
          <div style={{
            padding: isMobile ? '6px 8px' : '6px 14px',
            borderBottom: `1px solid ${tokens.border.subtle}`,
            display: 'flex', alignItems: 'center', gap: isMobile ? 5 : 10,
            backgroundColor: tokens.bg.surface,
            flexWrap: isMobile ? 'wrap' : 'nowrap',
            rowGap: isMobile ? 6 : undefined,
          }}>
            {/* Mobile hamburger */}
            {isMobile && (
              <button
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
                style={{
                  padding: '6px 8px', background: 'none',
                  border: `1px solid ${tokens.border.default}`, borderRadius: 4,
                  color: tokens.text.secondary, cursor: 'pointer',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <MenuIcon size={16} />
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
            {zenMode && (
              <button
                onClick={() => setZenMode(false)}
                title="Exit zen mode (⌘.)"
                style={{
                  fontSize: 9, fontWeight: 700, color: tokens.text.accent,
                  backgroundColor: `${tokens.text.accent}15`, padding: '1px 6px', borderRadius: 3,
                  border: 'none', cursor: 'pointer', letterSpacing: 0.5,
                }}
              >ZEN · ⌘.</button>
            )}
            {!isMobile && (
              <span style={{ fontSize: 10, color: tokens.text.muted }}>
                {workflow.nodes.length} nodes / {workflow.edges.length} edges
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button data-tutorial="params-button" onClick={() => setShowParams(true)} style={{
              padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
              border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
              color: (workflow.params?.length ?? 0) > 0 ? tokens.text.accent : tokens.text.muted,
              cursor: 'pointer',
            }}>Params {(workflow.params?.length ?? 0) > 0 ? `(${workflow.params!.length})` : ''}</button>
            <button
              onClick={() => setShowContext(true)}
              title="Declare default context values every node can read"
              style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                color: workflow.context && Object.keys(workflow.context).length > 0
                  ? tokens.text.accent
                  : tokens.text.muted,
                cursor: 'pointer',
              }}
            >
              Context{workflow.context && Object.keys(workflow.context).length > 0
                ? ` (${Object.keys(workflow.context).length})` : ''}
            </button>
            <button data-tutorial="connections-button" onClick={() => setShowAuth(true)} style={{
              padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
              border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
              color: tokens.text.muted, cursor: 'pointer',
            }}>Connections</button>
            <button
              onClick={() => setShowTriggerConfig(true)}
              title="Configure how this workflow fires (HTTP, webhook, cron, Telegram)"
              style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                color: workflow.triggers && Object.keys(workflow.triggers).length > 0
                  ? tokens.text.accent
                  : tokens.text.muted,
                cursor: 'pointer',
              }}
            >
              Triggers{workflow.triggers && Object.keys(workflow.triggers).length > 0
                ? ` (${Object.keys(workflow.triggers).length})`
                : ''}
            </button>
            <button onClick={() => setShowTriggers(true)} style={{
              padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
              border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
              color: tokens.text.muted, cursor: 'pointer',
            }} title="Live runtime status of every trigger">Live</button>
            {!isMobile && (
              <button onClick={() => setShowPlugins(true)} style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                color: tokens.text.muted, cursor: 'pointer',
              }}>Plugins</button>
            )}
            <button
              data-tutorial="export-button"
              onClick={() => setShowExport(true)}
              disabled={workflow.nodes.length === 0}
              style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                color: workflow.nodes.length === 0 ? tokens.border.default : tokens.text.muted,
                cursor: workflow.nodes.length === 0 ? 'default' : 'pointer',
              }}
            >Export</button>
            <button data-tutorial="save-button" onClick={handleSave} disabled={!dirty} style={{
              padding: '5px 14px', fontSize: 11, fontWeight: 600, borderRadius: 5, border: 'none',
              backgroundColor: dirty ? tokens.border.focus : tokens.border.default,
              color: '#fff', cursor: dirty ? 'pointer' : 'default',
            }}>Save</button>
            <button
              onClick={tutorial.startTutorial}
              title="Start tutorial"
              style={{
                padding: '4px 8px', fontSize: 12, fontWeight: 700, borderRadius: 5,
                border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                color: tokens.text.muted, cursor: 'pointer', lineHeight: 1,
              }}
            >?</button>
          </div>

          {/* Canvas */}
          <div style={{ flex: 1, position: 'relative' }}>
            <WorkflowCanvas
              workflow={workflow}
              stepStatuses={stepStatuses}
              stepResults={execution?.steps}
              invalidNodeIds={invalidNodeIds}
              selectedNodeId={selectedNode?.id ?? null}
              onAddNode={addNode}
              onAddEdge={addEdge}
              onRemoveNode={removeNode}
              onRemoveEdge={removeEdge}
              onUpdateEdgeCondition={updateEdgeCondition}
              onSelectNode={setSelectedNodeId}
            />
          </div>

          <ValidationPanel
            workflow={workflow}
            onFixed={(wf) => loadWorkflow(wf)}
            onSelectNode={setSelectedNodeId}
            onInvalidNodesChange={setInvalidNodeIds}
          />
          <ExecutionPanel
            execution={execution}
            events={events}
            isRunning={isRunning}
            totalNodes={workflow.nodes.length}
            onRun={handleRunClick}
            onResume={execution?.executionId ? () => {
              resume(execution.executionId).catch((err) =>
                alert(`Resume failed: ${err instanceof Error ? err.message : String(err)}`)
              );
            } : undefined}
            onClear={clear}
            onDeploy={execution?.status === 'completed' ? () => setShowDeploy(true) : undefined}
            onSelectNode={setSelectedNodeId}
          />
        </div>

        {/* ── Right inspector (desktop: side panel, mobile: bottom sheet) ──
            Hidden in zen mode unless the user has an explicit selection
            — selecting a node still swings the inspector in so quick
            edits don't require a full zen-toggle round-trip. */}
        {selectedNode && !isMobile && !zenMode && (
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

        {/* ── Modals (lazy-loaded) ──
            Each modal lives in its own chunk and is fetched on first open.
            Single <Suspense> wraps all of them since at most one is ever
            visible at a time — fallback={null} because the modals are
            fixed-position overlays and any intermediate spinner would be
            jarring over the canvas. The dynamic import round-trip is
            typically <100ms on a warm connection. */}
        <Suspense fallback={null}>
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
          {showTriggers && <TriggersPanel onClose={() => setShowTriggers(false)} />}
          {showTriggerConfig && (
            <TriggerConfigEditor
              triggers={workflow.triggers}
              onChange={updateTriggers}
              onClose={() => setShowTriggerConfig(false)}
            />
          )}
          {showContext && (
            <ContextEditor
              context={workflow.context}
              onChange={updateContext}
              onClose={() => setShowContext(false)}
            />
          )}
          {showPalette && (
            <CommandPalette
              open={showPalette}
              onClose={() => setShowPalette(false)}
              onSelectWorkflow={(wf) => handleSelectWorkflow(wf)}
              onAddNode={(type) => addNode(type, { x: 400, y: 200 })}
              actions={[
                { id: 'run', label: 'Run workflow', hint: 'Execute this workflow now', keywords: ['execute', 'start'],
                  run: () => handleRunClick() },
                { id: 'save', label: 'Save workflow', hint: 'Persist current edits to disk', keywords: ['persist'],
                  run: () => handleSave() },
                { id: 'new', label: 'New workflow', hint: 'Create a blank workflow', keywords: ['create'],
                  run: () => handleNew() },
                { id: 'templates', label: 'Browse templates', hint: 'Open the template / import browser', keywords: ['import', 'n8n', 'make'],
                  run: () => setShowTemplates(true) },
                { id: 'generate', label: 'AI Generate workflow', hint: 'Describe a workflow and let Claude build it', keywords: ['ai', 'describe'],
                  run: () => setShowGenerate(true) },
                { id: 'connections', label: 'Connections', hint: 'Manage service credentials', keywords: ['auth', 'tokens', 'services'],
                  run: () => setShowAuth(true) },
                { id: 'triggers-config', label: 'Configure triggers', hint: 'Set HTTP / webhook / cron / Telegram for this workflow', keywords: ['trigger', 'cron', 'webhook'],
                  run: () => setShowTriggerConfig(true) },
                { id: 'triggers-live', label: 'Live trigger status', hint: 'Runtime fire counts across all workflows', keywords: ['status'],
                  run: () => setShowTriggers(true) },
                { id: 'plugins', label: 'Plugins', hint: 'Available integrations + load state', keywords: ['integrations'],
                  run: () => setShowPlugins(true) },
                { id: 'params', label: 'Workflow params', hint: 'Declare runtime parameters', keywords: ['inputs'],
                  run: () => setShowParams(true) },
                { id: 'context', label: 'Workflow context', hint: 'Default shared state values every node can read', keywords: ['defaults', 'state'],
                  run: () => setShowContext(true) },
                { id: 'zen', label: zenMode ? 'Exit zen mode' : 'Enter zen mode', hint: 'Hide sidebar + inspector to maximize the canvas (⌘.)', keywords: ['fullscreen', 'focus'],
                  run: () => setZenMode((z) => !z) },
                { id: 'export', label: 'Export workflow', hint: 'Build a deployable package', keywords: ['deploy', 'bundle'],
                  run: () => setShowExport(true) },
              ]}
            />
          )}
          {showParams && (
            <WorkflowParamsEditor
              params={(workflow.params ?? []) as any[]}
              onChange={updateParams}
              onClose={() => setShowParams(false)}
            />
          )}
          {showDebug && selectedNode && execution && (
            <DebugPanel
              executionId={execution.executionId}
              node={selectedNode}
              onClose={() => setShowDebug(false)}
              onRetrySuccess={() => { /* Optional: refresh execution state */ }}
              onApplyEdit={updateNode}
            />
          )}
          {tutorial.isActive && (
            <TutorialWizard
              step={tutorial.step}
              currentStep={tutorial.currentStep}
              totalSteps={tutorial.totalSteps}
              isFirst={tutorial.isFirst}
              isLast={tutorial.isLast}
              onNext={tutorial.nextStep}
              onPrev={tutorial.prevStep}
              onSkip={() => { handleTutorialStepChange('__close__'); tutorial.endTutorial(); }}
              onStepChange={handleTutorialStepChange}
            />
          )}
        </Suspense>
      </div>
    </ReactFlowProvider>
  );
}

export default App;

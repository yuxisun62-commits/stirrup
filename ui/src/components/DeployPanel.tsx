import { useState, useEffect } from 'react';
import {
  getServiceAuthStatus, getTemplate, createWorkflow, saveWorkflow,
  subscribeToExecution,
  type WorkflowDefinition,
} from '../api/client';
import { tokens, inputBase } from './ui/styles';

interface Props {
  workflow: WorkflowDefinition;
  onClose: () => void;
}

export function DeployPanel({ workflow, onClose }: Props) {
  const [projectSlug, setProjectSlug] = useState('');
  const [serviceName, setServiceName] = useState(workflow.id);
  const [lmToken, setLmToken] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check if Launchmatic is already connected via the Connections panel.
  // If so, we don't need to ask for a token — the engine will auto-inject
  // the stored token when the workflow runs (self-deploy-launchmatic
  // declares lmToken with `service: launchmatic`).
  const [lmConnected, setLmConnected] = useState<boolean | null>(null);
  const [lmUserName, setLmUserName] = useState<string | undefined>(undefined);

  useEffect(() => {
    getServiceAuthStatus('launchmatic')
      .then((status) => {
        setLmConnected(status.authenticated);
        setLmUserName(status.userName);
      })
      .catch(() => setLmConnected(false));
  }, []);

  // Deploy is gated on projectSlug + serviceName + (either a manually pasted
  // token OR a saved Launchmatic credential that the engine will inject)
  const canDeploy = !!projectSlug && !!serviceName && (lmConnected === true || !!lmToken);

  const [progress, setProgress] = useState<string | null>(null);

  const handleDeploy = async () => {
    if (!canDeploy) return;
    setDeploying(true);
    setError(null);
    setProgress('Loading deploy template…');

    try {
      // Step 1: fetch the self-deploy-launchmatic template. Templates live
      // separately from registered workflows, so the engine doesn't know
      // about them until we explicitly register. This is why the previous
      // version fell through to showing CLI instructions — it was trying
      // to execute a template directly via /api/workflows/:id/execute.
      const template = await getTemplate('self-deploy-launchmatic');

      // Step 2: register it as a runnable workflow under its own ID.
      // createWorkflow fails if the ID already exists; fall back to saveWorkflow.
      setProgress('Registering deploy workflow…');
      try {
        await createWorkflow(template);
      } catch {
        await saveWorkflow(template);
      }

      // Step 3: build the execution context. Omit lmToken entirely when
      // Launchmatic is connected so the engine's server-side injection
      // picks up the saved credential from ~/.stirrup/tokens.json. Same
      // for anthropicKey now that it's service-backed.
      const context: Record<string, unknown> = {
        workflowFile: `workflows/${workflow.id}.yaml`,
        projectSlug,
        serviceName,
      };
      if (!lmConnected) {
        context.lmToken = lmToken;
      }
      // anthropicKey is injected server-side if the user has connected
      // Anthropic via the Connections panel. If not, the deployed workflow
      // will fail at first AI-node execution, which is the right failure
      // point — surfacing it here would hide a real config issue.

      // Step 4: kick off the execution
      setProgress('Starting deployment…');
      const res = await fetch('/api/workflows/self-deploy-launchmatic/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }

      // Step 5: subscribe to SSE so we can show real node-by-node progress
      // instead of waiting silently for the whole thing to finish.
      const state = await res.json();
      if (!state.executionId) {
        throw new Error('No executionId returned from execute endpoint');
      }

      setProgress('Running deploy steps…');
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const unsub = subscribeToExecution(state.executionId, (type, data) => {
          const d = data as { nodeId?: string; outputs?: Record<string, unknown>; error?: string };

          if (type === 'node:start' && d.nodeId) {
            setProgress(`Running: ${d.nodeId}`);
          }

          if (type === 'execution:complete') {
            unsub();
            // Try to extract a useful result payload from the known
            // self-deploy-launchmatic step names. Fall back to the whole
            // state if the shape is unfamiliar.
            fetch(`/api/executions/${state.executionId}`)
              .then((r) => r.json())
              .then((finalState) => {
                const steps = finalState.steps ?? {};
                const deployStep = steps['deploy-to-launchmatic'] ?? steps['deploy'] ?? null;
                const url =
                  deployStep?.outputs?.url ??
                  steps['create-service']?.outputs?.url ??
                  null;
                setResult({
                  url,
                  serviceName,
                  projectSlug,
                  executionId: state.executionId,
                  steps: Object.keys(steps).length,
                });
                resolvePromise();
              })
              .catch(() => {
                setResult({
                  executionId: state.executionId,
                  serviceName,
                  projectSlug,
                });
                resolvePromise();
              });
          }

          if (type === 'execution:fail' || type === 'node:fail') {
            unsub();
            const msg = d.error ?? (d.nodeId ? `Node ${d.nodeId} failed` : 'Deployment failed');
            rejectPromise(new Error(msg));
          }
        });

        // Hard timeout so a stuck deploy doesn't hang the UI forever
        setTimeout(() => {
          unsub();
          rejectPromise(new Error('Deployment timed out after 10 minutes'));
        }, 10 * 60 * 1000);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeploying(false);
      setProgress(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 520, maxHeight: '85vh', borderRadius: 12,
          backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${tokens.border.subtle}`,
          background: 'linear-gradient(135deg, #06b6d410, #3b82f608)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: '#fff',
            }}>LM</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text.primary }}>Deploy to Launchmatic</div>
              <div style={{ fontSize: 11, color: tokens.text.muted }}>
                Deploy "{workflow.name}" as a persistent service
              </div>
            </div>
          </div>
        </div>

        {/* Form or Result */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {result ? (
            <DeployResult result={result} onClose={onClose} />
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: tokens.text.muted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Launchmatic Project Slug *
                </label>
                <input
                  style={inputBase}
                  value={projectSlug}
                  onChange={(e) => setProjectSlug(e.target.value)}
                  placeholder="my-project"
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: tokens.text.muted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Service Name *
                </label>
                <input
                  style={inputBase}
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  placeholder={workflow.id}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: tokens.text.muted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Launchmatic API Token {lmConnected ? '' : '*'}
                </label>
                {lmConnected === null ? (
                  // Still checking saved credential status — brief skeleton
                  <div style={{
                    padding: '7px 10px', fontSize: 11, borderRadius: 6,
                    backgroundColor: tokens.bg.raised,
                    border: `1px solid ${tokens.border.subtle}`,
                    color: tokens.text.muted,
                  }}>
                    Checking saved credentials…
                  </div>
                ) : lmConnected ? (
                  // Already connected via Connections panel — show green card
                  <div style={{
                    padding: '8px 10px', fontSize: 11, borderRadius: 6,
                    backgroundColor: `${tokens.status.completed}10`,
                    border: `1px solid ${tokens.status.completed}30`,
                    color: tokens.status.completed,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                  }}>
                    <span>✓ Using saved Launchmatic credential{lmUserName ? ` (${lmUserName})` : ''}</span>
                    <span style={{ fontSize: 10, color: tokens.text.muted, fontWeight: 500 }}>
                      injected at execute time
                    </span>
                  </div>
                ) : (
                  // Not connected — fall back to manual paste
                  <>
                    <input
                      type="password"
                      style={inputBase}
                      value={lmToken}
                      onChange={(e) => setLmToken(e.target.value)}
                      placeholder="lm_..."
                    />
                    <div style={{ fontSize: 10, color: tokens.text.muted, marginTop: 2 }}>
                      Get a token from your Launchmatic dashboard, or connect Launchmatic in the Connections panel to skip this field.
                    </div>
                  </>
                )}
              </div>

              <div style={{
                padding: 10, borderRadius: 6, backgroundColor: tokens.bg.raised,
                border: `1px solid ${tokens.border.subtle}`, fontSize: 11, color: tokens.text.muted,
                lineHeight: 1.5,
              }}>
                This will:
                <ol style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  <li>Generate a production Express server for this workflow</li>
                  <li>Create a Dockerfile for containerized deployment</li>
                  <li>Deploy to Launchmatic with environment variables</li>
                  <li>Verify the deployment is live</li>
                </ol>
              </div>

              {progress && deploying && (
                <div style={{
                  marginTop: 10, padding: 10, borderRadius: 6,
                  backgroundColor: `${tokens.status.running}10`,
                  border: `1px solid ${tokens.status.running}30`,
                  fontSize: 11, color: tokens.status.running,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{
                    width: 12, height: 12, borderRadius: '50%',
                    border: `2px solid ${tokens.status.running}`, borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite', display: 'inline-block',
                  }} />
                  {progress}
                </div>
              )}
              {error && (
                <div style={{ marginTop: 10, padding: 8, borderRadius: 4, backgroundColor: `${tokens.status.failed}10`, fontSize: 11, color: tokens.status.failed }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div style={{
            padding: '12px 20px', borderTop: `1px solid ${tokens.border.subtle}`,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
          }}>
            <button onClick={onClose} style={{
              padding: '7px 16px', fontSize: 12, borderRadius: 6,
              border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
              color: tokens.text.secondary, cursor: 'pointer',
            }}>Cancel</button>
            <button
              onClick={handleDeploy}
              disabled={!canDeploy || deploying}
              style={{
                padding: '7px 20px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none',
                background: canDeploy && !deploying
                  ? 'linear-gradient(135deg, #06b6d4, #3b82f6)' : tokens.border.default,
                color: '#fff', cursor: canDeploy && !deploying ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {deploying && (
                <span style={{
                  width: 12, height: 12, borderRadius: '50%',
                  border: '2px solid #fff', borderTopColor: 'transparent',
                  animation: 'spin 0.8s linear infinite', display: 'inline-block',
                }} />
              )}
              {deploying ? 'Deploying...' : 'Deploy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DeployResult({ result, onClose }: { result: Record<string, unknown>; onClose: () => void }) {
  if (result.manual) {
    return (
      <div>
        <div style={{
          padding: 10, borderRadius: 6, backgroundColor: `${tokens.status.paused}10`,
          border: `1px solid ${tokens.status.paused}30`, marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>📋</span>
          <span style={{ fontSize: 12, color: tokens.status.paused, fontWeight: 600 }}>
            Manual deploy — use the CLI commands below
          </span>
        </div>
        <pre style={{
          padding: 12, borderRadius: 6, backgroundColor: tokens.bg.input,
          border: `1px solid ${tokens.border.subtle}`,
          fontSize: 11, fontFamily: tokens.font.mono, color: tokens.text.primary,
          whiteSpace: 'pre-wrap', lineHeight: 1.6,
        }}>
          {result.instructions as string}
        </pre>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', fontSize: 12, borderRadius: 6,
            border: 'none', backgroundColor: tokens.border.focus,
            color: '#fff', cursor: 'pointer',
          }}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{
        padding: 10, borderRadius: 6, backgroundColor: `${tokens.status.completed}10`,
        border: `1px solid ${tokens.status.completed}30`, marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>🚀</span>
        <span style={{ fontSize: 12, color: tokens.status.completed, fontWeight: 600 }}>
          Deployed successfully!
        </span>
      </div>

      {typeof result.url === 'string' && (
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: tokens.text.muted, fontWeight: 600 }}>URL: </span>
          <a href={result.url as string} target="_blank" rel="noopener" style={{
            fontSize: 12, color: tokens.text.accent, fontFamily: tokens.font.mono,
          }}>{String(result.url)}</a>
        </div>
      )}

      {typeof result.runEndpoint === 'string' && (
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: tokens.text.muted, fontWeight: 600 }}>Run endpoint: </span>
          <code style={{
            fontSize: 11, color: tokens.text.primary, fontFamily: tokens.font.mono,
            backgroundColor: tokens.bg.input, padding: '2px 6px', borderRadius: 3,
          }}>POST {String(result.runEndpoint)}</code>
        </div>
      )}

      {typeof result.usage === 'string' && (
        <div style={{ marginTop: 10 }}>
          <span style={{ fontSize: 10, color: tokens.text.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>Example:</span>
          <pre style={{
            padding: 10, borderRadius: 6, backgroundColor: tokens.bg.input,
            border: `1px solid ${tokens.border.subtle}`,
            fontSize: 10, fontFamily: tokens.font.mono, color: tokens.text.primary,
            whiteSpace: 'pre-wrap',
          }}>{result.usage as string}</pre>
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{
          padding: '7px 16px', fontSize: 12, borderRadius: 6,
          border: 'none', backgroundColor: tokens.border.focus,
          color: '#fff', cursor: 'pointer',
        }}>Done</button>
      </div>
    </div>
  );
}

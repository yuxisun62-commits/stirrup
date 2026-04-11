import { useEffect, useState } from 'react';
import {
  getNodeDebugInfo, retryNode, analyzeFailure,
  type DebugInfo, type StepResult, type WorkflowNode,
} from '../api/client';
import { tokens, monoInput } from './ui/styles';

interface Props {
  executionId: string;
  node: WorkflowNode;
  onClose: () => void;
  onRetrySuccess: (result: StepResult) => void;
}

export function DebugPanel({ executionId, node, onClose, onRetrySuccess }: Props) {
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<StepResult | null>(null);

  // Editable overrides
  const [inputsJson, setInputsJson] = useState<string>('');
  const [configJson, setConfigJson] = useState<string>('');
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    setLoading(true);
    getNodeDebugInfo(executionId, node.id)
      .then((info) => {
        setDebug(info);
        setInputsJson(JSON.stringify(info.resolvedInputs, null, 2));
        setConfigJson(JSON.stringify(info.config, null, 2));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [executionId, node.id]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await analyzeFailure(executionId, node.id);
      setAnalysis(res.analysis);
    } catch (err) {
      setAnalysis(`AI analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    setRetryResult(null);
    try {
      let inputs: Record<string, unknown> | undefined;
      let config: Record<string, unknown> | undefined;

      if (editMode) {
        try {
          inputs = JSON.parse(inputsJson);
          config = JSON.parse(configJson);
        } catch (err) {
          setRetryResult({
            nodeId: node.id,
            status: 'failed',
            outputs: {},
            error: { message: 'Invalid JSON in overrides: ' + (err as Error).message, attempt: 1 },
            startedAt: new Date().toISOString(),
            attempts: 1,
          } as StepResult);
          setRetrying(false);
          return;
        }
      }

      const result = await retryNode(executionId, node.id, inputs, config);
      setRetryResult(result);
      if (result.status === 'completed') {
        onRetrySuccess(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  };

  const failed = debug?.step?.status === 'failed';

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
          width: 720, maxHeight: '90vh', borderRadius: 12,
          backgroundColor: tokens.bg.surface, border: `1px solid ${failed ? tokens.status.failed : tokens.border.subtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${tokens.border.subtle}`,
          background: failed ? `${tokens.status.failed}08` : `${tokens.nodeColors['llm-prompt']}08`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: tokens.text.primary }}>
                  Debug Node
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                  backgroundColor: failed ? `${tokens.status.failed}25` : `${tokens.status.running}25`,
                  color: failed ? tokens.status.failed : tokens.status.running,
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>
                  {debug?.step?.status ?? 'loading'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: tokens.text.muted }}>
                {node.name} · <span style={{ fontFamily: tokens.font.mono }}>{node.id}</span> · {node.type}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', color: tokens.text.muted, fontSize: 20, cursor: 'pointer',
            }}>x</button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 30, color: tokens.text.muted }}>Loading debug info...</div>
          )}

          {error && (
            <div style={{
              padding: 10, borderRadius: 6, marginBottom: 12,
              backgroundColor: `${tokens.status.failed}10`,
              border: `1px solid ${tokens.status.failed}30`,
              fontSize: 11, color: tokens.status.failed,
            }}>
              {error}
            </div>
          )}

          {debug && (
            <>
              {/* Error section */}
              {debug.step?.error && (
                <Section title="Error" color={tokens.status.failed}>
                  <div style={{
                    padding: 10, borderRadius: 6,
                    backgroundColor: `${tokens.status.failed}08`,
                    border: `1px solid ${tokens.status.failed}30`,
                    fontSize: 11, fontFamily: tokens.font.mono,
                    color: '#fca5a5', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {debug.step.error.message}
                    </div>
                    {debug.step.error.stack && (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ cursor: 'pointer', color: tokens.text.muted, fontSize: 10 }}>
                          Stack trace
                        </summary>
                        <pre style={{ marginTop: 6, fontSize: 10, color: tokens.text.secondary, lineHeight: 1.4 }}>
                          {debug.step.error.stack}
                        </pre>
                      </details>
                    )}
                    <div style={{ fontSize: 10, color: tokens.text.muted, marginTop: 6 }}>
                      Attempt {debug.step.error.attempt} of {debug.step.attempts}
                    </div>
                  </div>
                </Section>
              )}

              {/* AI Analysis button + result */}
              {failed && (
                <Section title="AI Analysis" color={tokens.nodeColors['llm-prompt']}>
                  {!analysis && (
                    <button
                      onClick={handleAnalyze}
                      disabled={analyzing}
                      style={{
                        padding: '7px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none',
                        background: analyzing
                          ? tokens.border.default
                          : `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}, ${tokens.nodeColors['decision-routing']})`,
                        color: '#fff', cursor: analyzing ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {analyzing && (
                        <span style={{
                          width: 12, height: 12, borderRadius: '50%',
                          border: '2px solid #fff', borderTopColor: 'transparent',
                          animation: 'spin 0.8s linear infinite', display: 'inline-block',
                        }} />
                      )}
                      {analyzing ? 'Analyzing with AI...' : '🔍 Analyze with AI'}
                    </button>
                  )}
                  {analysis && (
                    <div style={{
                      padding: 12, borderRadius: 6,
                      backgroundColor: `${tokens.nodeColors['llm-prompt']}08`,
                      border: `1px solid ${tokens.nodeColors['llm-prompt']}30`,
                      fontSize: 12, color: tokens.text.primary,
                      lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    }}>
                      {analysis}
                    </div>
                  )}
                </Section>
              )}

              {/* Input mappings */}
              <Section title="Input Mappings" color={tokens.text.muted}>
                {debug.mappings.length === 0 ? (
                  <div style={{ fontSize: 11, color: tokens.text.muted, fontStyle: 'italic' }}>No input mappings defined</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {debug.mappings.map((m, i) => (
                      <div key={i} style={{
                        display: 'flex', gap: 8, padding: '4px 8px', borderRadius: 4,
                        backgroundColor: tokens.bg.raised, fontSize: 11, fontFamily: tokens.font.mono,
                      }}>
                        <span style={{ color: tokens.text.accent }}>{m.from}</span>
                        <span style={{ color: tokens.text.muted }}>→</span>
                        <span style={{ color: tokens.text.primary }}>{m.to}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Resolved inputs */}
              <Section
                title="Resolved Inputs (what the node received)"
                color={tokens.text.muted}
                action={!editMode && (
                  <button
                    onClick={() => setEditMode(true)}
                    style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 3,
                      border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                      color: tokens.text.muted, cursor: 'pointer',
                    }}
                  >
                    Edit & Retry
                  </button>
                )}
              >
                {editMode ? (
                  <textarea
                    style={{ ...monoInput, height: 140, resize: 'vertical', width: '100%' }}
                    value={inputsJson}
                    onChange={(e) => setInputsJson(e.target.value)}
                  />
                ) : (
                  <pre style={{
                    padding: 10, borderRadius: 6,
                    backgroundColor: tokens.bg.input, border: `1px solid ${tokens.border.subtle}`,
                    fontSize: 11, fontFamily: tokens.font.mono, color: tokens.text.primary,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto',
                  }}>
                    {JSON.stringify(debug.resolvedInputs, null, 2)}
                  </pre>
                )}
              </Section>

              {/* Config */}
              {editMode && (
                <Section title="Config (editable)" color={tokens.text.muted}>
                  <textarea
                    style={{ ...monoInput, height: 140, resize: 'vertical', width: '100%' }}
                    value={configJson}
                    onChange={(e) => setConfigJson(e.target.value)}
                  />
                </Section>
              )}

              {/* Retry result */}
              {retryResult && (
                <Section
                  title={`Retry Result: ${retryResult.status}`}
                  color={retryResult.status === 'completed' ? tokens.status.completed : tokens.status.failed}
                >
                  {retryResult.status === 'completed' ? (
                    <div style={{
                      padding: 10, borderRadius: 6,
                      backgroundColor: `${tokens.status.completed}08`,
                      border: `1px solid ${tokens.status.completed}30`,
                    }}>
                      <div style={{ fontSize: 11, color: tokens.status.completed, fontWeight: 600, marginBottom: 6 }}>
                        ✓ Node ran successfully on retry
                      </div>
                      <pre style={{
                        fontSize: 11, fontFamily: tokens.font.mono, color: tokens.text.primary,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto',
                      }}>
                        {JSON.stringify(retryResult.outputs, null, 2)}
                      </pre>
                    </div>
                  ) : (
                    <div style={{
                      padding: 10, borderRadius: 6,
                      backgroundColor: `${tokens.status.failed}08`,
                      border: `1px solid ${tokens.status.failed}30`,
                      fontSize: 11, fontFamily: tokens.font.mono, color: '#fca5a5',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {retryResult.error?.message ?? 'Unknown error'}
                    </div>
                  )}
                </Section>
              )}
            </>
          )}
        </div>

        {/* Footer with retry button */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${tokens.border.subtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <div style={{ fontSize: 10, color: tokens.text.muted }}>
            Debug runs the node in isolation — no retry policy, no downstream effects.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {editMode && (
              <button
                onClick={() => {
                  setEditMode(false);
                  if (debug) {
                    setInputsJson(JSON.stringify(debug.resolvedInputs, null, 2));
                    setConfigJson(JSON.stringify(debug.config, null, 2));
                  }
                }}
                style={{
                  padding: '7px 14px', fontSize: 11, borderRadius: 6,
                  border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                  color: tokens.text.muted, cursor: 'pointer',
                }}
              >
                Reset
              </button>
            )}
            <button
              onClick={handleRetry}
              disabled={retrying || loading}
              style={{
                padding: '7px 16px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none',
                background: retrying ? tokens.border.default : tokens.status.completed,
                color: '#fff', cursor: retrying ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {retrying && (
                <span style={{
                  width: 12, height: 12, borderRadius: '50%',
                  border: '2px solid #fff', borderTopColor: 'transparent',
                  animation: 'spin 0.8s linear infinite', display: 'inline-block',
                }} />
              )}
              {retrying ? 'Running...' : editMode ? 'Retry with Overrides' : 'Retry Node'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, color, children, action }: {
  title: string;
  color: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '1px',
        }}>
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

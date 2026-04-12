import { useEffect, useState } from 'react';
import {
  getNodeDebugInfo, retryNode, analyzeFailure,
  type DebugInfo, type StepResult, type WorkflowNode, type SuggestedEdit,
} from '../api/client';
import { tokens, monoInput } from './ui/styles';
import { BotIcon, CheckIcon } from './ui/icons';

interface Props {
  executionId: string;
  node: WorkflowNode;
  onClose: () => void;
  onRetrySuccess: (result: StepResult) => void;
  /**
   * Called when the user applies an AI-suggested edit. The parent (App.tsx)
   * wires this to useWorkflow's updateNode so edits land in the workflow
   * state and flow through to the canvas, save, and execute paths.
   * If not provided, the apply-edits UI is hidden.
   */
  onApplyEdit?: (nodeId: string, updates: Partial<WorkflowNode>) => void;
}

/**
 * Prototype-pollution guards. setAtPath walks a user-specified path and
 * will happily set `obj.__proto__.polluted = true` if the AI suggests that
 * path — corrupting the prototype chain and potentially granting false
 * authorizations downstream. These segment names are never legitimate
 * targets for a workflow config edit.
 */
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Set a value at a dot-path inside a target object, returning a shallow-
 * cloned copy so React state updates don't mutate through references.
 * Handles paths like 'config.url', 'config.headers.Authorization',
 * 'retry.maxAttempts'.
 *
 * Throws if any path segment is a prototype-pollution vector.
 */
function setAtPath(target: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.');
  for (const key of keys) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) {
      throw new Error(`Refusing to set forbidden path segment: ${key}`);
    }
  }
  const root: Record<string, unknown> = { ...target };
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const existing = cursor[key];
    const next = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
    cursor[key] = next;
    cursor = next;
  }
  cursor[keys[keys.length - 1]] = value;
  return root;
}

export function DebugPanel({ executionId, node, onClose, onRetrySuccess, onApplyEdit }: Props) {
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [suggestedEdits, setSuggestedEdits] = useState<SuggestedEdit[]>([]);
  const [approvedEdits, setApprovedEdits] = useState<Set<number>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [applied, setApplied] = useState(false);
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
    setSuggestedEdits([]);
    setApprovedEdits(new Set());
    setApplied(false);
    try {
      const res = await analyzeFailure(executionId, node.id);
      setAnalysis(res.analysis);
      setSuggestedEdits(res.suggestedEdits ?? []);
      // Default to UNAPPROVED so the user must consciously tick each edit
      // before applying. The AI may have been steered by prompt injection
      // via untrusted content in the workflow's error/output, so auto-
      // approval is not safe.
      setApprovedEdits(new Set());
    } catch (err) {
      setAnalysis(`AI analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApplyEdits = () => {
    if (!onApplyEdit || suggestedEdits.length === 0) return;

    // Group edits by top-level node field so we do ONE updateNode call per
    // field root (avoids stomping when multiple edits touch the same subtree,
    // e.g. config.url AND config.headers.Authorization).
    const byRoot: Record<string, SuggestedEdit[]> = {};
    for (let i = 0; i < suggestedEdits.length; i++) {
      if (!approvedEdits.has(i)) continue;
      const edit = suggestedEdits[i];
      const root = edit.field.split('.')[0];
      if (!byRoot[root]) byRoot[root] = [];
      byRoot[root].push(edit);
    }

    const updates: Partial<WorkflowNode> = {};
    try {
      for (const [root, edits] of Object.entries(byRoot)) {
        if (root === 'config') {
          let nextConfig: Record<string, unknown> = { ...(node.config ?? {}) };
          for (const e of edits) {
            const subPath = e.field.slice('config.'.length);
            nextConfig = setAtPath(nextConfig, subPath, e.suggestedValue);
          }
          updates.config = nextConfig;
        } else if (root === 'retry') {
          let nextRetry: Record<string, unknown> = { ...(node.retry ?? {}) };
          for (const e of edits) {
            const subPath = e.field.slice('retry.'.length);
            nextRetry = setAtPath(nextRetry, subPath, e.suggestedValue);
          }
          // Type assertion: the validator rejects retry edits that don't match shape
          updates.retry = nextRetry as WorkflowNode['retry'];
        } else if (root === 'description') {
          updates.description = String(edits[edits.length - 1].suggestedValue ?? '');
        } else if (root === 'name') {
          updates.name = String(edits[edits.length - 1].suggestedValue ?? '');
        }
      }
    } catch (err) {
      // setAtPath throws on forbidden path segments (prototype pollution guard).
      // Surface the error instead of silently swallowing it — the user has
      // approved something the AI shouldn't have suggested.
      setError(`Refused to apply edits: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    onApplyEdit(node.id, updates);
    setApplied(true);
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
                      {analyzing ? (
                        <span style={{
                          width: 12, height: 12, borderRadius: '50%',
                          border: '2px solid #fff', borderTopColor: 'transparent',
                          animation: 'spin 0.8s linear infinite', display: 'inline-block',
                        }} />
                      ) : (
                        <BotIcon />
                      )}
                      {analyzing ? 'Analyzing with AI...' : 'Analyze with AI'}
                    </button>
                  )}
                  {analysis && (
                    <>
                      <div style={{
                        padding: 12, borderRadius: 6,
                        backgroundColor: `${tokens.nodeColors['llm-prompt']}08`,
                        border: `1px solid ${tokens.nodeColors['llm-prompt']}30`,
                        fontSize: 12, color: tokens.text.primary,
                        lineHeight: 1.5, whiteSpace: 'pre-wrap',
                      }}>
                        {analysis}
                      </div>

                      {/* Suggested edits — rendered as a review-and-approve list.
                          Each edit shows before/after + reason, with a checkbox
                          to approve it. The Apply button at the end calls
                          onApplyEdit for all approved edits in one batched
                          updateNode call so React state updates cleanly. */}
                      {suggestedEdits.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{
                            fontSize: 10, fontWeight: 700, color: tokens.text.muted,
                            textTransform: 'uppercase', letterSpacing: '1px',
                            marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6,
                          }}>
                            <span>Suggested Fixes</span>
                            <span style={{
                              fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 700,
                              backgroundColor: `${tokens.status.completed}20`, color: tokens.status.completed,
                            }}>
                              {approvedEdits.size} / {suggestedEdits.length} approved
                            </span>
                          </div>
                          <div style={{
                            marginBottom: 8, padding: '6px 8px', borderRadius: 4,
                            backgroundColor: `${tokens.status.paused}10`,
                            border: `1px solid ${tokens.status.paused}30`,
                            fontSize: 10, color: tokens.text.secondary, lineHeight: 1.4,
                          }}>
                            <b>Review each edit before approving.</b> If your workflow fetches
                            external content (webhooks, web pages, RSS), a crafted payload could
                            steer the AI's suggestions. Tick only the edits you understand and trust.
                          </div>

                          {suggestedEdits.map((edit, i) => {
                            const approved = approvedEdits.has(i);
                            return (
                              <div
                                key={i}
                                style={{
                                  marginBottom: 6, padding: 8, borderRadius: 6,
                                  backgroundColor: approved
                                    ? `${tokens.status.completed}06`
                                    : tokens.bg.raised,
                                  border: `1px solid ${approved ? tokens.status.completed : tokens.border.subtle}30`,
                                  cursor: applied ? 'default' : 'pointer',
                                  opacity: applied ? 0.6 : 1,
                                }}
                                onClick={() => {
                                  if (applied) return;
                                  setApprovedEdits((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(i)) next.delete(i); else next.add(i);
                                    return next;
                                  });
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                  <input
                                    type="checkbox"
                                    checked={approved}
                                    readOnly
                                    disabled={applied}
                                    style={{ marginTop: 2, cursor: applied ? 'default' : 'pointer', flexShrink: 0 }}
                                  />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                      fontSize: 11, fontFamily: tokens.font.mono,
                                      color: tokens.text.accent, fontWeight: 600,
                                      wordBreak: 'break-all',
                                    }}>
                                      {edit.field}
                                    </div>
                                    <div style={{ fontSize: 10, color: tokens.text.muted, marginTop: 2, lineHeight: 1.4 }}>
                                      {edit.reason}
                                    </div>
                                    <div style={{ display: 'flex', gap: 6, marginTop: 6, fontSize: 10, fontFamily: tokens.font.mono }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ color: tokens.text.muted, marginBottom: 2 }}>— current</div>
                                        <div style={{
                                          padding: '4px 6px', borderRadius: 3,
                                          backgroundColor: `${tokens.status.failed}10`,
                                          color: '#fca5a5',
                                          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                          maxHeight: 80, overflow: 'auto',
                                        }}>
                                          {typeof edit.currentValue === 'string'
                                            ? edit.currentValue
                                            : JSON.stringify(edit.currentValue, null, 2)}
                                        </div>
                                      </div>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ color: tokens.text.muted, marginBottom: 2 }}>+ suggested</div>
                                        <div style={{
                                          padding: '4px 6px', borderRadius: 3,
                                          backgroundColor: `${tokens.status.completed}10`,
                                          color: '#86efac',
                                          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                          maxHeight: 80, overflow: 'auto',
                                        }}>
                                          {typeof edit.suggestedValue === 'string'
                                            ? edit.suggestedValue
                                            : JSON.stringify(edit.suggestedValue, null, 2)}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          {onApplyEdit && !applied && (
                            <button
                              onClick={handleApplyEdits}
                              disabled={approvedEdits.size === 0}
                              style={{
                                marginTop: 4, padding: '7px 14px', fontSize: 11, fontWeight: 600,
                                borderRadius: 6, border: 'none',
                                background: approvedEdits.size === 0
                                  ? tokens.border.default
                                  : `linear-gradient(135deg, ${tokens.status.completed}, #10b981)`,
                                color: '#fff',
                                cursor: approvedEdits.size === 0 ? 'default' : 'pointer',
                              }}
                            >
                              Apply {approvedEdits.size} edit{approvedEdits.size === 1 ? '' : 's'} to workflow
                            </button>
                          )}
                          {applied && (
                            <div style={{
                              marginTop: 4, padding: '7px 10px', fontSize: 11, borderRadius: 6,
                              backgroundColor: `${tokens.status.completed}10`,
                              border: `1px solid ${tokens.status.completed}30`,
                              color: tokens.status.completed, fontWeight: 600,
                              display: 'flex', alignItems: 'center', gap: 6,
                            }}>
                              <CheckIcon />
                              Edits applied to workflow. Close this panel and click Save, then Retry to test the fix.
                            </div>
                          )}
                          {!onApplyEdit && (
                            <div style={{
                              marginTop: 4, padding: '7px 10px', fontSize: 10, borderRadius: 6,
                              backgroundColor: tokens.bg.raised, color: tokens.text.muted,
                            }}>
                              Open this panel from the Node Inspector to enable one-click fix application.
                            </div>
                          )}
                        </div>
                      )}
                    </>
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
                      <div style={{
                        fontSize: 11, color: tokens.status.completed, fontWeight: 600, marginBottom: 6,
                        display: 'flex', alignItems: 'center', gap: 5,
                      }}>
                        <CheckIcon />
                        Node ran successfully on retry
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

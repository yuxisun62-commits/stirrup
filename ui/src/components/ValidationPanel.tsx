import { useState, useEffect, useCallback } from 'react';
import { validateWorkflowApi, fixWorkflow, type WorkflowDefinition, type EnrichedError } from '../api/client';
import { tokens } from './ui/styles';
import { LightbulbIcon } from './ui/icons';

interface Props {
  workflow: WorkflowDefinition;
  onFixed: (wf: WorkflowDefinition) => void;
  onSelectNode: (nodeId: string) => void;
}

/** Try to extract a node ID from a validation error message */
function extractNodeId(error: string, nodeIds: Set<string>): string | null {
  // Check for quoted node IDs: "node-name"
  const quotedMatch = error.match(/"([^"]+)"/g);
  if (quotedMatch) {
    for (const m of quotedMatch) {
      const id = m.replace(/"/g, '');
      if (nodeIds.has(id)) return id;
    }
  }

  // Check for node IDs mentioned directly in the error text
  for (const id of nodeIds) {
    if (error.includes(id)) return id;
  }

  // Check for "nodes.<id>" references
  const nodesMatch = error.match(/nodes\.([a-zA-Z0-9_-]+)/);
  if (nodesMatch && nodeIds.has(nodesMatch[1])) return nodesMatch[1];

  return null;
}

export function ValidationPanel({ workflow, onFixed, onSelectNode }: Props) {
  const [errors, setErrors] = useState<string[]>([]);
  const [enrichedErrors, setEnrichedErrors] = useState<EnrichedError[]>([]);
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedSuggestionIdx, setExpandedSuggestionIdx] = useState<number | null>(null);

  const nodeIds = new Set(workflow.nodes.map((n) => n.id));

  const validate = useCallback(async () => {
    if (workflow.nodes.length === 0) {
      setIsValid(null);
      setErrors([]);
      setEnrichedErrors([]);
      return;
    }
    try {
      const result = await validateWorkflowApi(workflow);
      setIsValid(result.valid);
      setErrors(result.errors);
      setEnrichedErrors(result.enriched ?? []);
      if (!result.valid && !expanded) setExpanded(true);
    } catch {
      // Silently fail
    }
  }, [workflow.nodes.length, workflow.edges.length, workflow.id]);

  useEffect(() => {
    const timer = setTimeout(validate, 500);
    return () => clearTimeout(timer);
  }, [validate]);

  const handleFix = async () => {
    setIsFixing(true);
    setFixError(null);
    try {
      const fixed = await fixWorkflow(workflow, errors);
      fixed.id = workflow.id;
      onFixed(fixed);
      setTimeout(validate, 200);
    } catch (err) {
      setFixError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFixing(false);
    }
  };

  if (isValid === null) return null;
  if (isValid) {
    return (
      <div style={{
        padding: '4px 14px',
        display: 'flex', alignItems: 'center', gap: 6,
        borderTop: `1px solid ${tokens.border.subtle}`,
        backgroundColor: `${tokens.status.completed}06`,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: tokens.status.completed }} />
        <span style={{ fontSize: 10, color: tokens.status.completed, fontWeight: 600 }}>Valid workflow</span>
      </div>
    );
  }

  return (
    <div style={{
      borderTop: `1px solid ${tokens.status.failed}30`,
      backgroundColor: `${tokens.status.failed}06`,
    }}>
      {/* Header */}
      <div
        style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={() => setExpanded((p) => !p)}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: tokens.status.failed }} />
        <span style={{ fontSize: 10, color: tokens.status.failed, fontWeight: 600 }}>
          {errors.length} validation error{errors.length !== 1 ? 's' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={(e) => { e.stopPropagation(); handleFix(); }}
          disabled={isFixing}
          style={{
            padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
            border: 'none',
            background: isFixing
              ? tokens.border.default
              : `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}, ${tokens.nodeColors['decision-routing']})`,
            color: '#fff', cursor: isFixing ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          {isFixing ? (
            <>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                border: '2px solid #fff', borderTopColor: 'transparent',
                animation: 'spin 0.8s linear infinite', display: 'inline-block',
              }} />
              Fixing...
            </>
          ) : (
            <>AI Auto-Fix</>
          )}
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <span style={{
          fontSize: 12, color: tokens.text.muted,
          transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 0.2s',
        }}>v</span>
      </div>

      {/* Error list */}
      {expanded && (
        <div style={{ padding: '0 14px 8px' }}>
          {errors.map((err, i) => {
            const enriched = enrichedErrors[i];
            const relatedNodeId = extractNodeId(err, nodeIds);
            const isSuggestionOpen = expandedSuggestionIdx === i;
            const color = enriched?.severity === 'warning' ? tokens.status.paused : tokens.status.failed;

            return (
              <div key={i} style={{
                marginBottom: 4, borderRadius: 4,
                backgroundColor: `${color}08`,
                border: `1px solid ${color}20`,
                overflow: 'hidden',
              }}>
                <div
                  onClick={(e) => {
                    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
                    if (relatedNodeId) onSelectNode(relatedNodeId);
                  }}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 6,
                    padding: '6px 8px',
                    fontSize: 11, color: enriched?.severity === 'warning' ? '#fde68a' : '#fca5a5',
                    lineHeight: 1.4, fontFamily: tokens.font.mono,
                    cursor: relatedNodeId ? 'pointer' : 'default',
                  }}
                >
                  <span style={{ color, fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ flex: 1, wordBreak: 'break-word' }}>{err}</span>
                  {enriched?.suggestion && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedSuggestionIdx(isSuggestionOpen ? null : i);
                      }}
                      style={{
                        fontSize: 9, padding: '2px 6px', borderRadius: 3,
                        backgroundColor: `${tokens.nodeColors['llm-prompt']}20`,
                        color: tokens.nodeColors['llm-prompt'],
                        border: `1px solid ${tokens.nodeColors['llm-prompt']}40`,
                        cursor: 'pointer', fontWeight: 600, flexShrink: 0,
                        fontFamily: tokens.font.sans,
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}
                    >
                      {isSuggestionOpen ? 'hide tip' : <><LightbulbIcon size={10} /> tip</>}
                    </button>
                  )}
                  {relatedNodeId && (
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 3,
                      backgroundColor: tokens.bg.input, color: tokens.text.accent,
                      border: `1px solid ${tokens.border.subtle}`,
                      flexShrink: 0,
                    }}>
                      {relatedNodeId} →
                    </span>
                  )}
                </div>
                {isSuggestionOpen && enriched?.suggestion && (
                  <div style={{
                    padding: '6px 10px 8px 28px',
                    fontSize: 11, color: tokens.text.secondary,
                    borderTop: `1px solid ${color}20`,
                    backgroundColor: `${tokens.nodeColors['llm-prompt']}06`,
                    lineHeight: 1.5,
                  }}>
                    <span style={{ fontWeight: 600, color: tokens.nodeColors['llm-prompt'] }}>Suggestion: </span>
                    {enriched.suggestion}
                  </div>
                )}
              </div>
            );
          })}

          {fixError && (
            <div style={{
              marginTop: 6, padding: '6px 8px', borderRadius: 4,
              backgroundColor: `${tokens.status.failed}10`,
              fontSize: 10, color: tokens.status.failed,
            }}>
              Fix failed: {fixError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

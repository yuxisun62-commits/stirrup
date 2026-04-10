import { useState, useEffect, useCallback } from 'react';
import { validateWorkflowApi, fixWorkflow, type WorkflowDefinition } from '../api/client';
import { tokens } from './ui/styles';

interface Props {
  workflow: WorkflowDefinition;
  onFixed: (wf: WorkflowDefinition) => void;
}

export function ValidationPanel({ workflow, onFixed }: Props) {
  const [errors, setErrors] = useState<string[]>([]);
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const validate = useCallback(async () => {
    // Don't validate empty workflows
    if (workflow.nodes.length === 0) {
      setIsValid(null);
      setErrors([]);
      return;
    }
    try {
      const result = await validateWorkflowApi(workflow);
      setIsValid(result.valid);
      setErrors(result.errors);
      if (!result.valid && !expanded) setExpanded(true);
    } catch {
      // Silently fail — validation is best-effort
    }
  }, [workflow.nodes.length, workflow.edges.length, workflow.id]);

  // Validate on workflow changes (debounced)
  useEffect(() => {
    const timer = setTimeout(validate, 500);
    return () => clearTimeout(timer);
  }, [validate]);

  const handleFix = async () => {
    setIsFixing(true);
    setFixError(null);
    try {
      const fixed = await fixWorkflow(workflow, errors);
      fixed.id = workflow.id; // Preserve the current ID
      onFixed(fixed);
      // Re-validate after fix
      setTimeout(validate, 200);
    } catch (err) {
      setFixError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFixing(false);
    }
  };

  // Don't show anything for empty/unvalidated workflows
  if (isValid === null) return null;
  if (isValid) {
    return (
      <div style={{
        padding: '4px 14px',
        display: 'flex', alignItems: 'center', gap: 6,
        borderTop: `1px solid ${tokens.border.subtle}`,
        backgroundColor: `${tokens.status.completed}06`,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', backgroundColor: tokens.status.completed,
        }} />
        <span style={{ fontSize: 10, color: tokens.status.completed, fontWeight: 600 }}>
          Valid workflow
        </span>
      </div>
    );
  }

  return (
    <div style={{
      borderTop: `1px solid ${tokens.status.failed}30`,
      backgroundColor: `${tokens.status.failed}06`,
    }}>
      {/* Header — always visible */}
      <div
        style={{
          padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        }}
        onClick={() => setExpanded((p) => !p)}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%', backgroundColor: tokens.status.failed,
        }} />
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
                border: `2px solid #fff`, borderTopColor: 'transparent',
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
          {errors.map((err, i) => (
            <div key={i} style={{
              display: 'flex', gap: 6, padding: '4px 8px', marginBottom: 2,
              borderRadius: 4, backgroundColor: `${tokens.status.failed}08`,
              fontSize: 11, color: '#fca5a5', lineHeight: 1.4,
              fontFamily: tokens.font.mono,
            }}>
              <span style={{ color: tokens.status.failed, fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
              <span>{err}</span>
            </div>
          ))}

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

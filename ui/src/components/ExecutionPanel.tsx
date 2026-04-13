import { useState } from 'react';
import { StatusBadge } from './StatusBadge';
import { tokens } from './ui/styles';
import type { ExecutionEvent } from '../hooks/useExecution';
import type { ExecutionState } from '../api/client';

interface Props {
  execution: ExecutionState | null;
  events: ExecutionEvent[];
  isRunning: boolean;
  totalNodes: number;
  onRun: () => void;
  onClear: () => void;
  onDeploy?: () => void;
  onSelectNode?: (nodeId: string) => void;
}

function getEventColor(type: string): string {
  if (type.includes('complete')) return tokens.status.completed;
  if (type.includes('fail')) return tokens.status.failed;
  if (type.includes('start')) return tokens.status.running;
  if (type.includes('skip')) return tokens.status.skipped;
  if (type.includes('retry')) return tokens.status.paused;
  return tokens.text.muted;
}

export function ExecutionPanel({
  execution, events, isRunning, totalNodes,
  onRun, onClear, onDeploy, onSelectNode,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  // Progress calculations
  const steps = execution?.steps ?? {};
  const completedCount = Object.values(steps).filter((s) => s.status === 'completed').length;
  const failedCount = Object.values(steps).filter((s) => s.status === 'failed').length;
  const skippedCount = Object.values(steps).filter((s) => s.status === 'skipped').length;
  const finishedCount = completedCount + failedCount + skippedCount;
  const percent = totalNodes > 0 ? Math.round((finishedCount / totalNodes) * 100) : 0;

  // Find currently running nodes
  const runningNodes = Object.values(steps)
    .filter((s) => s.status === 'running')
    .map((s) => s.nodeId);

  return (
    <div data-tutorial="execution-panel" style={{ borderTop: `1px solid ${tokens.border.subtle}`, backgroundColor: tokens.bg.surface }}>
      {/* Header bar — always visible */}
      <div
        style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={() => setExpanded((p) => !p)}
      >
        <span style={{
          fontSize: 10, fontWeight: 700, color: tokens.text.muted,
          textTransform: 'uppercase', letterSpacing: '1px',
        }}>
          Execution
        </span>

        {execution && <StatusBadge status={execution.status} size="sm" />}

        {execution && totalNodes > 0 && (
          <span style={{ fontSize: 10, color: tokens.text.muted, fontFamily: tokens.font.mono }}>
            {finishedCount}/{totalNodes} nodes
          </span>
        )}

        {runningNodes.length > 0 && (
          <span style={{
            fontSize: 10, color: tokens.status.running, fontFamily: tokens.font.mono,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              backgroundColor: tokens.status.running,
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
            {runningNodes.slice(0, 2).join(', ')}
            {runningNodes.length > 2 && ` +${runningNodes.length - 2}`}
          </span>
        )}

        <div style={{ flex: 1 }} />

        <button
          data-tutorial="run-button"
          onClick={(e) => { e.stopPropagation(); onRun(); }}
          disabled={isRunning}
          style={{
            padding: '4px 14px', fontSize: 11, fontWeight: 700, borderRadius: 4,
            border: 'none', cursor: isRunning ? 'default' : 'pointer',
            backgroundColor: isRunning ? tokens.border.default : tokens.status.completed,
            color: '#fff', fontFamily: tokens.font.sans, letterSpacing: '0.3px',
          }}
        >
          {isRunning ? 'Running...' : 'Run Workflow'}
        </button>

        {execution && (
          <>
            {onDeploy && !isRunning && execution.status === 'completed' && (
              <button
                onClick={(e) => { e.stopPropagation(); onDeploy(); }}
                style={{
                  padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
                  border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                  color: '#fff',
                }}
              >
                Deploy
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              disabled={isRunning}
              style={{
                padding: '4px 10px', fontSize: 10, borderRadius: 4,
                border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                color: tokens.text.muted, cursor: isRunning ? 'default' : 'pointer',
              }}
            >
              Clear
            </button>
          </>
        )}

        <span style={{
          fontSize: 14, color: tokens.text.muted, transition: 'transform 0.2s',
          transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
        }}>
          v
        </span>
      </div>

      {/* Progress bar — visible whenever execution exists */}
      {execution && totalNodes > 0 && (
        <div style={{
          padding: '0 14px 4px', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <div style={{
            flex: 1, height: 4, borderRadius: 2,
            backgroundColor: tokens.border.subtle, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${percent}%`,
              background: failedCount > 0
                ? `linear-gradient(90deg, ${tokens.status.completed} ${(completedCount / totalNodes) * 100}%, ${tokens.status.failed})`
                : isRunning
                  ? `linear-gradient(90deg, ${tokens.status.completed}, ${tokens.status.running})`
                  : tokens.status.completed,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <span style={{
            fontSize: 9, color: tokens.text.muted, fontFamily: tokens.font.mono,
            minWidth: 32, textAlign: 'right',
          }}>
            {percent}%
          </span>
        </div>
      )}

      {/* Expandable content */}
      {expanded && execution && (
        <div style={{
          maxHeight: 260, overflow: 'auto', padding: '6px 14px 8px',
          borderTop: `1px solid ${tokens.border.subtle}`,
        }}>
          {/* Step summary — live view of every node's status */}
          {Object.keys(steps).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{
                fontSize: 9, fontWeight: 700, color: tokens.text.muted,
                textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4,
              }}>
                Step Status
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {Object.values(steps).map((step) => {
                  const color = step.status === 'completed' ? tokens.status.completed
                    : step.status === 'failed' ? tokens.status.failed
                    : step.status === 'running' ? tokens.status.running
                    : step.status === 'skipped' ? tokens.status.skipped
                    : tokens.border.default;
                  const pulse = step.status === 'running';
                  return (
                    <button
                      key={step.nodeId}
                      onClick={() => onSelectNode?.(step.nodeId)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px', borderRadius: 3,
                        backgroundColor: `${color}15`,
                        border: `1px solid ${color}30`,
                        fontSize: 10, fontFamily: tokens.font.mono,
                        color: color,
                        cursor: onSelectNode ? 'pointer' : 'default',
                      }}
                      title={`Click to inspect ${step.nodeId}`}
                    >
                      <span style={{
                        width: 5, height: 5, borderRadius: '50%',
                        backgroundColor: color,
                        animation: pulse ? 'pulse 1.5s ease-in-out infinite' : undefined,
                      }} />
                      {step.nodeId}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Event log */}
          {events.length > 0 && (
            <>
              <div style={{
                fontSize: 9, fontWeight: 700, color: tokens.text.muted,
                textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4,
              }}>
                Event Log
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {events.map((evt, i) => (
                  <div
                    key={i}
                    onClick={() => evt.nodeId && onSelectNode?.(evt.nodeId)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '3px 6px', borderRadius: 4,
                      fontSize: 11, fontFamily: tokens.font.mono,
                      backgroundColor: i % 2 === 0 ? 'transparent' : `${tokens.border.subtle}30`,
                      cursor: evt.nodeId && onSelectNode ? 'pointer' : 'default',
                    }}
                  >
                    <span style={{ color: tokens.text.muted, fontSize: 10, minWidth: 55 }}>
                      {evt.timestamp.split('T')[1]?.slice(0, 8)}
                    </span>
                    <span style={{ color: getEventColor(evt.type), fontWeight: 600, minWidth: 100, fontSize: 10 }}>
                      {evt.type.replace(':', ' ')}
                    </span>
                    {evt.nodeId && (
                      <span style={{ color: tokens.text.accent, fontSize: 10 }}>{evt.nodeId}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

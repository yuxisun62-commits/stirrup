import { useState } from 'react';
import { StatusBadge } from './StatusBadge';
import { tokens } from './ui/styles';
import type { ExecutionEvent } from '../hooks/useExecution';
import type { ExecutionState } from '../api/client';

interface Props {
  execution: ExecutionState | null;
  events: ExecutionEvent[];
  isRunning: boolean;
  onRun: () => void;
  onClear: () => void;
  onDeploy?: () => void;
}

function getEventColor(type: string): string {
  if (type.includes('complete')) return tokens.status.completed;
  if (type.includes('fail')) return tokens.status.failed;
  if (type.includes('start')) return tokens.status.running;
  if (type.includes('skip')) return tokens.status.skipped;
  if (type.includes('retry')) return tokens.status.paused;
  return tokens.text.muted;
}

export function ExecutionPanel({ execution, events, isRunning, onRun, onClear, onDeploy }: Props) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ borderTop: `1px solid ${tokens.border.subtle}`, backgroundColor: tokens.bg.surface }}>
      {/* Header bar — always visible */}
      <div style={{
        padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8,
        cursor: 'pointer',
      }}
        onClick={() => setExpanded((p) => !p)}
      >
        <span style={{
          fontSize: 10, fontWeight: 700, color: tokens.text.muted,
          textTransform: 'uppercase', letterSpacing: '1px',
        }}>
          Execution
        </span>

        {execution && <StatusBadge status={execution.status} size="sm" />}

        {events.length > 0 && (
          <span style={{ fontSize: 10, color: tokens.text.muted }}>
            {events.length} events
          </span>
        )}

        <div style={{ flex: 1 }} />

        <button
          onClick={(e) => { e.stopPropagation(); onRun(); }}
          disabled={isRunning}
          style={{
            padding: '4px 14px', fontSize: 11, fontWeight: 700, borderRadius: 4,
            border: 'none', cursor: isRunning ? 'default' : 'pointer',
            backgroundColor: isRunning ? tokens.border.default : tokens.status.completed,
            color: '#fff', fontFamily: tokens.font.sans,
            letterSpacing: '0.3px',
          }}
        >
          {isRunning ? 'Running...' : 'Run Workflow'}
        </button>

        {execution && (
          <>
            {onDeploy && (
              <button
                onClick={(e) => { e.stopPropagation(); onDeploy(); }}
                style={{
                  padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
                  border: 'none', cursor: 'pointer',
                  background: `linear-gradient(135deg, #06b6d4, #3b82f6)`,
                  color: '#fff',
                }}
              >
                Deploy
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              style={{
                padding: '4px 10px', fontSize: 10, borderRadius: 4,
                border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                color: tokens.text.muted, cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </>
        )}

        <span style={{ fontSize: 14, color: tokens.text.muted, transition: 'transform 0.2s', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          v
        </span>
      </div>

      {/* Expandable content */}
      {expanded && events.length > 0 && (
        <div style={{
          maxHeight: 200, overflow: 'auto', padding: '0 14px 8px',
          borderTop: `1px solid ${tokens.border.subtle}`,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 6 }}>
            {events.map((evt, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '3px 6px', borderRadius: 4,
                fontSize: 11, fontFamily: tokens.font.mono,
                backgroundColor: i % 2 === 0 ? 'transparent' : `${tokens.border.subtle}30`,
              }}>
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
        </div>
      )}
    </div>
  );
}

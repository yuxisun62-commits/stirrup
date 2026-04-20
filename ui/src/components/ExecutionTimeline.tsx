import { useMemo } from 'react';
import type { StepResult } from '../api/client';
import { tokens } from './ui/styles';
import { getNodeMetadata } from './nodeMetadata';

/**
 * Swimlane / gantt-style timeline of an execution.
 *
 * One row per node, ordered by start time. The x-axis spans from the
 * earliest startedAt to the latest completedAt across all steps, so
 * relative timing between parallel nodes is immediately obvious — you
 * can see at a glance which branches ran concurrently and which
 * serialized behind a slow predecessor.
 *
 * Colored bar per row uses the node type's catalog color. Duration
 * and node id overlay the bar at readable sizes. Click a row to
 * select that node in the inspector (onSelect).
 *
 * Handles partial runs gracefully: in-flight nodes without a
 * completedAt render as an open-ended striped bar extending to "now".
 */

interface Props {
  steps: Record<string, StepResult>;
  onSelect?: (nodeId: string) => void;
}

interface Row {
  step: StepResult;
  start: number;
  end: number;
  relStart: number;   // 0..1 within the timeline window
  relEnd: number;     // 0..1
  color: string;
  typeLabel: string;
}

export function ExecutionTimeline({ steps, onSelect }: Props) {
  const rows = useMemo((): { rows: Row[]; totalMs: number; origin: number } | null => {
    const starts: number[] = [];
    const ends: number[] = [];
    const stepList = Object.values(steps);
    if (stepList.length === 0) return null;

    for (const s of stepList) {
      if (s.startedAt) starts.push(new Date(s.startedAt).getTime());
      if (s.completedAt) ends.push(new Date(s.completedAt).getTime());
    }
    if (starts.length === 0) return null;

    const origin = Math.min(...starts);
    const end = ends.length > 0 ? Math.max(...ends) : Date.now();
    const totalMs = Math.max(1, end - origin);

    const rowsOrdered = stepList
      .filter((s) => s.startedAt)
      .map((step): Row => {
        const startMs = new Date(step.startedAt).getTime();
        const endMs = step.completedAt
          ? new Date(step.completedAt).getTime()
          : Date.now();
        // Derive type from whatever nodeId we have plus the global node
        // metadata. We rely on nodeId → type mapping in the handler since
        // the step result itself doesn't carry the type; onSelect can
        // still route the user to the node for the full details.
        // Here we look up metadata by assuming nodeId may contain a hint,
        // but the safer path is to pass the type in explicitly later. For
        // now, fall through to the generic grey bar.
        const meta = getNodeMetadata(step.nodeId);
        return {
          step,
          start: startMs,
          end: endMs,
          relStart: (startMs - origin) / totalMs,
          relEnd: (endMs - origin) / totalMs,
          color: meta.color,
          typeLabel: meta.label,
        };
      })
      .sort((a, b) => a.start - b.start);

    return { rows: rowsOrdered, totalMs, origin };
  }, [steps]);

  if (!rows || rows.rows.length === 0) {
    return (
      <div style={{ fontSize: 11, color: tokens.text.muted, padding: 10 }}>
        No step timing yet — run the workflow to see the timeline.
      </div>
    );
  }

  const { rows: rowData, totalMs } = rows;

  // Pick a handful of tick marks along the x-axis. Three or four ticks
  // keeps the header clean without crowding.
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const ms = Math.round((totalMs * i) / tickCount);
    return {
      percent: (i / tickCount) * 100,
      label: formatDuration(ms),
    };
  });

  return (
    <div style={{ width: '100%', padding: '4px 0' }}>
      {/* Tick axis */}
      <div style={{
        position: 'relative', height: 14, marginBottom: 4,
        borderBottom: `1px dashed ${tokens.border.subtle}`,
      }}>
        {ticks.map((t) => (
          <span
            key={t.percent}
            style={{
              position: 'absolute',
              left: `${t.percent}%`,
              transform: 'translateX(-50%)',
              fontSize: 9,
              color: tokens.text.muted,
              fontFamily: tokens.font.mono,
            }}
          >
            {t.label}
          </span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rowData.map((row) => {
          const durationMs = row.end - row.start;
          const widthPct = Math.max(0.5, (row.relEnd - row.relStart) * 100);
          const leftPct = row.relStart * 100;
          const isRunning = row.step.status === 'running' || !row.step.completedAt;
          const isFailed = row.step.status === 'failed';

          const fillColor = isFailed
            ? tokens.status.failed
            : row.color;

          return (
            <button
              key={row.step.nodeId}
              onClick={() => onSelect?.(row.step.nodeId)}
              style={{
                display: 'grid',
                gridTemplateColumns: '110px 1fr',
                gap: 6,
                padding: '3px 4px',
                background: 'none',
                border: 'none',
                borderRadius: 4,
                textAlign: 'left',
                cursor: onSelect ? 'pointer' : 'default',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = `${tokens.border.subtle}30`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              }}
              title={`${row.step.nodeId} — ${formatDuration(durationMs)}`}
            >
              <span style={{
                fontSize: 10,
                fontFamily: tokens.font.mono,
                color: tokens.text.secondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                padding: '3px 0',
              }}>
                {row.step.nodeId}
              </span>

              <div style={{
                position: 'relative',
                height: 18,
                backgroundColor: `${tokens.border.subtle}40`,
                borderRadius: 3,
              }}>
                <div
                  style={{
                    position: 'absolute',
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    top: 1,
                    bottom: 1,
                    borderRadius: 2,
                    background: isRunning
                      ? `repeating-linear-gradient(90deg, ${fillColor}80 0 6px, ${fillColor}40 6px 12px)`
                      : `linear-gradient(180deg, ${fillColor} 0%, ${fillColor}b0 100%)`,
                    border: `1px solid ${fillColor}`,
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: 5,
                    paddingRight: 5,
                    overflow: 'hidden',
                    fontSize: 9,
                    color: '#fff',
                    fontFamily: tokens.font.mono,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {widthPct > 8 && (
                    <span style={{ letterSpacing: 0.3 }}>
                      {formatDuration(durationMs)}
                      {row.step.attempts > 1 && ` · ${row.step.attempts}×`}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

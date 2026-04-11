import { useState, useCallback, useRef } from 'react';
import { executeWorkflow, subscribeToExecution, type ExecutionState } from '../api/client';

export interface ExecutionEvent {
  type: string;
  nodeId?: string;
  timestamp: string;
  data: unknown;
}

export function useExecution() {
  const [execution, setExecution] = useState<ExecutionState | null>(null);
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  const run = useCallback(async (workflowId: string, context?: Record<string, unknown>) => {
    // Clean up previous subscription
    unsubRef.current?.();
    setEvents([]);
    setIsRunning(true);

    try {
      // Server responds immediately after execution has started (202 Accepted)
      const state = await executeWorkflow(workflowId, context);
      setExecution({ ...state, status: 'running' });

      // Subscribe to SSE events — now that execution has started but not yet completed,
      // we'll receive all node:start / node:complete events live
      const unsub = subscribeToExecution(state.executionId, (type, data) => {
        const evt: ExecutionEvent = {
          type,
          nodeId: (data as any)?.nodeId,
          timestamp: new Date().toISOString(),
          data,
        };
        setEvents((prev) => [...prev, evt]);

        if (type === 'node:start') {
          setExecution((prev) => {
            if (!prev) return prev;
            const d = data as any;
            return {
              ...prev,
              status: 'running',
              steps: {
                ...prev.steps,
                [d.nodeId]: {
                  nodeId: d.nodeId,
                  status: 'running',
                  outputs: {},
                  startedAt: new Date().toISOString(),
                  attempts: 0,
                },
              },
            };
          });
        }

        if (type === 'node:complete' || type === 'node:fail' || type === 'node:skip') {
          setExecution((prev) => {
            if (!prev) return prev;
            const d = data as any;
            const existing = prev.steps[d.nodeId];
            return {
              ...prev,
              steps: {
                ...prev.steps,
                [d.nodeId]: {
                  ...existing,
                  nodeId: d.nodeId,
                  status: type === 'node:complete' ? 'completed' : type === 'node:fail' ? 'failed' : 'skipped',
                  outputs: d.outputs ?? existing?.outputs ?? {},
                  error: type === 'node:fail'
                    ? { message: d.error ?? 'unknown', attempt: d.attempt ?? 1 }
                    : undefined,
                  startedAt: existing?.startedAt ?? new Date().toISOString(),
                  completedAt: new Date().toISOString(),
                  attempts: d.attempt ?? existing?.attempts ?? 1,
                },
              },
            };
          });
        }

        if (type === 'node:retry') {
          setExecution((prev) => {
            if (!prev) return prev;
            const d = data as any;
            const existing = prev.steps[d.nodeId];
            return {
              ...prev,
              steps: {
                ...prev.steps,
                [d.nodeId]: {
                  ...existing,
                  attempts: d.attempt ?? (existing?.attempts ?? 0) + 1,
                },
              },
            };
          });
        }

        if (type === 'execution:complete' || type === 'execution:fail') {
          setIsRunning(false);
          setExecution((prev) =>
            prev ? { ...prev, status: type === 'execution:complete' ? 'completed' : 'failed' } : prev
          );
          // Keep subscription open briefly so any final events aren't missed
          setTimeout(() => unsubRef.current?.(), 500);
        }
      });

      unsubRef.current = unsub;
    } catch (err) {
      setIsRunning(false);
      throw err;
    }
  }, []);

  const clear = useCallback(() => {
    unsubRef.current?.();
    setExecution(null);
    setEvents([]);
    setIsRunning(false);
  }, []);

  return { execution, events, isRunning, run, clear };
}

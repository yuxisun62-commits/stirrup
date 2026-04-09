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
      const state = await executeWorkflow(workflowId, context);
      setExecution(state);

      // Subscribe to SSE events
      const unsub = subscribeToExecution(state.executionId, (type, data) => {
        const evt: ExecutionEvent = {
          type,
          nodeId: (data as any)?.nodeId,
          timestamp: new Date().toISOString(),
          data,
        };
        setEvents((prev) => [...prev, evt]);

        // Update step statuses from events
        if (type === 'node:complete' || type === 'node:fail' || type === 'node:skip') {
          setExecution((prev) => {
            if (!prev) return prev;
            const d = data as any;
            return {
              ...prev,
              steps: {
                ...prev.steps,
                [d.nodeId]: {
                  ...prev.steps[d.nodeId],
                  nodeId: d.nodeId,
                  status: type === 'node:complete' ? 'completed' : type === 'node:fail' ? 'failed' : 'skipped',
                  outputs: d.outputs ?? {},
                  startedAt: prev.steps[d.nodeId]?.startedAt ?? new Date().toISOString(),
                  attempts: d.attempt ?? 1,
                },
              },
            };
          });
        }

        if (type === 'node:start') {
          setExecution((prev) => {
            if (!prev) return prev;
            const d = data as any;
            return {
              ...prev,
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

        if (type === 'execution:complete' || type === 'execution:fail') {
          setIsRunning(false);
          setExecution((prev) =>
            prev ? { ...prev, status: type === 'execution:complete' ? 'completed' : 'failed' } : prev
          );
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

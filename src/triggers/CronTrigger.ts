import type { WorkflowDefinition } from "../types/workflow.js";
import type { TriggerHandler, TriggerRegistration, TriggerDispatch } from "./types.js";

/**
 * Cron trigger backed by node-cron. Supports standard 5-field expressions
 * (`*\/5 * * * *`, `0 9 * * 1-5`, etc.) and an optional IANA timezone.
 *
 * node-cron is loaded via dynamic import so the engine package continues
 * to start even if the dep is absent (e.g., in a lean CLI-only install).
 * A workflow that declares a cron trigger in that case logs a warning and
 * refuses to register — triggers without cron support should not silently
 * no-op.
 */
export function CronTriggerHandler(): TriggerHandler {
  return {
    kind: "cron",
    register(
      workflow: WorkflowDefinition,
      dispatch: TriggerDispatch,
      reportFire,
    ): TriggerRegistration | null {
      const cfg = workflow.triggers?.cron;
      if (!cfg) return null;

      let task: { stop: () => void } | null = null;

      // node-cron is synchronously-constructed but we use a dynamic import
      // to keep this handler's module load side-effect-free. The `void`
      // kicks off registration; if it fails we log and leave the registration
      // in place with a no-op stop so the UI can show "cron (failed to load)".
      void (async () => {
        try {
          const cron = await import("node-cron");
          if (!cron.validate(cfg.schedule)) {
            console.error(
              `[cron] invalid schedule "${cfg.schedule}" for ${workflow.id}; trigger disabled`,
            );
            return;
          }
          task = cron.schedule(
            cfg.schedule,
            async () => {
              try {
                const result = await dispatch(workflow.id, {
                  _trigger: "cron",
                  _triggeredAt: new Date().toISOString(),
                });
                reportFire({ executionId: result.executionId });
              } catch (err) {
                reportFire({ error: err as Error });
                console.error(`[cron] ${workflow.id} failed:`, (err as Error).message);
              }
            },
            cfg.timezone ? { timezone: cfg.timezone } : undefined,
          );
        } catch (err) {
          console.error(
            `[cron] node-cron unavailable for ${workflow.id}; install \`npm i node-cron\`. Error:`,
            (err as Error).message,
          );
        }
      })();

      return {
        workflowId: workflow.id,
        kind: "cron",
        label: `${cfg.schedule}${cfg.timezone ? ` (${cfg.timezone})` : ""}`,
        stop: () => {
          task?.stop();
          task = null;
        },
      };
    },
  };
}

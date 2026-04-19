import { describe, it, expect } from "vitest";
import { importN8nWorkflow } from "../../src/import/n8n.js";

describe("n8n trigger extraction", () => {
  it("lifts a webhook node into workflow.triggers.http", () => {
    const { workflow } = importN8nWorkflow({
      name: "hook",
      nodes: [
        {
          id: "1",
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          parameters: { path: "my-hook", httpMethod: "POST" },
        },
      ],
    });
    expect(workflow.triggers?.http).toBeDefined();
    expect(workflow.triggers!.http!.path).toBe("/my-hook");
    expect(workflow.triggers!.http!.method).toBe("POST");
  });

  it("lifts a cron (legacy) node into workflow.triggers.cron", () => {
    const { workflow } = importN8nWorkflow({
      name: "cron",
      nodes: [
        {
          id: "1",
          name: "Cron",
          type: "n8n-nodes-base.cron",
          parameters: { cronExpression: "0 9 * * 1-5" },
        },
      ],
    });
    expect(workflow.triggers?.cron?.schedule).toBe("0 9 * * 1-5");
  });

  it("translates scheduleTrigger numeric intervals to cron", () => {
    const hourly = importN8nWorkflow({
      name: "hourly",
      nodes: [
        {
          id: "1",
          name: "Schedule",
          type: "n8n-nodes-base.scheduleTrigger",
          parameters: { rule: { interval: [{ field: "hours", hoursInterval: 1 }] } },
        },
      ],
    });
    expect(hourly.workflow.triggers?.cron?.schedule).toBe("0 * * * *");

    const every5min = importN8nWorkflow({
      name: "fivemin",
      nodes: [
        {
          id: "1",
          name: "Schedule",
          type: "n8n-nodes-base.scheduleTrigger",
          parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } },
        },
      ],
    });
    expect(every5min.workflow.triggers?.cron?.schedule).toBe("*/5 * * * *");

    const daily = importN8nWorkflow({
      name: "daily",
      nodes: [
        {
          id: "1",
          name: "Schedule",
          type: "n8n-nodes-base.scheduleTrigger",
          parameters: { rule: { interval: [{ field: "days", daysInterval: 1 }] } },
        },
      ],
    });
    expect(daily.workflow.triggers?.cron?.schedule).toBe("0 0 * * *");
  });

  it("passes through explicit cron expressions from scheduleTrigger", () => {
    const { workflow } = importN8nWorkflow({
      name: "cronExpr",
      nodes: [
        {
          id: "1",
          name: "Schedule",
          type: "n8n-nodes-base.scheduleTrigger",
          parameters: {
            rule: { interval: [{ field: "cronExpression", expression: "*/15 * * * *" }] },
          },
        },
      ],
    });
    expect(workflow.triggers?.cron?.schedule).toBe("*/15 * * * *");
  });

  it("warns and skips when scheduleTrigger uses an unsupported field", () => {
    const { workflow, report } = importN8nWorkflow({
      name: "weeks",
      nodes: [
        {
          id: "1",
          name: "Schedule",
          type: "n8n-nodes-base.scheduleTrigger",
          parameters: { rule: { interval: [{ field: "weeks", weeksInterval: 2 }] } },
        },
      ],
    });
    expect(workflow.triggers).toBeUndefined();
    expect(report.warnings.some((w) => w.includes("weeks"))).toBe(true);
  });
});

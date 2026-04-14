/**
 * Stirrup Plugin: Logger & Metrics
 * Node types: log, metric, assert, timer
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("log", async (config, execCtx) => {
    const { level, message, data, tag } = { ...execCtx.inputs, ...config } as {
      level?: string; message: string; data?: unknown; tag?: string;
    };

    const timestamp = new Date().toISOString();
    const logLevel = level ?? "info";
    const prefix = tag ? `[${tag}]` : "";

    const entry = { timestamp, level: logLevel, message: `${prefix} ${message}`.trim(), data };

    switch (logLevel) {
      case "error": console.error(JSON.stringify(entry)); break;
      case "warn": console.warn(JSON.stringify(entry)); break;
      case "debug": console.debug(JSON.stringify(entry)); break;
      default: console.log(JSON.stringify(entry));
    }

    // Also store in context for workflow-level log collection
    const logs = (execCtx.context._logs as unknown[]) ?? [];
    logs.push(entry);
    execCtx.context._logs = logs;

    return { logged: true, timestamp, level: logLevel };
  });

  ctx.registerNodeType("metric", async (config, execCtx) => {
    const { name, value, unit, tags } = { ...execCtx.inputs, ...config } as {
      name: string; value: number; unit?: string; tags?: Record<string, string>;
    };

    const metric = {
      name,
      value,
      unit: unit ?? "count",
      tags: tags ?? {},
      timestamp: new Date().toISOString(),
    };

    // Store in context for collection
    const metrics = (execCtx.context._metrics as unknown[]) ?? [];
    metrics.push(metric);
    execCtx.context._metrics = metrics;

    return { recorded: true, metric };
  });

  ctx.registerNodeType("assert", async (config, execCtx) => {
    const { condition, message, value, expected, operator } = { ...execCtx.inputs, ...config } as {
      condition?: boolean; message?: string; value?: unknown; expected?: unknown;
      operator?: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "truthy" | "falsy" | "contains";
    };

    let passed = false;

    if (condition !== undefined) {
      passed = !!condition;
    } else if (operator && value !== undefined) {
      switch (operator) {
        case "eq": passed = value === expected; break;
        case "neq": passed = value !== expected; break;
        case "gt": passed = (value as number) > (expected as number); break;
        case "lt": passed = (value as number) < (expected as number); break;
        case "gte": passed = (value as number) >= (expected as number); break;
        case "lte": passed = (value as number) <= (expected as number); break;
        case "truthy": passed = !!value; break;
        case "falsy": passed = !value; break;
        case "contains": passed = String(value).includes(String(expected)); break;
      }
    }

    if (!passed) {
      throw new Error(`Assertion failed: ${message ?? `${value} ${operator ?? "=="} ${expected}`}`);
    }

    return { passed: true, message: message ?? "assertion passed" };
  });

  ctx.registerNodeType("timer", async (config, execCtx) => {
    const { action, label } = { ...execCtx.inputs, ...config } as {
      action: "start" | "stop"; label: string;
    };

    const timerKey = `_timer_${label}`;

    if (action === "start") {
      execCtx.context[timerKey] = Date.now();
      return { started: true, label, timestamp: new Date().toISOString() };
    }

    const startTime = execCtx.context[timerKey] as number | undefined;
    if (!startTime) throw new Error(`Timer "${label}" was never started`);

    const elapsed = Date.now() - startTime;
    delete execCtx.context[timerKey];

    return { label, elapsedMs: elapsed, elapsedSeconds: elapsed / 1000 };
  });

  // Tool: logger-log — for agent-tool-use nodes that need a simple logging tool
  ctx.registerTool({
    name: "logger-log",
    description: "Log a message or value. Use this to record information during workflow execution.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The message to log" },
        level: { type: "string", description: "Log level: info, warn, error", enum: ["info", "warn", "error"] },
      },
      required: ["message"],
    },
    handler: async (input) => {
      const level = (input.level as string) ?? "info";
      const message = String(input.message);
      const timestamp = new Date().toISOString();
      console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
        `[${timestamp}] [${level.toUpperCase()}] ${message}`
      );
      return { logged: true, message, level, timestamp };
    },
  });
}

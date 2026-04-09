import type { NodeHandler } from "./NodeRegistry.js";
import type { HttpNodeConfig } from "../types/nodes.js";
import { renderTemplate } from "../ai/PromptTemplate.js";

export const httpHandler: NodeHandler = async (config, ctx) => {
  const cfg = config as unknown as HttpNodeConfig;

  const url = renderTemplate(cfg.url, ctx.inputs);

  const headers: Record<string, string> = {};
  if (cfg.headers) {
    for (const [key, val] of Object.entries(cfg.headers)) {
      headers[key] = renderTemplate(val, ctx.inputs);
    }
  }

  const fetchOptions: RequestInit = {
    method: cfg.method,
    headers,
  };

  if (cfg.body && cfg.method !== "GET") {
    fetchOptions.body = typeof cfg.body === "string"
      ? renderTemplate(cfg.body, ctx.inputs)
      : JSON.stringify(cfg.body);
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const response = await fetch(url, fetchOptions);
  const contentType = response.headers.get("content-type") ?? "";

  let body: unknown;
  if (contentType.includes("application/json")) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  };
};

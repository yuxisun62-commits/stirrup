/**
 * Stirrup Plugin: Resend
 * Node types: resend-send, resend-batch, resend-list-emails
 *
 * Resend is a dev-first transactional email service with a clean REST API.
 * Auth: API key under service "resend" (`re_...`). Your `from` address
 * must be on a verified domain or @resend.dev in test mode.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../safeFetch.js";

const API = "https://api.resend.com";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Resend API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("resend-send", async (config, execCtx) => {
    const { token, from, to, subject, html, text, cc, bcc, replyTo, tags } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; from: string; to: string | string[]; subject: string;
      html?: string; text?: string; cc?: string | string[]; bcc?: string | string[];
      replyTo?: string; tags?: Array<{ name: string; value: string }>;
    };
    if (!html && !text) throw new Error("resend-send requires html or text body");
    const data = await call<{ id: string }>(token, "/emails", {
      method: "POST",
      body: JSON.stringify({
        from, to, subject, html, text, cc, bcc,
        reply_to: replyTo, tags,
      }),
    });
    return { messageId: data.id };
  });

  // Bulk send — up to 100 per request. Resend applies rate limits; we
  // pass the list straight through without batching internally.
  ctx.registerNodeType("resend-batch", async (config, execCtx) => {
    const { token, emails } = { ...execCtx.inputs, ...config } as {
      token: string;
      emails: Array<{ from: string; to: string | string[]; subject: string; html?: string; text?: string }>;
    };
    const data = await call<{ data: Array<{ id: string }> }>(token, "/emails/batch", {
      method: "POST",
      body: JSON.stringify(emails),
    });
    return { messageIds: data.data.map((d) => d.id), count: data.data.length };
  });

  ctx.registerNodeType("resend-list-emails", async (config, execCtx) => {
    const { token, limit } = { ...execCtx.inputs, ...config } as { token: string; limit?: number };
    const data = await call<{ data: Array<Record<string, unknown>> }>(
      token,
      `/emails?limit=${limit ?? 20}`,
    );
    return { emails: data.data, count: data.data.length };
  });

  ctx.registerTool({
    name: "resend-send",
    description: "Send a transactional email via Resend",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["from", "to", "subject", "body"],
    },
    handler: async (input) => {
      const token = process.env.RESEND_API_KEY;
      if (!token) throw new Error("RESEND_API_KEY not set");
      const { from, to, subject, body } = input as { from: string; to: string; subject: string; body: string };
      const data = await call<{ id: string }>(token, "/emails", {
        method: "POST",
        body: JSON.stringify({ from, to, subject, html: body }),
      });
      return { messageId: data.id };
    },
  });
}

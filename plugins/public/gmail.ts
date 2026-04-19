/**
 * Stirrup Plugin: Gmail
 * Node types: gmail-send, gmail-list-messages, gmail-get-message, gmail-search
 *
 * Auth: Gmail API uses Google OAuth2. The token comes from the token store
 * under service "gmail" (or "google" if the user authenticated via Google
 * generally — we try gmail first, fall back to google). Users should grant
 * scope https://www.googleapis.com/auth/gmail.send + gmail.readonly.
 *
 * We talk to the raw REST API rather than pulling in googleapis to keep
 * the footprint tiny.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * Build the RFC 2822 message + base64url-encode for the Gmail API's
 * /messages/send endpoint. Supports plain text and HTML via the `html`
 * flag; CC/BCC via comma-separated strings.
 */
function buildRawMessage(args: {
  to: string; from?: string; cc?: string; bcc?: string;
  subject: string; body: string; html?: boolean; replyTo?: string;
}): string {
  const headers: string[] = [];
  if (args.from) headers.push(`From: ${args.from}`);
  headers.push(`To: ${args.to}`);
  if (args.cc) headers.push(`Cc: ${args.cc}`);
  if (args.bcc) headers.push(`Bcc: ${args.bcc}`);
  if (args.replyTo) headers.push(`Reply-To: ${args.replyTo}`);
  headers.push(`Subject: ${args.subject}`);
  headers.push("MIME-Version: 1.0");
  headers.push(`Content-Type: ${args.html ? "text/html" : "text/plain"}; charset=UTF-8`);
  const raw = headers.join("\r\n") + "\r\n\r\n" + args.body;
  // Gmail expects base64url without padding
  return Buffer.from(raw, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("gmail-send", async (config, execCtx) => {
    const { token, to, from, cc, bcc, subject, body, html, replyTo } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; to: string; from?: string; cc?: string; bcc?: string;
      subject: string; body: string; html?: boolean; replyTo?: string;
    };
    const raw = buildRawMessage({ to, from, cc, bcc, subject, body, html, replyTo });
    const sent = await call<{ id: string; threadId: string; labelIds: string[] }>(
      token,
      "/messages/send",
      { method: "POST", body: JSON.stringify({ raw }) },
    );
    return { messageId: sent.id, threadId: sent.threadId };
  });

  ctx.registerNodeType("gmail-list-messages", async (config, execCtx) => {
    const { token, query, labelIds, maxResults } = { ...execCtx.inputs, ...config } as {
      token: string; query?: string; labelIds?: string[]; maxResults?: number;
    };
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (maxResults) params.set("maxResults", String(maxResults));
    if (labelIds) for (const l of labelIds) params.append("labelIds", l);
    const data = await call<{ messages?: Array<{ id: string; threadId: string }>; resultSizeEstimate: number }>(
      token,
      `/messages?${params.toString()}`,
    );
    return {
      messages: data.messages ?? [],
      resultSizeEstimate: data.resultSizeEstimate,
    };
  });

  ctx.registerNodeType("gmail-get-message", async (config, execCtx) => {
    const { token, messageId, format } = { ...execCtx.inputs, ...config } as {
      token: string; messageId: string; format?: "full" | "metadata" | "minimal" | "raw";
    };
    const msg = await call<Record<string, unknown>>(
      token,
      `/messages/${encodeURIComponent(messageId)}?format=${format ?? "full"}`,
    );
    // Pluck common fields off the payload for ergonomic downstream access;
    // the full payload stays under `raw` for the fiddly cases.
    const payload = (msg.payload as Record<string, unknown>) ?? {};
    const headers = (payload.headers as Array<{ name: string; value: string }>) ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
    return {
      id: msg.id,
      threadId: msg.threadId,
      snippet: msg.snippet,
      from: header("from"),
      to: header("to"),
      subject: header("subject"),
      date: header("date"),
      labelIds: msg.labelIds,
      raw: msg,
    };
  });

  // Convenience wrapper around the /messages endpoint with search syntax.
  // Identical to gmail-list-messages but named for the common use case.
  ctx.registerNodeType("gmail-search", async (config, execCtx) => {
    const { token, query, maxResults } = { ...execCtx.inputs, ...config } as {
      token: string; query: string; maxResults?: number;
    };
    const params = new URLSearchParams({ q: query });
    if (maxResults) params.set("maxResults", String(maxResults));
    const data = await call<{ messages?: Array<{ id: string; threadId: string }> }>(
      token,
      `/messages?${params.toString()}`,
    );
    return { messages: data.messages ?? [], count: (data.messages ?? []).length };
  });

  ctx.registerTool({
    name: "gmail-send",
    description: "Send an email via the authenticated user's Gmail account",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email(s), comma-separated" },
        subject: { type: "string" },
        body: { type: "string" },
        html: { type: "boolean", description: "Treat body as HTML" },
      },
      required: ["to", "subject", "body"],
    },
    handler: async (input) => {
      const token = process.env.GMAIL_ACCESS_TOKEN ?? process.env.GOOGLE_ACCESS_TOKEN;
      if (!token) throw new Error("GMAIL_ACCESS_TOKEN not set");
      const { to, subject, body, html } = input as { to: string; subject: string; body: string; html?: boolean };
      const raw = buildRawMessage({ to, subject, body, html });
      const sent = await call<{ id: string }>(token, "/messages/send", {
        method: "POST",
        body: JSON.stringify({ raw }),
      });
      return { messageId: sent.id };
    },
  });
}

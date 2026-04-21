/**
 * Stirrup Plugin: SendGrid
 * Node types: sendgrid-send, sendgrid-send-template, sendgrid-add-contact
 * Tools: sendgrid-send
 *
 * Auth: SendGrid API key (service: "sendgrid"). Get one at
 * app.sendgrid.com/settings/api_keys. The "from" address must be a
 * verified sender or identity in your SendGrid account.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../safeFetch.js";

const API = "https://api.sendgrid.com/v3";

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T | null> {
  const res = await safeFetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`SendGrid API ${res.status}: ${await res.text()}`);
  // 202 Accepted on send, no body
  if (res.status === 202 || res.status === 204) return null;
  return res.json() as Promise<T>;
}

interface SendParams {
  token: string;
  to: string | string[];
  from: string;
  fromName?: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  categories?: string[];
}

function buildRecipients(addrs: string | string[] | undefined): Array<{ email: string }> | undefined {
  if (!addrs) return undefined;
  const list = Array.isArray(addrs) ? addrs : [addrs];
  return list.filter((a) => a && a.includes("@")).map((email) => ({ email }));
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("sendgrid-send", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as unknown as SendParams;
    const { token, to, from, fromName, subject, text, html, replyTo, cc, bcc, categories } = merged;
    if (!text && !html) throw new Error("sendgrid-send requires text or html body");

    const content: Array<{ type: string; value: string }> = [];
    if (text) content.push({ type: "text/plain", value: text });
    if (html) content.push({ type: "text/html", value: html });

    const personalization: Record<string, unknown> = {
      to: buildRecipients(to),
    };
    if (cc) personalization.cc = buildRecipients(cc);
    if (bcc) personalization.bcc = buildRecipients(bcc);

    await call<void>(token, "/mail/send", {
      method: "POST",
      body: JSON.stringify({
        personalizations: [personalization],
        from: fromName ? { email: from, name: fromName } : { email: from },
        reply_to: replyTo ? { email: replyTo } : undefined,
        subject,
        content,
        categories,
      }),
    });
    return { sent: true, to: Array.isArray(to) ? to : [to] };
  });

  // Uses a SendGrid Dynamic Template (d-...) with merge data. Much cleaner
  // than stuffing rendered HTML into the content field for repeated sends.
  ctx.registerNodeType("sendgrid-send-template", async (config, execCtx) => {
    const { token, to, from, templateId, dynamicTemplateData } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; to: string | string[]; from: string;
      templateId: string; dynamicTemplateData?: Record<string, unknown>;
    };
    await call<void>(token, "/mail/send", {
      method: "POST",
      body: JSON.stringify({
        personalizations: [{
          to: buildRecipients(to),
          dynamic_template_data: dynamicTemplateData ?? {},
        }],
        from: { email: from },
        template_id: templateId,
      }),
    });
    return { sent: true, templateId };
  });

  ctx.registerNodeType("sendgrid-add-contact", async (config, execCtx) => {
    const { token, email, firstName, lastName, lists } = { ...execCtx.inputs, ...config } as {
      token: string; email: string; firstName?: string; lastName?: string; lists?: string[];
    };
    const body = await call<{ job_id: string }>(token, "/marketing/contacts", {
      method: "PUT",
      body: JSON.stringify({
        list_ids: lists,
        contacts: [{ email, first_name: firstName, last_name: lastName }],
      }),
    });
    return { jobId: body?.job_id, email };
  });

  ctx.registerTool({
    name: "sendgrid-send",
    description: "Send a transactional email via SendGrid",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        from: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "from", "subject", "body"],
    },
    handler: async (input) => {
      const token = process.env.SENDGRID_API_KEY;
      if (!token) throw new Error("SENDGRID_API_KEY not set");
      const { to, from, subject, body } = input as { to: string; from: string; subject: string; body: string };
      await call<void>(token, "/mail/send", {
        method: "POST",
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from },
          subject,
          content: [{ type: "text/plain", value: body }],
        }),
      });
      return { sent: true };
    },
  });
}
